const { test } = require("node:test");
const assert = require("node:assert");
const { createLogger } = require("../log");
const { createMongoSink } = require("../logMongo");

const DAY = Date.parse("2026-11-10T00:00:00Z");

// logger + mongo sink wired to a stub bucket writer. the interval is huge so only explicit flushes write.
function setup(opts) {
    const writes = [];
    const reports = [];
    const clock = { t: DAY + 12 * 3600000 };
    const sink = createMongoSink(Object.assign({
        writeBucket: async (filter, update) => { writes.push({ filter, update }); },
        machine: "m1",
        report: (m) => reports.push(m),
        flushIntervalMs: 1e9,
        now: () => new Date(clock.t)
    }, opts));
    const log = createLogger({ env: {}, now: () => new Date(clock.t), boot: "b1" });
    log.addSink(sink);
    return { writes, reports, clock, sink, log };
}

test("nothing is written until the DB is ready; queued lines go out on setReady", async () => {
    const { writes, sink, log } = setup();
    log.info("a", "one");
    log.info("b", "two");
    await sink.flush();
    assert.equal(writes.length, 0);
    assert.equal(sink.pending(), 2);
    sink.setReady();
    await sink.flush();
    sink.stop();
    assert.equal(writes.length, 1);
    assert.equal(sink.pending(), 0);
});

test("one bucket per boot/day/part: filter, $push lines, counters, $min/$max, $setOnInsert machine", async () => {
    const { writes, sink, log, clock } = setup();
    sink.setReady();
    log.info("hi.valid", "ok", { user: "u1" });
    clock.t += 1000;
    log.warn("shard.disconnect", "dropped");
    clock.t += 1000;
    log.error("fatal", "boom");
    await sink.flush();
    sink.stop();
    assert.equal(writes.length, 1);
    const { filter, update } = writes[0];
    assert.deepEqual(filter, { boot: "b1", day: new Date(DAY), part: 0 });
    assert.deepEqual(update.$inc, { n: 3, warns: 1, errors: 1 });
    assert.deepEqual(update.$min, { firstTs: new Date(DAY + 12 * 3600000) });
    assert.deepEqual(update.$max, { lastTs: new Date(DAY + 12 * 3600000 + 2000) });
    assert.deepEqual(update.$setOnInsert, { machine: "m1" });
    const lines = update.$push.lines.$each;
    assert.deepEqual(lines.map((l) => [l.event, l.level, l.lvl, l.seq]), [["hi.valid", "info", 20, 1], ["shard.disconnect", "warn", 30, 2], ["fatal", "error", 40, 3]]);
    assert.deepEqual(lines[0].meta, { user: "u1" });
    assert.equal(lines[1].meta, undefined);
    assert.equal("boot" in lines[0], false, "boot lives on the bucket, not each line");
});

test("a batch that straddles midnight is written as two day buckets, oldest first", async () => {
    const { writes, sink, log, clock } = setup();
    sink.setReady();
    clock.t = DAY - 1000;            // 23:59:59 the day before
    log.info("a", "late");
    clock.t = DAY + 1000;            // just after midnight
    log.info("b", "early");
    await sink.flush();
    sink.stop();
    assert.deepEqual(writes.map((w) => w.filter.day.getTime()), [DAY - 86400000, DAY]);
    assert.equal(writes[0].update.$push.lines.$each[0].event, "a");
    assert.equal(writes[1].update.$push.lines.$each[0].event, "b");
});

test("rolls to a new part once a bucket passes the byte threshold", async () => {
    const { writes, sink, log } = setup({ rollBytes: 300 });
    sink.setReady();
    for (let i = 0; i < 3; i++) {
        log.info("e", "x".repeat(200));
        await sink.flush();          // one write per flush, each ~250 bytes
    }
    sink.stop();
    assert.deepEqual(writes.map((w) => w.filter.part), [0, 1, 2]);
});

test("a failed write is retried in order, reported once, and recovery is reported", async () => {
    let failing = true;
    const writes = [];
    const { reports, sink, log } = setup({
        writeBucket: async (filter, update) => {
            if (failing) throw new Error("mongo down");
            writes.push({ filter, update });
        }
    });
    sink.setReady();
    log.info("a", "1");
    log.info("b", "2");
    await sink.flush();
    log.info("c", "3");
    await sink.flush();
    assert.equal(sink.pending(), 3);
    assert.equal(reports.length, 1, "reported once per outage, not on every retry");
    assert.match(reports[0], /mongo down/);
    failing = false;
    await sink.flush();
    sink.stop();
    assert.equal(sink.pending(), 0);
    assert.deepEqual(writes[0].update.$push.lines.$each.map((l) => l.event), ["a", "b", "c"]);
    assert.match(reports[1], /recovered/);
});

test("queue is capped (oldest dropped) and a log.dropped marker is written on recovery", async () => {
    let failing = true;
    const writes = [];
    const { sink, log } = setup({
        maxQueue: 3,
        writeBucket: async (filter, update) => {
            if (failing) throw new Error("down");
            writes.push(update.$push.lines.$each);
        }
    });
    sink.setReady();
    for (let i = 1; i <= 5; i++) log.info("e" + i, "m");
    assert.equal(sink.pending(), 3);
    await sink.flush();
    failing = false;
    await sink.flush();
    sink.stop();
    const all = writes.flat().map((l) => l.event);
    assert.deepEqual(all, ["e3", "e4", "e5", "log.dropped"]);
    assert.equal(writes.flat().pop().meta.dropped, 2);
});

test("meta that can't be serialised is replaced so it can't jam the queue", async () => {
    const { writes, sink, log } = setup();
    sink.setReady();
    const circular = {};
    circular.self = circular;
    log.info("bad", "m", circular);
    log.info("good", "m");
    await sink.flush();
    sink.stop();
    const lines = writes[0].update.$push.lines.$each;
    assert.deepEqual(lines[0].meta, { unserializable: true });
    assert.equal(lines[1].event, "good");
});

test("flush waits for a flush already in progress, then writes what arrived meanwhile", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const writes = [];
    let first = true;
    const { sink, log } = setup({
        writeBucket: async (filter, update) => {
            if (first) { first = false; await gate; }
            writes.push(update.$push.lines.$each.map((l) => l.event));
        }
    });
    log.info("a", "1");
    sink.setReady();                 // starts a flush that blocks on the gate
    log.info("b", "2");              // arrives while that flush is in flight
    const done = sink.flush();
    release();
    await done;
    sink.stop();
    assert.deepEqual(writes.flat(), ["a", "b"]);
    assert.equal(sink.pending(), 0);
});

test("a write that reaches the batch size flushes without waiting for the timer", async () => {
    const { writes, sink, log } = setup({ batchSize: 3 });
    sink.setReady();
    log.info("a", "1");
    log.info("b", "2");
    log.info("c", "3");              // hits batchSize
    await sink.flush();
    sink.stop();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].update.$inc.n, 3);
});
