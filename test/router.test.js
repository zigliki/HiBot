const { test } = require("node:test");
const assert = require("node:assert");
const { ChannelType } = require("discord.js");
const db = require("../src/data/db");
const admin = require("../src/commands/admin");
const log = require("../src/logging");
const router = require("../src/commands/router");

// what the router logged, and keep the console quiet while it runs
const logged = [];
log.addSink({ name: "router-test", defaultLevel: "debug", write: (e) => logged.push(e) });

const client = { user: { id: "BOT" } };

// a guild message as the router sees it; replies are collected in `sent`
function mkMessage(content, sent, opts) {
    opts = opts || {};
    return {
        content: content,
        author: { id: "REQ", tag: "kingnoskcaj" },
        channel: { type: opts.type === undefined ? ChannelType.GuildText : opts.type, send: async (o) => { sent.push(o); } },
        member: { user: { id: "REQ", tag: "kingnoskcaj" }, permissions: { has: () => !!opts.admin } },
        guild: { id: "g", name: "Test Server" }
    };
}

// botCommands doesn't await the handlers, so let them settle before looking at what was sent
async function run(content, opts) {
    const sent = [];
    const saved = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = () => {};
    logged.length = 0;
    try {
        router.botCommands(mkMessage(content, sent, opts), client);
        await new Promise((resolve) => setImmediate(resolve));
    } finally {
        Object.assign(console, saved);
    }
    return sent;
}

db.getServerStats = async () => [
    { user: "REQ", successful: 20, avgHi: 300, firstHi: 0, lastHi: 0 },
    { user: "222", successful: 12, avgHi: 100, firstHi: 0, lastHi: 0 }
];
db.getUserStats = async (user) => ({ user: user, successful: 3, avgHi: 0, firstHi: 86400000, lastHi: 0 });
db.getHi = async () => ({
    longestChain: { count: 6, participants: { A: 6 }, startedAt: 0, endedAt: 1 },
    preChain: { count: 159, participants: { B: 159 }, startedAt: 0, endedAt: 1 },
    currentChain: { count: 3 }
});

test("stats: a mention (either form) looks up that user, and only the requester can be pinged", async () => {
    for (const arg of ["<@222>", "<@!222>"]) {
        const sent = await run("<@BOT> stats " + arg);
        assert.equal(sent.length, 1, arg);
        assert.match(sent[0].content, /^<@222>'s hi stats/, arg);
        assert.deepEqual(sent[0].allowedMentions, { users: ["REQ"] });
    }
});

test("stats with no argument is the requester's own; my-stats is an alias", async () => {
    for (const name of ["stats", "my-stats"]) {
        const sent = await run("<@BOT> " + name);
        assert.match(sent[0].content, /^<@REQ> your hi stats/, name);
    }
});

test("first, top and chain (and their aliases) reach their handlers", async () => {
    assert.match((await run("<@BOT> first"))[0].content, /first hi here was/);
    assert.match((await run("<@BOT> firsthi <@222>"))[0].content, /^<@222>'s first hi/);
    assert.match((await run("<@BOT> top"))[0].content, /top hi-ers in this server/);
    assert.match((await run("<@BOT> top-stats average"))[0].content, /most consistent hi-ers/);
    assert.match((await run("<@BOT> chain"))[0].content, /longest hi chain in this server: 6/);
    assert.match((await run("<@BOT> longest-chain prebot"))[0].content, /golden age\): 159/);
});

test("anything that isn't a command for the bot is ignored", async () => {
    assert.deepEqual(await run("hi"), []);
    assert.deepEqual(await run("<@SOMEONE> stats"), []);
    assert.deepEqual(await run("<@BOT> dance"), []);
    //not the bot admin (DEV is unset), so a DM does nothing
    assert.deepEqual(await run("status WATCHING #hi", { type: ChannelType.DM }), []);
});

const events = () => logged.map((e) => [e.level, e.event]);

test("a command that ran is logged with who, where and what they typed", async () => {
    await run("<@BOT> top average");
    assert.deepEqual(events(), [["info", "command.run"]]);
    assert.equal(logged[0].msg, "kingnoskcaj ran @HiBot top average");
    assert.deepEqual(logged[0].meta, { command: "top", args: "average", via: "text", guild: "g", guildName: "Test Server", user: "REQ", userTag: "kingnoskcaj" });
    //aliases are logged under the command's own name
    await run("<@BOT> longest-chain prebot");
    assert.equal(logged[0].meta.command, "chain");
});

test("output: a server admin runs it (the channel id is taken from the mention), anyone else is denied and logged", async () => {
    const saved = admin.setOutputChannel;
    const calls = [];
    admin.setOutputChannel = async (...a) => { calls.push(a); };
    try {
        await run("<@BOT> output <#555>", { admin: true });
        assert.deepEqual(events(), [["info", "command.run"]]);
        assert.deepEqual(calls, [[client, "g", "555"]]);

        calls.length = 0;
        await run("<@BOT> output <#555>");
        assert.deepEqual(events(), [["warn", "command.denied"]]);
        assert.deepEqual(calls, []);
    } finally {
        admin.setOutputChannel = saved;
    }
});

test("output with no channel fails inside the command: logged as command.failed, nothing thrown", async () => {
    await run("<@BOT> output", { admin: true });
    assert.deepEqual(events(), [["info", "command.run"], ["error", "command.failed"]]);
});

test("pic and status: the bot admin runs them, everyone else (even a server admin) is denied; guild admins can't", async () => {
    const saved = admin.adminCommand;
    const calls = [];
    admin.adminCommand = (...a) => { calls.push(a.slice(1, 3)); };
    const savedDev = process.env.DEV;
    try {
        await run("<@BOT> pic http://x/y.png", { admin: true });
        assert.deepEqual(events(), [["warn", "command.denied"]]);
        assert.deepEqual(calls, []);

        process.env.DEV = "REQ";
        await run("<@BOT> status WATCHING #hi");
        assert.deepEqual(events(), [["info", "command.run"]]);
        assert.deepEqual(calls, [["status", ["WATCHING", "#hi"]]]);
    } finally {
        admin.adminCommand = saved;
        if (savedDev === undefined) delete process.env.DEV; else process.env.DEV = savedDev;
    }
});

test("DMs: only the bot admin's pic/status run; a stranger's attempt is denied, other DMs are ignored", async () => {
    const saved = admin.adminCommand;
    const calls = [];
    admin.adminCommand = (...a) => { calls.push(a.slice(1, 3)); };
    const savedDev = process.env.DEV;
    try {
        await run("pic http://x/y.png", { type: ChannelType.DM });
        assert.deepEqual(events(), [["warn", "command.denied"]]);
        await run("hello", { type: ChannelType.DM });
        assert.deepEqual(events(), []);

        process.env.DEV = "REQ";
        await run("pic http://x/y.png", { type: ChannelType.DM });
        assert.deepEqual(events(), [["info", "command.run"]]);
        assert.equal(logged[0].msg, "kingnoskcaj ran pic http://x/y.png (DM)");
        assert.deepEqual(calls, [["pic", ["http://x/y.png"]]]);
        await run("hello", { type: ChannelType.DM });
        assert.deepEqual(events(), [["debug", "command.unknown"]]);
    } finally {
        admin.adminCommand = saved;
        if (savedDev === undefined) delete process.env.DEV; else process.env.DEV = savedDev;
    }
});

test("an unknown word after the mention is a debug log and no reply", async () => {
    const sent = await run("<@BOT> dance");
    assert.deepEqual(sent, []);
    assert.deepEqual(events(), [["debug", "command.unknown"]]);
});
