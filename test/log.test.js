const { test } = require("node:test");
const assert = require("node:assert");
const { createLogger, createConsoleSink, parseLevel, formatLine, contextTag, LEVELS } = require("../src/logging");

// a sink that records what it was given; level comes from `env` via its envVar
function recorder(name, envVar, defaultLevel) {
    const seen = [];
    return { seen, sink: { name, envVar, defaultLevel, write: (e) => seen.push(e) } };
}

test("per-sink level: each sink filters on its own env var", () => {
    const a = recorder("a", "LOG_A_LEVEL", "info");
    const b = recorder("b", "LOG_B_LEVEL", "info");
    const log = createLogger({ env: { LOG_A_LEVEL: "warn", LOG_B_LEVEL: "debug" } });
    log.addSink(a.sink);
    log.addSink(b.sink);
    log.debug("e.debug", "d");
    log.info("e.info", "i");
    log.warn("e.warn", "w");
    log.error("e.error", "x");
    assert.deepEqual(a.seen.map((e) => e.event), ["e.warn", "e.error"]);
    assert.deepEqual(b.seen.map((e) => e.event), ["e.debug", "e.info", "e.warn", "e.error"]);
});

test("level defaults apply when the env var is unset; `off` disables a sink", () => {
    const a = recorder("a", "LOG_A_LEVEL", "info");
    const b = recorder("b", "LOG_B_LEVEL", "debug");
    const log = createLogger({ env: { LOG_B_LEVEL: "OFF" } });
    log.addSink(a.sink);
    log.addSink(b.sink);
    log.debug("e.debug", "d");
    log.info("e.info", "i");
    log.error("e.error", "x");
    assert.deepEqual(a.seen.map((e) => e.event), ["e.info", "e.error"]);
    assert.equal(b.seen.length, 0);
});

test("parseLevel: blank -> fallback, off -> never, junk -> fallback", () => {
    const origError = console.error;
    console.error = () => {};
    try {
        assert.equal(parseLevel(undefined, LEVELS.info), LEVELS.info);
        assert.equal(parseLevel("  ", LEVELS.info), LEVELS.info);
        assert.equal(parseLevel("Warn", LEVELS.info), LEVELS.warn);
        assert.equal(parseLevel("off", LEVELS.info), Infinity);
        assert.equal(parseLevel("loud", LEVELS.info), LEVELS.info);
    } finally {
        console.error = origError;
    }
});

test("entry shape: ts, level, numeric lvl, event, msg, increasing seq, boot", () => {
    const r = recorder("r", "X", "debug");
    const fixed = new Date("2026-11-10T12:00:00Z");
    const log = createLogger({ env: {}, now: () => fixed, boot: "abc123" });
    log.addSink(r.sink);
    log.info("bot.start", "hello", { guild: "g1" });
    log.warn("bot.warn", "careful");
    assert.deepEqual(r.seen[0], { ts: fixed, level: "info", lvl: 20, event: "bot.start", msg: "hello", seq: 1, boot: "abc123", meta: { guild: "g1" } });
    assert.equal(r.seen[1].seq, 2);
    assert.equal(r.seen[1].meta, undefined);
    assert.equal(log.boot, "abc123");
});

test("msg is truncated; Error meta becomes a plain, truncated object", () => {
    const r = recorder("r", "X", "debug");
    const log = createLogger({ env: {} });
    log.addSink(r.sink);
    const err = new Error("boom");
    err.stack = "s".repeat(5000);
    log.error("fatal", "m".repeat(5000), { err: err, other: 1 });
    log.error("fatal", "bare error", err);
    assert.equal(r.seen[0].msg.length, 1000);
    assert.equal(r.seen[0].meta.err.name, "Error");
    assert.equal(r.seen[0].meta.err.message, "boom");
    assert.equal(r.seen[0].meta.err.stack.length, 2000);
    assert.equal(r.seen[0].meta.other, 1);
    assert.equal(r.seen[1].meta.err.message, "boom");
});

