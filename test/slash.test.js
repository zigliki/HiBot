const { test } = require("node:test");
const assert = require("node:assert");
const { PermissionFlagsBits } = require("discord.js");
const db = require("../src/data/db");
const admin = require("../src/commands/admin");
const slash = require("../src/commands/slash");
const commandContext = require("../src/discord/commandContext");

const json = Object.fromEntries(slash.commands.map((c) => [c.data.name, c.data.toJSON()]));
const goldenJson = Object.fromEntries(slash.goldenAgeCommands.map((c) => [c.data.name, c.data.toJSON()]));

test("the slash set is stats, first, top, chain and output - pic and status are deliberately not slash commands", () => {
    assert.deepEqual(slash.commands.map((c) => c.data.name), ["stats", "first", "top", "chain", "output"]);
    assert.equal(slash.byName.pic, undefined);
    assert.equal(slash.byName.status, undefined);
});

test("every command is guild-only and has a description Discord will accept", () => {
    for (const command of Object.values(json)) {
        assert.deepEqual(command.contexts, [0], command.name);
        assert.ok(command.description.length > 0 && command.description.length <= 100, command.name);
    }
});

test("only output is hidden from non-admins by default, and only output is ephemeral", () => {
    assert.equal(json.output.default_member_permissions, String(PermissionFlagsBits.Administrator));
    for (const name of ["stats", "first", "top", "chain"]) {
        assert.equal(json[name].default_member_permissions, undefined, name);
        assert.ok(!slash.byName[name].ephemeral && !slash.byName[name].allowed, name);
    }
    assert.equal(slash.byName.output.ephemeral, true);
    assert.equal(typeof slash.byName.output.allowed, "function");
});

test("options: user pickers, choice lists and a required text channel", () => {
    assert.deepEqual(json.stats.options.map((o) => [o.name, o.type, !!o.required]), [["user", 6, false]]);
    assert.deepEqual(json.first.options.map((o) => [o.name, o.type, !!o.required]), [["user", 6, false]]);
    assert.deepEqual(json.top.options[0].choices.map((c) => c.value), ["his", "average"]);
    assert.deepEqual(json.chain.options, []);
    assert.deepEqual(json.output.options.map((o) => [o.name, o.type, o.required, o.channel_types]), [["channel", 7, true, [0]]]);
});

test("the golden-age set is the same commands, but /chain also offers the era choice", () => {
    assert.deepEqual(slash.goldenAgeCommands.map((c) => c.data.name), slash.commands.map((c) => c.data.name));
    assert.deepEqual(goldenJson.chain.options.map((o) => [o.name, o.type, !!o.required]), [["era", 3, false]]);
    assert.deepEqual(goldenJson.chain.options[0].choices.map((c) => c.value), ["hibot", "prebot"]);
    for (const name of ["stats", "first", "top", "output"]) {
        assert.deepEqual(goldenJson[name], json[name], name);
    }
});

test("commandsFor: Shaun The Sheep gets the golden-age set, every other server the main one", () => {
    const saved = process.env.GOLDEN_AGE_GUILD;
    delete process.env.GOLDEN_AGE_GUILD;
    try {
        assert.equal(slash.goldenAgeGuild(), "128039782679969792");
        assert.equal(slash.commandsFor("128039782679969792"), slash.goldenAgeCommands);
        assert.equal(slash.commandsFor("376510932769046528"), slash.commands);
        assert.equal(slash.commandsFor("anything else"), slash.commands);
    } finally {
        if (saved !== undefined) process.env.GOLDEN_AGE_GUILD = saved;
    }
});

test("commandsFor: GOLDEN_AGE_GUILD changes which server gets the golden-age set (how staging tests it)", () => {
    const saved = process.env.GOLDEN_AGE_GUILD;
    process.env.GOLDEN_AGE_GUILD = "TEST";
    try {
        assert.equal(slash.commandsFor("TEST"), slash.goldenAgeCommands);
        assert.equal(slash.commandsFor("128039782679969792"), slash.commands);
    } finally {
        if (saved === undefined) delete process.env.GOLDEN_AGE_GUILD; else process.env.GOLDEN_AGE_GUILD = saved;
    }
});

// an interaction stub with just the option getters a command uses
function interaction(options, extra) {
    return Object.assign({
        user: { id: "REQ" },
        guildId: "g",
        options: {
            getUser: (n) => (options.user ? { id: options.user } : null),
            getString: (n) => options[n] || null,
            getChannel: (n) => options.channel || null
        }
    }, extra);
}

function ctxFor(sink) {
    const i = { user: { id: "REQ" }, guildId: "g", editReply: async (p) => { sink.push(p); } };
    return commandContext.fromInteraction(i, { user: { id: "BOT" } });
}

test("execute: the slash commands call the same handlers as the text ones, with the picked options", async () => {
    db.getServerStats = async () => [
        { user: "REQ", successful: 20, avgHi: 300, firstHi: 0, lastHi: 0 },
        { user: "222", successful: 12, avgHi: 100, firstHi: 86400000, lastHi: 0 }
    ];
    db.getUserStats = async (user) => ({ user, successful: 3, avgHi: 0, firstHi: 86400000, lastHi: 0 });
    db.getHi = async () => ({
        longestChain: { count: 6, participants: { A: 6 }, startedAt: 0, endedAt: 1 },
        preChain: { count: 159, participants: { B: 159 }, startedAt: 0, endedAt: 1 },
        currentChain: { count: 3 }
    });
    const run = async (name, options) => {
        const out = [];
        await slash.byName[name].execute(ctxFor(out), interaction(options), {});
        return out[0].content;
    };
    assert.match(await run("stats", {}), /^<@REQ> your hi stats/);
    assert.match(await run("stats", { user: "222" }), /^<@222>'s hi stats/);
    assert.match(await run("first", { user: "222" }), /^<@222>'s first hi/);
    assert.match(await run("top", {}), /top hi-ers in this server/);
    assert.match(await run("top", { board: "average" }), /most consistent hi-ers/);
    assert.match(await run("chain", {}), /longest hi chain in this server: 6/);
    assert.match(await run("chain", { era: "hibot" }), /longest hi chain in this server: 6/);
    assert.match(await run("chain", { era: "prebot" }), /golden age\): 159/);
});

test("execute output: sets the channel through the same admin function as the text command, then confirms", async () => {
    const saved = admin.setOutputChannel;
    let call;
    admin.setOutputChannel = async (...a) => { call = a; };
    const out = [];
    try {
        await slash.byName.output.execute(ctxFor(out), interaction({ channel: { id: "c9" } }), { the: "client" });
    } finally {
        admin.setOutputChannel = saved;
    }
    assert.deepEqual(call, [{ the: "client" }, "g", "c9"]);
    assert.equal(out[0].content, "output channel set to <#c9>");
});

test("allowed (output): a server admin or the bot admin, nobody else", () => {
    const allowed = slash.byName.output.allowed;
    const as = (id, isAdmin) => ({ user: { id }, memberPermissions: { has: (p) => isAdmin && p === PermissionFlagsBits.Administrator } });
    const savedDev = process.env.DEV;
    process.env.DEV = "OWNER";
    try {
        assert.equal(allowed(as("ADMIN", true)), true);
        assert.equal(allowed(as("OWNER", false)), true);
        assert.equal(allowed(as("RANDOM", false)), false);
    } finally {
        if (savedDev === undefined) delete process.env.DEV; else process.env.DEV = savedDev;
    }
});
