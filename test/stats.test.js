const { test } = require("node:test");
const assert = require("node:assert");
const db = require("../db");
const stats = require("../commands/stats");

const DAY = 86400000;
const client = { user: { id: "BOT" } };

// mock message; channel.send captures (content, options) so we can assert
// output text AND that allowedMentions pings only the requester
function mkMsg(userId, sink) {
    return {
        member: { user: { id: userId } },
        guild: { id: "g", members: { cache: { get: () => undefined } } },
        channel: { send: (content, opts) => sink.push({ content, opts }) }
    };
}

test("getUserStats: rank + % share, pings only the requester", async () => {
    db.getServerStats = async () => [
        { user: "A", successful: 10, avgHi: 0, lastHi: 0 },
        { user: "REQ", successful: 5, avgHi: 0, lastHi: 0 },
        { user: "C", successful: 5, avgHi: 0, lastHi: 0 }
    ];
    const out = [];
    await stats.getUserStats(mkMsg("REQ", out), client, undefined);
    assert.match(out[0].content, /rank: #2 of 3/);
    assert.match(out[0].content, /share: 25\.0% of this server's hi's/); // 5 / 20
    assert.deepEqual(out[0].opts.allowedMentions.users, ["REQ"]);
});

test("getUserStats: `@user` looks up someone else (third person), still pings only requester", async () => {
    // exercises parseUserId (both mention forms) through the public command
    db.getServerStats = async () => [
        { user: "111", successful: 10, avgHi: 0, lastHi: 0 },
        { user: "222", successful: 4, avgHi: 0, lastHi: 0 }
    ];
    for (const arg of ["<@222>", "<@!222>"]) {
        const out = [];
        await stats.getUserStats(mkMsg("111", out), client, arg);
        assert.match(out[0].content, /^<@222>'s hi stats/, "arg " + arg);
        assert.deepEqual(out[0].opts.allowedMentions.users, ["111"]);
    }
});

test("getTop his: ranks by count, renders everyone as a mention", async () => {
    db.getServerStats = async () => [
        { user: "A", successful: 20, avgHi: 300 },
        { user: "B", successful: 15, avgHi: 100 },
        { user: "C", successful: 12, avgHi: 200 }
    ];
    const out = [];
    await stats.getTop(mkMsg("A", out), client, "his");
    assert.match(out[0].content, /1\. <@A> - 20 hi's \(you\)/);
    assert.match(out[0].content, /2\. <@B> - 15 hi's/);
    assert.deepEqual(out[0].opts.allowedMentions.users, ["A"]);
});

test("getTop average: sorts by avgHi asc and excludes users with < 10 hi's", async () => {
    db.getServerStats = async () => [
        { user: "A", successful: 20, avgHi: 300 },
        { user: "B", successful: 15, avgHi: 100 }, // lowest gap -> first
        { user: "C", successful: 9, avgHi: 1 }      // < 10 hi's -> excluded
    ];
    const out = [];
    await stats.getTop(mkMsg("A", out), client, "average");
    assert.match(out[0].content, /1\. <@B>/);
    assert.doesNotMatch(out[0].content, /<@C>/);
});

test("getTop: appends the requester's own rank when they're outside the top 5", async () => {
    const board = [];
    for (let i = 0; i < 7; i++) board.push({ user: "U" + i, successful: 70 - i * 10, avgHi: 0 });
    db.getServerStats = async () => board;
    const out = [];
    await stats.getTop(mkMsg("U6", out), client, "his"); // U6 is rank 7
    assert.match(out[0].content, /\.\.\.\n7\. <@U6> - 10 hi's \(you\)/);
});

test("getTop: unknown board name gives a helpful message", async () => {
    db.getServerStats = async () => [{ user: "A", successful: 5, avgHi: 0 }];
    const out = [];
    await stats.getTop(mkMsg("A", out), client, "bogus");
    assert.match(out[0].content, /unknown leaderboard/);
});

test("getChain: `chain` shows the HiBot-era record; `chain prebot` shows the golden age", async () => {
    db.getHi = async () => ({
        longestChain: { count: 6, participants: { A: 6 }, startedAt: 0, endedAt: DAY },
        preChain: { count: 159, participants: { B: 159 }, startedAt: 0, endedAt: DAY },
        currentChain: { count: 3 }
    });
    let out = [];
    await stats.getChain(mkMsg("A", out), undefined);
    assert.match(out[0].content, /longest hi chain in this server: 6 hi's/);
    assert.match(out[0].content, /current chain: 3 hi's/);

    out = [];
    await stats.getChain(mkMsg("A", out), "prebot");
    assert.match(out[0].content, /golden age\): 159 hi's/);
    assert.doesNotMatch(out[0].content, /current chain/); // no current line for the golden view
});
