const { test } = require("node:test");
const assert = require("node:assert");
const { Collection, PermissionFlagsBits, Routes } = require("discord.js");
const { createLogger } = require("../src/logging");
const db = require("../src/data/db");
const guildInfo = require("../src/discord/guildInfo");
const guildCreate = require("../src/events/guildCreate");
const guildDelete = require("../src/events/guildDelete");
const log = require("../src/logging");

// a guild stub: channels is a real discord.js Collection; `perms` is the list of permissions the bot has in #hi
function makeGuild({ id = "g1", name = "Test Server", channels = [], perms = "all", fetchMe, put } = {}) {
    const cache = new Collection(channels.map((c) => [c.id, c]));
    const all = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory];
    const have = perms === "all" ? all : perms;
    cache.forEach((c) => { c.permissionsFor = () => ({ has: (p) => have.includes(p) }); });
    // client.rest.put is what registers the slash commands on join; `puts` records what was sent
    const puts = [];
    const client = {
        application: { id: "APP" },
        rest: { put: async (route, opts) => { puts.push([route, opts.body.map((c) => c.name)]); return put ? put(route, opts) : opts.body; } }
    };
    return { id, name, memberCount: 42, channels: { cache }, members: { fetchMe: fetchMe || (async () => ({ id: "bot" })) }, client, puts };
}

const HI = { id: "c1", name: "hi" };
const CONTROL = { id: "c2", name: "bot-control" };

// a logger that records what it was given (no console noise)
function recorder() {
    const lines = [];
    const logger = createLogger({ env: {} });
    logger.addSink({ name: "rec", defaultLevel: "debug", write: (e) => lines.push(e) });
    return { logger, lines };
}

test("describeGuild: a healthy server has no problems", async () => {
    const info = await guildInfo.describeGuild(makeGuild({ channels: [{ ...HI }, { ...CONTROL }] }), "c2");
    assert.deepEqual(info, { members: 42, hiChannel: { id: "c1", name: "hi" }, botControl: { id: "c2", name: "bot-control" }, problems: [] });
});

test("describeGuild: names each missing permission in #hi", async () => {
    const perms = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
    const info = await guildInfo.describeGuild(makeGuild({ channels: [{ ...HI }, { ...CONTROL }], perms }), "c2");
    assert.deepEqual(info.problems, ["missing permissions in #hi: Manage Messages, Read Message History"]);
});

test("describeGuild: no #hi channel (and the bot member isn't even fetched)", async () => {
    let fetched = false;
    const guild = makeGuild({ channels: [{ ...CONTROL }], fetchMe: async () => { fetched = true; return {}; } });
    const info = await guildInfo.describeGuild(guild, "c2");
    assert.equal(info.hiChannel, null);
    assert.deepEqual(info.problems, ["no #hi channel"]);
    assert.equal(fetched, false);
});

test("describeGuild: bot-control not set vs set to a channel that's gone", async () => {
    const guild = makeGuild({ channels: [{ ...HI }] });
    const notSet = await guildInfo.describeGuild(guild, undefined);
    assert.match(notSet.problems[0], /^no bot-control channel set/);
    const gone = await guildInfo.describeGuild(guild, "c999");
    assert.deepEqual(gone.problems, ["the bot-control channel no longer exists"]);
    assert.equal(gone.botControl, null);
});

test("logGuild: one guild.info line with the guild tag, then one guild.problem warning per problem", async () => {
    const { logger, lines } = recorder();
    await guildInfo.logGuild(makeGuild({ channels: [{ ...HI }] }), undefined, logger);
    assert.deepEqual(lines.map((e) => [e.level, e.event]), [["info", "guild.info"], ["warn", "guild.problem"]]);
    assert.equal(lines[0].msg, "42 members, #hi ok, no bot-control channel");
    assert.deepEqual(lines[0].meta, { members: 42, hiChannel: { id: "c1", name: "hi" }, botControl: null, guild: "g1", guildName: "Test Server" });
    assert.deepEqual(lines[1].meta, { guild: "g1", guildName: "Test Server" });
});

test("logAll: logs every server with its stored bot-control id; one failure doesn't skip the rest", async () => {
    const { logger, lines } = recorder();
    const good = makeGuild({ id: "g1", name: "Good", channels: [{ ...HI }, { ...CONTROL }] });
    const broken = makeGuild({ id: "g2", name: "Broken", channels: [{ ...HI }], fetchMe: async () => { throw new Error("Missing Access"); } });
    const last = makeGuild({ id: "g3", name: "Last", channels: [{ ...HI }, { ...CONTROL }] });
    const client = { guilds: { cache: new Collection([["g1", good], ["g2", broken], ["g3", last]]) } };
    const saved = db.getAllServers;
    db.getAllServers = async () => [{ server: "g1", botControl: "c2" }, { server: "g2", botControl: "c2" }, { server: "g3", botControl: "c2" }];
    try {
        await guildInfo.logAll(client, logger);
    } finally {
        db.getAllServers = saved;
    }
    assert.deepEqual(lines.map((e) => e.event + ":" + e.meta.guildName), ["guild.info:Good", "guild.info.failed:Broken", "guild.info:Last"]);
    assert.match(lines[1].msg, /Missing Access/);
});

