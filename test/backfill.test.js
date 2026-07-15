const { test } = require("node:test");
const assert = require("node:assert");
const db = require("../db");
const backfill = require("../tools/backfill");
const chainBackfill = require("../tools/chainBackfill");

const DAY = 86400000;
const BOT = "BOT";

// mock a discord.js text channel: messages.fetch pages once then returns empty
function mockBatch(msgs) {
    return { size: msgs.length, values: () => msgs[Symbol.iterator](), last: () => msgs[msgs.length - 1] };
}
function mockChannel(msgs) {
    return { guild: { id: "g" }, messages: { fetch: async ({ before }) => before ? mockBatch([]) : mockBatch(msgs) } };
}

test("collectValidHis: keeps only 'hi', drops back-to-back, applies REMAP, orders oldest-first", async () => {
    const DEATH = "128714146773598208";        // remaps -> vinhtage_gamer
    const VINH = "201560166397771776";
    const msgs = [
        { id: "1", author: { id: "H1", tag: "h1" }, content: "hi", createdTimestamp: 1 },
        { id: "2", author: { id: "H1", tag: "h1" }, content: "hi", createdTimestamp: 2 }, // back-to-back -> skip
        { id: "3", author: { id: "H2", tag: "h2" }, content: "hi", createdTimestamp: 3 },
        { id: "4", author: { id: "H1", tag: "h1" }, content: "yo", createdTimestamp: 4 }, // not "hi" -> skip
        { id: "5", author: { id: DEATH, tag: "d" }, content: "hi", createdTimestamp: 5 }  // remap -> VINH
    ];
    const r = await backfill.collectValidHis(mockChannel(msgs));
    assert.equal(r.rawCount, 5);
    assert.deepEqual(r.his.map(h => h.user), ["H1", "H2", VINH]);
});

test("chainBackfill: splits at the bot's first hi and applies era-specific gap thresholds", async () => {
    const msgs = [
        // pre-HiBot: a 4-chain (1-day gaps) then a 4-day gap (breaks under the 2-day rule)
        { id: "1", author: { id: "A" }, content: "hi", createdTimestamp: 0 },
        { id: "2", author: { id: "B" }, content: "hi", createdTimestamp: 1 * DAY },
        { id: "3", author: { id: "A" }, content: "hi", createdTimestamp: 2 * DAY },
        { id: "4", author: { id: "B" }, content: "hi", createdTimestamp: 3 * DAY },
        { id: "5", author: { id: "A" }, content: "hi", createdTimestamp: 7 * DAY },
        // HiBot era begins at the bot's first hi
        { id: "6", author: { id: BOT }, content: "hi", createdTimestamp: 100 * DAY },
        { id: "7", author: { id: "A" }, content: "hi", createdTimestamp: 101 * DAY },
        { id: "8", author: { id: "B" }, content: "hi", createdTimestamp: 102 * DAY },
        { id: "9", author: { id: "A" }, content: "hi", createdTimestamp: 103 * DAY },
        { id: "10", author: { id: "B" }, content: "hi", createdTimestamp: 104 * DAY },
        { id: "11", author: { id: "A" }, content: "hi", createdTimestamp: 105 * DAY }
    ];
    let wrote = null;
    db.setChains = async (server, current, longest, pre) => { wrote = { current, longest, pre }; };

    const r = await chainBackfill.runChainBackfill(mockChannel(msgs), BOT, { apply: true });

    assert.equal(r.era, 6);      // bot hi + 5 post-deploy his
    assert.equal(r.pre, 5);      // 5 pre-deploy his
    assert.equal(r.longest, 5);  // HiBot-era 5-chain (7-day gap never triggers)
    assert.equal(r.golden, 4);   // pre-HiBot 4-chain (the 4-day gap breaks it under 2-day rule)
    assert.equal(wrote.longest.count, 5);
    assert.equal(wrote.pre.count, 4);
});

test("chainBackfill (dry run): does not write", async () => {
    const msgs = [
        { id: "1", author: { id: BOT }, content: "hi", createdTimestamp: 0 },
        { id: "2", author: { id: "A" }, content: "hi", createdTimestamp: DAY }
    ];
    let wrote = false;
    db.setChains = async () => { wrote = true; };
    const r = await chainBackfill.runChainBackfill(mockChannel(msgs), BOT, { apply: false });
    assert.equal(r.applied, false);
    assert.equal(wrote, false);
});