test("a throwing or rejecting sink never reaches the caller or starves other sinks", async () => {
    const good = recorder("good", "X", "debug");
    const log = createLogger({ env: {} });
    log.addSink({ name: "throws", defaultLevel: "debug", write: () => { throw new Error("sync fail"); } });
    log.addSink({ name: "rejects", defaultLevel: "debug", write: () => Promise.reject(new Error("async fail")) });
    log.addSink(good.sink);
    const origError = console.error;
    const reported = [];
    console.error = (m) => reported.push(m);
    try {
        log.info("e", "m");
        await new Promise((r) => setImmediate(r));
    } finally {
        console.error = origError;
    }
    assert.equal(good.seen.length, 1);
    assert.equal(reported.length, 2);
    assert.match(reported[0], /sink "throws" failed: sync fail/);
    assert.match(reported[1], /sink "rejects" failed: async fail/);
});

test("flush drains every sink, and gives up on a sink that never finishes", async () => {
    let flushed = 0;
    const log = createLogger({ env: {} });
    log.addSink({ name: "ok", defaultLevel: "debug", write() {}, flush: async () => { flushed++; } });
    log.addSink({ name: "throws", defaultLevel: "debug", write() {}, flush: () => { throw new Error("nope"); } });
    const origError = console.error;
    console.error = () => {};
    try {
        await log.flush(1000);
        assert.equal(flushed, 1);

        const hung = createLogger({ env: {} });
        hung.addSink({ name: "hung", defaultLevel: "debug", write() {}, flush: () => new Promise(() => {}) });
        const start = Date.now();
        await hung.flush(50);
        assert.ok(Date.now() - start < 1000, "flush should return after its timeout");
    } finally {
        console.error = origError;
    }
});

test("console sink: ISO timestamp, padded level, event, msg, meta; uses the matching console method", () => {
    const calls = [];
    const fake = { log: (l) => calls.push(["log", l]), warn: (l) => calls.push(["warn", l]), error: (l) => calls.push(["error", l]) };
    const fixed = new Date("2026-11-10T12:00:00Z");
    const log = createLogger({ env: { LOG_CONSOLE_LEVEL: "debug" }, now: () => fixed });
    log.addSink(createConsoleSink(fake));
    log.debug("a.b", "one");
    log.warn("c.d", "two", { x: 1 });
    log.error("e.f", "three");
    assert.deepEqual(calls, [
        ["log", "2026-11-10T12:00:00.000Z DEBUG a.b one"],
        ["warn", '2026-11-10T12:00:00.000Z WARN  c.d two {"x":1}'],
        ["error", "2026-11-10T12:00:00.000Z ERROR e.f three"],
    ]);
});

test("formatLine tolerates meta that can't be serialised", () => {
    const circular = {};
    circular.self = circular;
    const line = formatLine({ ts: new Date(0), level: "info", event: "e", msg: "", meta: circular });
    assert.match(line, /\[unserializable meta\]$/);
});

test("formatLine: [guild] prefix after the event, context keys left out of the printed meta", () => {
    const base = { ts: new Date("2026-11-10T21:23:28.588Z"), level: "info", event: "hi.valid", msg: "kingnoskcaj said hi" };
    const named = Object.assign({}, base, { meta: { guild: "3765", guildName: "Test Server", user: "1768", userTag: "kingnoskcaj" } });
    assert.equal(formatLine(named), "2026-11-10T21:23:28.588Z INFO  hi.valid [Test Server] kingnoskcaj said hi");
    //other meta is still printed
    const extra = Object.assign({}, base, { meta: { guildName: "Test Server", inMs: 5 } });
    assert.equal(formatLine(extra), '2026-11-10T21:23:28.588Z INFO  hi.valid [Test Server] kingnoskcaj said hi {"inMs":5}');
    //only an id: the id is the prefix
    const idOnly = Object.assign({}, base, { meta: { guild: "3765" } });
    assert.equal(formatLine(idOnly), "2026-11-10T21:23:28.588Z INFO  hi.valid [3765] kingnoskcaj said hi");
});

test("contextTag: name, else id, else nothing", () => {
    assert.equal(contextTag({ guildName: "A", guild: "1" }), "[A]");
    assert.equal(contextTag({ guild: "1" }), "[1]");
    assert.equal(contextTag({ inMs: 5 }), "");
    assert.equal(contextTag(undefined), "");
});
