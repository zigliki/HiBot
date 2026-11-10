const { test } = require("node:test");
const assert = require("node:assert");
const { ChannelType } = require("discord.js");
const db = require("../src/data/db");
const router = require("../src/commands/router");

const client = { user: { id: "BOT" } };

// a guild message as the router sees it; replies are collected in `sent`
function mkMessage(content, sent, opts) {
    opts = opts || {};
    return {
        content: content,
        author: { id: "REQ" },
        channel: { type: opts.type === undefined ? ChannelType.GuildText : opts.type, send: async (o) => { sent.push(o); } },
        member: { user: { id: "REQ" }, permissions: { has: () => false } },
        guild: { id: "g" }
    };
}

// botCommands doesn't await the handlers, so let them settle before looking at what was sent
async function run(content, opts) {
    const sent = [];
    router.botCommands(mkMessage(content, sent, opts), client);
    await new Promise((resolve) => setImmediate(resolve));
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
