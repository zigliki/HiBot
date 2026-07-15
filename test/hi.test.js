const { test } = require("node:test");
const assert = require("node:assert");
const hi = require("../hi");

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
