const { test } = require("node:test");
const assert = require("node:assert");
const hi = require("../src/game/hi");

const DAY = 86400000;
const BOT = "BOT";

test("advanceChain: builds a chain and snapshots the longest", () => {
    const data = {};
    hi.advanceChain(data, "A", 0, BOT);
    hi.advanceChain(data, "B", DAY, BOT);
    hi.advanceChain(data, "A", 2 * DAY, BOT);
    assert.equal(data.currentChain.count, 3);
    assert.equal(data.longestChain.count, 3);
    assert.deepEqual(data.longestChain.participants, { A: 2, B: 1 });
    assert.equal(data.longestChain.startedAt, 0);
    assert.equal(data.longestChain.endedAt, 2 * DAY);
});

test("advanceChain: a bot revival resets the current chain, keeps the longest, and never becomes a participant", () => {
    const data = {};
    hi.advanceChain(data, "A", 0, BOT);
    hi.advanceChain(data, "B", DAY, BOT);
    hi.advanceChain(data, BOT, 2 * DAY, BOT); // revival
    assert.equal(data.currentChain.count, 0);
    assert.equal(data.longestChain.count, 2);
    assert.ok(!(BOT in data.longestChain.participants));
    // a human hi after the revival starts a fresh chain
    hi.advanceChain(data, "A", 3 * DAY, BOT);
    assert.equal(data.currentChain.count, 1);
});

test("advanceChain: default 7-day gap breaks the chain, shorter gaps don't", () => {
    const data = {};
    hi.advanceChain(data, "A", 0, BOT);
    hi.advanceChain(data, "B", 6 * DAY, BOT);   // 6d gap (<7d) -> continues
    assert.equal(data.currentChain.count, 2);
    hi.advanceChain(data, "A", 13 * DAY, BOT);  // 7d gap (>=7d) -> breaks
    assert.equal(data.currentChain.count, 1);
    assert.equal(data.longestChain.count, 2);
});

test("advanceChain: a tighter custom gap threshold breaks sooner (pre-HiBot golden age)", () => {
    const data = {};
    hi.advanceChain(data, "A", 0, BOT, 2 * DAY);
    hi.advanceChain(data, "B", DAY, BOT, 2 * DAY);      // 1d (<2d) -> continues
    assert.equal(data.currentChain.count, 2);
    hi.advanceChain(data, "A", 4 * DAY, BOT, 2 * DAY);  // 3d (>=2d) -> breaks
    assert.equal(data.currentChain.count, 1);
    assert.equal(data.longestChain.count, 2);
});

// checkHi log lines (HIB-33): drive it with stubbed db/message and read what it logged
const db = require("../src/data/db");
const log = require("../src/logging");

const logged = [];
log.addSink({ name: "hi-test", defaultLevel: "debug", write: (e) => logged.push(e) });

function runCheckHi({ content, createdTimestamp, data, userId, botId }) {
    const saved = { getHi: db.getHi, setHi: db.setHi, recordHi: db.recordHi };
    db.getHi = async () => data;
    db.setHi = () => {};
    db.recordHi = () => {};
    const silent = { log: console.log };
    console.log = () => {};
    logged.length = 0;
    let deleted = 0;
    const msg = {
        content, createdTimestamp, delete: () => { deleted++; },
        channel: { name: "hi", id: "c1" },
        guild: { id: "g1", name: "Test Server", channels: { cache: { find: () => undefined } } },
        member: { user: { id: userId || "u1", tag: "kingnoskcaj" } }
    };
    return hi.checkHi(msg, { user: { id: botId || "bot1" } }).then(() => {
        Object.assign(db, saved);
        console.log = silent.log;
        return { deleted, lines: logged.filter((e) => e.level === "info") };
    });
}

test("checkHi logs one sentence per outcome, tagged with the guild", async (t) => {
    //schedulePing arms a 7 day timer: mock it so the test doesn't wait on it
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const fresh = { server: "g1", lastUser: "u2", nextHi: 0, lastHi: 0 };
    const valid = await runCheckHi({ content: "hi", createdTimestamp: 1000, data: Object.assign({}, fresh) });
    assert.deepEqual(valid.lines.map((e) => [e.event, e.msg]), [["hi.valid", "kingnoskcaj said hi"]]);
    assert.deepEqual(valid.lines[0].meta, { guild: "g1", guildName: "Test Server", user: "u1", userTag: "kingnoskcaj" });

    const soon = await runCheckHi({ content: "hi", createdTimestamp: 1000, data: Object.assign({}, fresh, { nextHi: 5000 }) });
    assert.deepEqual(soon.lines.map((e) => [e.event, e.msg]), [["hi.rejected.toosoon", "kingnoskcaj said hi too soon, deleted it"]]);
    assert.equal(soon.deleted, 1);

    const twice = await runCheckHi({ content: "hi", createdTimestamp: 1000, data: Object.assign({}, fresh, { lastUser: "u1" }) });
    assert.deepEqual(twice.lines.map((e) => [e.event, e.msg]), [["hi.rejected.sameuser", "kingnoskcaj said hi twice in a row, deleted it"]]);

    const notHi = await runCheckHi({ content: "hello", createdTimestamp: 1000, data: Object.assign({}, fresh) });
    assert.deepEqual(notHi.lines.map((e) => [e.event, e.msg]), [["hi.rejected.nothi", "kingnoskcaj said something that isn't hi, deleted it"]]);
    assert.equal(notHi.deleted, 1);
});

test("checkHi: the bot's own ping hi is logged as HiBot", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const fresh = { server: "g1", lastUser: "u2", nextHi: 0, lastHi: 0 };
    const ping = await runCheckHi({ content: "hi", createdTimestamp: 1000, data: fresh, userId: "bot1", botId: "bot1" });
    assert.deepEqual(ping.lines.map((e) => [e.event, e.msg]), [["hi.valid", "HiBot said hi (ping)"]]);
});
