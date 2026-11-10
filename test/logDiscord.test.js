const { test } = require("node:test");
const assert = require("node:assert");
const { createLogger } = require("../src/logging");
const { createDiscordSink, formatEntry, chunkLines } = require("../src/logging/discordSink");

const T0 = Date.parse("2026-11-10T22:34:32Z");

// logger + discord sink wired to a stub fetch. responses is a queue of { status, body } (default 204 ok).
function setup(opts) {
    const posts = [];
    const reports = [];
    const responses = [];
    const clock = { t: T0 };
    const sink = createDiscordSink(Object.assign({
        url: "https://discord.test/hook",
        fetch: async (url, init) => {
            posts.push({ url, init, body: JSON.parse(init.body) });
            const r = responses.shift() || { status: 204 };
            return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
        },
        report: (m) => reports.push(m),
        now: () => clock.t,
        sleep: async (ms) => { clock.t += ms; },
        flushIntervalMs: 1e9
    }, opts));
    const log = createLogger({ env: {}, now: () => new Date(clock.t), boot: "b1" });
    log.addSink(sink);
    return { posts, reports, responses, clock, sink, log };
}

test("formatEntry: icon, UTC time, bold event, message; long lines are truncated", () => {
    const e = { ts: new Date(T0), level: "warn", event: "shard.disconnect", msg: "shard 0 disconnected (code 1006)" };
    assert.equal(formatEntry(e), "⚠️ `22:34:32Z` **shard.disconnect** shard 0 disconnected (code 1006)");
    assert.equal(formatEntry(Object.assign({}, e, { msg: "x".repeat(1000) })).length, 300);
});

test("lines are batched into one message that can never ping anyone", async () => {
    const { posts, sink, log } = setup();
    log.info("hi.valid", "valid hi from a");
    log.error("fatal", "boom");
    await sink.flush();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "https://discord.test/hook");
    assert.deepEqual(posts[0].body.allowed_mentions, { parse: [] });
    assert.equal(posts[0].body.content.split("\n").length, 2);
    assert.match(posts[0].body.content, /\*\*hi\.valid\*\*[\s\S]*\*\*fatal\*\*/);
});

test("chunkLines keeps every message under the limit and never splits a line", () => {
    const lines = Array.from({ length: 30 }, (_, i) => String(i).padStart(2, "0") + "x".repeat(298));
    const chunks = chunkLines(lines);
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.join("\n").length <= 1900);
    assert.deepEqual(chunks.flat(), lines);
});

test("429: waits retry_after, then resends the same lines in order", async () => {
    const { posts, responses, sink, log, clock } = setup();
    responses.push({ status: 429, body: { retry_after: 1.5 } });
    log.info("a", "1");
    log.info("b", "2");
    await sink.flush();              // first post is rate limited; flush waits it out and resends
    assert.equal(posts.length, 2);
    assert.equal(posts[1].body.content, posts[0].body.content);
    assert.ok(clock.t >= T0 + 1500);
    assert.equal(sink.pending(), 0);
});

test("a long rate limit leaves the lines queued instead of blocking the exit path", async () => {
    const { posts, responses, sink, log } = setup();
    responses.push({ status: 429, body: { retry_after: 30 } });
    log.info("a", "1");
    await sink.flush();
    assert.equal(posts.length, 1);
    assert.equal(sink.pending(), 1);
});

test("5xx and network errors keep the lines and report once; recovery sends them in order", async () => {
    const { posts, reports, responses, sink, log } = setup();
    responses.push({ status: 503 });
    log.info("a", "1");
    await sink.flush();
    log.info("b", "2");
    responses.push({ status: 502 });
    await sink.flush();
    assert.equal(sink.pending(), 2);
    assert.equal(reports.length, 1, "reported once per outage");
    await sink.flush();              // default 204
    assert.equal(sink.pending(), 0);
    const last = posts[posts.length - 1].body.content;
    assert.ok(last.indexOf("**a**") < last.indexOf("**b**"));
});

test("a rejected webhook (4xx) drops the message rather than retrying forever", async () => {
    const { reports, responses, sink, log } = setup();
    responses.push({ status: 404 });
    log.info("a", "1");
    await sink.flush();
    assert.equal(sink.pending(), 0);
    assert.match(reports[0], /404.*LOG_WEBHOOK/);
});

test("fetch throwing is contained and retried", async () => {
    let calls = 0;
    const { reports, sink, log } = setup({
        fetch: async () => {
            calls++;
            if (calls === 1) throw new Error("ECONNRESET");
            return { ok: true, status: 204 };
        }
    });
    log.info("a", "1");
    await sink.flush();
    assert.equal(sink.pending(), 1);
    assert.match(reports[0], /ECONNRESET/);
    await sink.flush();
    assert.equal(sink.pending(), 0);
});

test("queue is capped (oldest dropped) and the next message says how many were lost", async () => {
    const { posts, sink, log } = setup({ maxQueue: 3 });
    for (let i = 1; i <= 5; i++) log.info("e" + i, "m");
    assert.equal(sink.pending(), 3);
    await sink.flush();
    const content = posts[0].body.content;
    assert.match(content, /2 log line\(s\) were dropped/);
    assert.ok(!content.includes("**e1**") && !content.includes("**e2**"));
    assert.ok(content.includes("**e5**"));
});

test("the sink's own level (LOG_DISCORD_LEVEL) decides what is posted", async () => {
    const posts = [];
    const sink = createDiscordSink({ url: "u", fetch: async (u, init) => { posts.push(JSON.parse(init.body)); return { ok: true, status: 204 }; }, flushIntervalMs: 1e9 });
    const log = createLogger({ env: { LOG_DISCORD_LEVEL: "warn" } });
    log.addSink(sink);
    log.info("quiet", "x");
    log.warn("loud", "y");
    await sink.flush();
    assert.equal(posts.length, 1);
    assert.ok(posts[0].content.includes("**loud**") && !posts[0].content.includes("**quiet**"));
});
