const { test } = require("node:test");
const assert = require("node:assert");
const { Status } = require("discord.js");
const { createLogger } = require("../src/logging");
const { createHealth, numberEnv } = require("../src/health");

const T0 = Date.parse("2026-11-10T20:00:00Z");

// a health monitor wired to stubs: fake client status, fake fetch, fake clock, a real logger that records lines
function setup(opts) {
    opts = opts || {};
    const lines = [];
    const exits = [];
    const clock = { t: T0 };
    const state = { status: Status.Ready, db: true };
    const client = { ws: { get status() { return state.status; } } };
    const fetches = [];
    const log = createLogger({ env: {}, now: () => new Date(clock.t), exit: (c) => exits.push(c), fatalFlushMs: 50 });
    log.addSink({ name: "rec", defaultLevel: "debug", write: (e) => lines.push(e.event + ": " + e.msg) });
    const health = createHealth({
        client, log,
        dbConnected: () => state.db,
        env: Object.assign({ HEALTHCHECK_URL: "https://hc.test/abc-123/" }, opts.env),
        now: () => clock.t,
        fetch: opts.fetch || (async (url) => { fetches.push(url); return { ok: true }; })
    });
    return { health, state, clock, lines, exits, fetches, log };
}

test("numberEnv: blank/junk/negative -> fallback, 0 is a real value", () => {
    assert.equal(numberEnv(undefined, 5), 5);
    assert.equal(numberEnv(" ", 5), 5);
    assert.equal(numberEnv("abc", 5), 5);
    assert.equal(numberEnv("-1", 5), 5);
    assert.equal(numberEnv("0", 5), 0);
    assert.equal(numberEnv("60000", 5), 60000);
});

test("heartbeat pings the check URL (trailing slash trimmed) while healthy", async () => {
    const { health, fetches } = setup();
    assert.equal(await health.heartbeat(), true);
    assert.deepEqual(fetches, ["https://hc.test/abc-123"]);
});

test("heartbeat stays silent when the gateway isn't ready or the DB is down", async () => {
    const { health, state, fetches } = setup();
    state.status = Status.Disconnected;
    assert.equal(await health.heartbeat(), false);
    state.status = Status.Ready;
    state.db = false;
    assert.equal(await health.heartbeat(), false);
    assert.deepEqual(fetches, []);
    assert.equal(health.check().reason, "database not connected");
    state.db = true;
    assert.equal(await health.heartbeat(), true);
    assert.equal(fetches.length, 1);
});

test("heartbeat logs unhealthy/recovered transitions once each, and not during the boot grace", async () => {
    const { health, state, clock, lines } = setup();
    state.status = Status.Connecting;
    await health.heartbeat();                       // booting: expected, silent
    assert.deepEqual(lines, []);
    state.status = Status.Ready;
    await health.heartbeat();                       // first healthy
    state.status = Status.Disconnected;
    await health.heartbeat();
    await health.heartbeat();                       // still unhealthy: no repeat
    state.status = Status.Ready;
    await health.heartbeat();
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^health\.unhealthy: not sending heartbeats: gateway not ready/);
    assert.match(lines[1], /^health\.recovered/);
    // never healthy and past the boot grace -> that's a real problem and is reported
    const b = setup();
    b.state.status = Status.Connecting;
    b.clock.t += 3 * 60 * 1000;
    await b.health.heartbeat();
    assert.match(b.lines[0], /^health\.unhealthy/);
});

test("no HEALTHCHECK_URL: nothing is pinged and start() says the heartbeat is off", async () => {
    const { health, fetches, lines } = setup({ env: { HEALTHCHECK_URL: "" } });
    assert.equal(await health.heartbeat(), false);
    assert.equal(await health.ping("/fail"), false);
    health.start();
    health.stop();
    assert.deepEqual(fetches, []);
    assert.ok(lines.some((l) => /^health\.disabled/.test(l)));
});

test("a failing or non-ok ping is reported and never throws", async () => {
    const a = setup({ fetch: async () => { throw new Error("ECONNRESET"); } });
    assert.equal(await a.health.heartbeat(), false);
    assert.ok(a.lines.some((l) => /^health\.ping\.failed.*ECONNRESET/.test(l)));
    const b = setup({ fetch: async () => ({ ok: false, status: 500 }) });
    assert.equal(await b.health.heartbeat(), false);
});

test("log.fatal sends the /fail ping before exiting 1", async () => {
    const { health, log, fetches, exits } = setup();
    health.start();
    health.stop();
    fetches.length = 0;
    await log.fatal("fatal", "boom");
    assert.deepEqual(fetches, ["https://hc.test/abc-123/fail"]);
    assert.deepEqual(exits, [1]);
});

test("a hung monitor can't block the fatal exit", async () => {
    const { health, log, exits } = setup({ fetch: () => new Promise(() => {}) });
    health.start();
    health.stop();
    const start = Date.now();
    await log.fatal("fatal", "boom");
    assert.deepEqual(exits, [1]);
    assert.ok(Date.now() - start < 1500, "fatal should give up on the ping after its timeout");
});

test("watchdog: exits only after the gateway has been down for WATCHDOG_MS", async () => {
    const { health, state, clock, lines, exits } = setup({ env: { WATCHDOG_MS: "300000", HEALTHCHECK_URL: "" } });
    health.watchdogTick();                          // ready: nothing
    state.status = Status.Disconnected;
    health.watchdogTick();                          // first sighting: warn, start the clock
    assert.match(lines[lines.length - 1], /^watchdog\.gateway\.down/);
    clock.t += 299000;
    health.watchdogTick();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(exits, []);
    clock.t += 2000;
    health.watchdogTick();                          // 301s down
    await new Promise((r) => setTimeout(r, 120));
    assert.deepEqual(exits, [1]);
    assert.ok(lines.some((l) => /^watchdog: gateway not READY for 301s/.test(l)));
});

test("watchdog: a gateway that comes back resets the clock", async () => {
    const { health, state, clock, lines, exits } = setup({ env: { WATCHDOG_MS: "300000", HEALTHCHECK_URL: "" } });
    state.status = Status.Reconnecting;
    health.watchdogTick();
    clock.t += 200000;
    state.status = Status.Ready;
    health.watchdogTick();
    assert.match(lines[lines.length - 1], /^watchdog\.recovered.*200s/);
    state.status = Status.Reconnecting;
    health.watchdogTick();                          // a new outage starts from zero
    clock.t += 200000;
    health.watchdogTick();
    await new Promise((r) => setTimeout(r, 120));
    assert.deepEqual(exits, []);
});

test("WATCHDOG_MS=0 turns the watchdog off", () => {
    const { health, lines } = setup({ env: { WATCHDOG_MS: "0", HEALTHCHECK_URL: "" } });
    health.start();
    health.stop();
    assert.ok(lines.some((l) => /^watchdog\.disabled/.test(l)));
});
