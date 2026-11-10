const { test } = require("node:test");
const assert = require("node:assert");
const EventEmitter = require("events");
const { MessageFlags, PermissionFlagsBits } = require("discord.js");
const log = require("../src/logging");
const db = require("../src/data/db");
const admin = require("../src/commands/admin");
const interactionCreate = require("../src/events/interactionCreate");

const logged = [];
log.addSink({ name: "interaction-test", defaultLevel: "debug", write: (e) => logged.push(e) });

async function quietly(fn) {
    const saved = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = () => {};
    logged.length = 0;
    try {
        return await fn();
    } finally {
        Object.assign(console, saved);
    }
}

const client = { user: { id: "BOT" } };

// a chat-input interaction that records every call made on it
function makeInteraction(commandName, opts) {
    opts = opts || {};
    const calls = [];
    const i = {
        calls: calls,
        commandName: commandName,
        user: { id: "REQ", tag: "kingnoskcaj" },
        guildId: "g1",
        guild: { id: "g1", name: "Test Server" },
        memberPermissions: { has: (p) => !!opts.admin && p === PermissionFlagsBits.Administrator },
        options: {
            data: opts.data || [],
            getUser: () => null,
            getString: (n) => (opts.strings || {})[n] || null,
            getChannel: () => opts.channel || null
        },
        isChatInputCommand: () => opts.chatInput !== false,
        reply: async (p) => { calls.push(["reply", p]); },
        deferReply: async (p) => { if (opts.deferFails) throw new Error("Unknown interaction"); calls.push(["deferReply", p]); },
        editReply: async (p) => { calls.push(["editReply", p]); },
        followUp: async (p) => { calls.push(["followUp", p]); }
    };
    return i;
}

test("things that aren't slash commands are ignored", async () => {
    const i = makeInteraction("stats", { chatInput: false });
    await quietly(() => interactionCreate.handle(i, client));
    assert.deepEqual(i.calls, []);
    assert.deepEqual(logged, []);
});

test("a public command defers (not ephemeral), runs the shared handler, edits the reply, only pings the requester", async () => {
    db.getServerStats = async () => [{ user: "REQ", successful: 5, avgHi: 0, lastHi: 0 }];
    const i = makeInteraction("top", { strings: { board: "his" }, data: [{ name: "board", value: "his" }] });
    await quietly(() => interactionCreate.handle(i, client));
    assert.deepEqual(i.calls[0], ["deferReply", {}]);
    assert.equal(i.calls[1][0], "editReply");
    assert.match(i.calls[1][1].content, /top hi-ers in this server/);
    assert.deepEqual(i.calls[1][1].allowedMentions, { users: ["REQ"] });
    assert.equal(i.calls.length, 2);
    assert.deepEqual(logged.map((e) => [e.event, e.msg]), [["command.run", "kingnoskcaj ran /top board:his"]]);
    assert.equal(logged[0].meta.via, "slash");
    assert.equal(logged[0].meta.guildName, "Test Server");
});

test("output: an admin gets an ephemeral deferral and the channel is set", async () => {
    const saved = admin.setOutputChannel;
    let call;
    admin.setOutputChannel = async (...a) => { call = a; };
    const i = makeInteraction("output", { admin: true, channel: { id: "c9" }, data: [{ name: "channel", value: "c9" }] });
    try {
        await quietly(() => interactionCreate.handle(i, client));
    } finally {
        admin.setOutputChannel = saved;
    }
    assert.deepEqual(i.calls[0], ["deferReply", { flags: MessageFlags.Ephemeral }]);
    assert.deepEqual(call, [client, "g1", "c9"]);
    assert.equal(i.calls[1][1].content, "output channel set to <#c9>");
    assert.deepEqual(logged.map((e) => e.event), ["command.run"]);
});

test("output: someone who isn't a server admin is refused, logged, and nothing is changed", async () => {
    const saved = admin.setOutputChannel;
    let called = false;
    admin.setOutputChannel = async () => { called = true; };
    const i = makeInteraction("output", { admin: false, channel: { id: "c9" } });
    try {
        await quietly(() => interactionCreate.handle(i, client));
    } finally {
        admin.setOutputChannel = saved;
    }
    assert.equal(called, false);
    assert.deepEqual(i.calls, [["reply", { content: "you need to be a server admin to use that", flags: MessageFlags.Ephemeral }]]);
    assert.deepEqual(logged.map((e) => [e.level, e.event]), [["warn", "command.denied"]]);
});

test("an unknown command name gets an ephemeral reply and a debug log", async () => {
    const i = makeInteraction("pic");
    await quietly(() => interactionCreate.handle(i, client));
    assert.deepEqual(i.calls, [["reply", { content: "I don't know that command", flags: MessageFlags.Ephemeral }]]);
    assert.deepEqual(logged.map((e) => [e.level, e.event]), [["debug", "command.unknown"]]);
});

test("a handler that fails is logged, and the user is told instead of being left on 'thinking...'", async () => {
    db.getServerStats = async () => { throw new Error("mongo down"); };
    const i = makeInteraction("stats");
    await quietly(() => interactionCreate.handle(i, client));
    assert.deepEqual(i.calls.map((c) => c[0]), ["deferReply", "editReply"]);
    assert.equal(i.calls[1][1].content, "something went wrong, please try again");
    assert.deepEqual(logged.map((e) => [e.level, e.event]), [["info", "command.run"], ["error", "command.failed"]]);
});

test("register: an interaction that can't be answered (e.g. it expired) is logged, not thrown", async () => {
    const client2 = Object.assign(new EventEmitter(), { user: { id: "BOT" } });
    interactionCreate.register(client2);
    const i = makeInteraction("stats", { deferFails: true });
    await quietly(async () => {
        client2.emit("interactionCreate", i);
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    assert.deepEqual(logged.map((e) => [e.level, e.event]), [["error", "command.failed"]]);
    assert.match(logged[0].msg, /Unknown interaction/);
});