test("logAll: a db failure is a warning, not a crash", async () => {
    const { logger, lines } = recorder();
    const saved = db.getAllServers;
    db.getAllServers = async () => { throw new Error("mongo down"); };
    try {
        await guildInfo.logAll({ guilds: { cache: new Collection() } }, logger);
    } finally {
        db.getAllServers = saved;
    }
    assert.deepEqual(lines.map((e) => [e.level, e.event]), [["warn", "guild.info.failed"]]);
});

// guildCreate / guildDelete handlers use the real logger: capture it and keep the console quiet
const logged = [];
log.addSink({ name: "guild-test", defaultLevel: "debug", write: (e) => logged.push(e) });

async function quietly(fn) {
    const saved = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = () => {};
    logged.length = 0;
    try {
        await fn();
    } finally {
        Object.assign(console, saved);
    }
}

test("guildCreate: saves the bot-control channel's ID (not the channel object), then logs the server info", async () => {
    const saved = { newServer: db.newServer, getHi: db.getHi };
    let args;
    db.newServer = async (...a) => { args = a; };
    db.getHi = async () => ({ botControl: "c2" });
    try {
        await quietly(() => guildCreate.handle(makeGuild({ channels: [{ ...HI }, { ...CONTROL }] })));
    } finally {
        Object.assign(db, saved);
    }
    assert.deepEqual(args, ["g1", "c2"]);
    assert.equal(typeof args[1], "string");
    assert.deepEqual(logged.map((e) => e.event), ["guild.joined", "guild.info", "commands.registered"]);
});

test("guildCreate: no bot-control channel is stored as undefined; a db failure is logged, not thrown", async () => {
    const saved = { newServer: db.newServer, getHi: db.getHi };
    let args;
    db.newServer = async (...a) => { args = a; throw new Error("insert failed"); };
    try {
        await quietly(() => guildCreate.handle(makeGuild({ channels: [{ ...HI }] })));
    } finally {
        Object.assign(db, saved);
    }
    assert.deepEqual(args, ["g1", undefined]);
    assert.deepEqual(logged.map((e) => [e.level, e.event]), [["info", "guild.joined"], ["error", "guild.join.failed"], ["info", "commands.registered"]]);
    assert.match(logged[1].msg, /insert failed/);
});

test("guildCreate: joining registers that server's slash commands (the main set for a normal server)", async () => {
    const saved = { newServer: db.newServer, getHi: db.getHi };
    db.newServer = async () => {};
    db.getHi = async () => ({ botControl: "c2" });
    const guild = makeGuild({ id: "NEW", channels: [{ ...HI }, { ...CONTROL }] });
    try {
        await quietly(() => guildCreate.handle(guild));
    } finally {
        Object.assign(db, saved);
    }
    assert.deepEqual(guild.puts, [[Routes.applicationGuildCommands("APP", "NEW"), ["stats", "first", "top", "chain", "output"]]]);
    assert.deepEqual(logged.filter((e) => e.event === "commands.registered").map((e) => e.msg), ["registered 5 slash commands"]);
});

test("guildCreate: a failed command registration is a warning and the rest of the join setup still happens", async () => {
    const saved = { newServer: db.newServer, getHi: db.getHi };
    let stored = false;
    db.newServer = async () => { stored = true; };
    db.getHi = async () => ({ botControl: "c2" });
    const guild = makeGuild({ channels: [{ ...HI }, { ...CONTROL }], put: async () => { throw new Error("Missing Access"); } });
    try {
        await quietly(() => guildCreate.handle(guild));
    } finally {
        Object.assign(db, saved);
    }
    assert.equal(stored, true);
    assert.deepEqual(logged.map((e) => [e.level, e.event]), [["info", "guild.joined"], ["info", "guild.info"], ["warn", "commands.register.failed"]]);
    assert.match(logged[2].msg, /Missing Access/);
    assert.equal(logged[2].meta.guild, "g1");
});

test("guildDelete: logs that the bot left, tagged with the server", async () => {
    await quietly(() => guildDelete.handle(makeGuild({ id: "g9", name: "Gone Server" })));
    assert.deepEqual(logged.map((e) => [e.event, e.msg]), [["guild.left", "the bot left a server"]]);
    assert.deepEqual(logged[0].meta, { guild: "g9", guildName: "Gone Server" });
});
