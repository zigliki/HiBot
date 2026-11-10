const { test } = require("node:test");
const assert = require("node:assert");
const { createLogger } = require("../src/logging");
const { createTopologyWatcher } = require("../src/data/db");

test("fatal logs, flushes every sink, then exits 1 - in that order, and only once", async () => {
    const order = [];
    const log = createLogger({ env: {}, exit: (code) => order.push("exit " + code) });
    log.addSink({
        name: "s", defaultLevel: "debug",
        write: (e) => order.push("write " + e.event),
        flush: async () => { await new Promise((r) => setImmediate(r)); order.push("flush"); }
    });
    await log.fatal("fatal", "boom", new Error("x"));
    await log.fatal("fatal", "second", null);
    assert.deepEqual(order, ["write fatal", "flush", "exit 1"]);
});

test("fatal still exits when a sink flush hangs (bounded by the flush timeout)", async () => {
    const order = [];
    const log = createLogger({ env: {}, fatalFlushMs: 30, exit: (code) => order.push("exit " + code) });
    log.addSink({ name: "hung", defaultLevel: "debug", write() {}, flush: () => new Promise(() => {}) });
    await log.fatal("fatal", "boom");
    assert.deepEqual(order, ["exit 1"]);
});

// fake topology event: servers is a Map of address -> { type }
function topo(types) {
    return { newDescription: { servers: new Map(types.map((t, i) => ["h" + i, { type: t }])) } };
}

test("topology watcher: logs db.offline / db.online on transitions only, with the outage length", () => {
    const lines = [];
    const logger = {
        warn: (event, msg, meta) => lines.push(["warn", event, msg, meta]),
        error: (event, msg) => lines.push(["error", event, msg])
    };
    let t = 1000;
    const w = createTopologyWatcher(logger, () => t);
    w.topologyChanged(topo(["Unknown", "Unknown", "Unknown"]));         // still connecting: silent
    w.topologyChanged(topo(["RSPrimary", "RSSecondary", "RSSecondary"])); // up: silent
    w.topologyChanged(topo(["RSPrimary", "RSSecondary", "Unknown"]));     // still has a primary: silent
    w.heartbeatFailed({ failure: { message: "connection timed out" } });
    t = 2000;
    w.topologyChanged(topo(["Unknown", "RSSecondary", "Unknown"]));       // lost the primary
    w.topologyChanged(topo(["Unknown", "Unknown", "Unknown"]));           // still down: no repeat
    t = 12000;
    w.topologyChanged(topo(["RSPrimary", "Unknown", "Unknown"]));         // back
    assert.deepEqual(lines, [
        ["error", "db.offline", "lost contact with MongoDB: connection timed out"],
        ["warn", "db.online", "MongoDB reachable again after 10s", { downMs: 10000 }]
    ]);
});

test("topology watcher: never connecting at all is not a db.offline (startup failure is connect()'s job)", () => {
    const lines = [];
    const w = createTopologyWatcher({ warn: (...a) => lines.push(a), error: (...a) => lines.push(a) });
    w.topologyChanged(topo(["Unknown"]));
    w.topologyChanged(topo(["Unknown"]));
    assert.deepEqual(lines, []);
});

test("topology watcher: reports connected/disconnected to the isConnected flag", () => {
    const flags = [];
    const w = createTopologyWatcher({ warn() {}, error() {} }, () => 0, (v) => flags.push(v));
    w.topologyChanged(topo(["Unknown"]));                 // never connected: no flag change
    w.topologyChanged(topo(["RSPrimary", "RSSecondary"]));
    w.topologyChanged(topo(["Unknown", "Unknown"]));
    w.topologyChanged(topo(["RSPrimary", "Unknown"]));
    assert.deepEqual(flags, [true, false, true]);
});
