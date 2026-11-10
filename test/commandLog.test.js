const { test } = require("node:test");
const assert = require("node:assert");
const log = require("../src/logging");
const commandLog = require("../src/commands/run");

// capture what the real logger is given, and keep the console quiet while a test runs
const logged = [];
log.addSink({ name: "command-log-test", defaultLevel: "debug", write: (e) => logged.push(e) });

async function quietly(fn) {
    const saved = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = () => {};
    logged.length = 0;
    try {
        return await fn();
    } finally {
        Object.assign(console, saved);
    }
}

const WHO = { guild: "g1", guildName: "Test Server", user: "u1", userTag: "kingnoskcaj" };

test("run: logs command.run with who/what/where, runs the handler, returns true", async () => {
    let ran = false;
    const ok = await quietly(() => commandLog.run("top", "average", "text", WHO, async () => { ran = true; }));
    assert.equal(ok, true);
    assert.equal(ran, true);
    assert.deepEqual(logged.map((e) => [e.level, e.event, e.msg]), [["info", "command.run", "kingnoskcaj ran @HiBot top average"]]);
    assert.deepEqual(logged[0].meta, { command: "top", args: "average", via: "text", ...WHO });
});

test("run: how the command is shown depends on how it was run (text, slash, DM)", async () => {
    await quietly(async () => {
        await commandLog.run("stats", "", "text", WHO, () => {});
        await commandLog.run("top", "board:average", "slash", WHO, () => {});
        await commandLog.run("pic", "http://x/y.png", "dm", WHO, () => {});
    });
    assert.deepEqual(logged.map((e) => e.msg), [
        "kingnoskcaj ran @HiBot stats",
        "kingnoskcaj ran /top board:average",
        "kingnoskcaj ran pic http://x/y.png (DM)"
    ]);
});

test("run: long arguments are truncated in the log", async () => {
    await quietly(() => commandLog.run("status", "x".repeat(1000), "text", WHO, () => {}));
    assert.equal(logged[0].msg.length, "kingnoskcaj ran @HiBot status ".length + 200);
});

test("run: a failing handler is logged as command.failed with the error, and never thrown", async () => {
    const ok = await quietly(() => commandLog.run("output", "<#1>", "text", WHO, async () => { throw new Error("no such channel"); }));
    assert.equal(ok, false);
    assert.deepEqual(logged.map((e) => [e.level, e.event]), [["info", "command.run"], ["error", "command.failed"]]);
    assert.match(logged[1].msg, /@HiBot output <#1> failed: no such channel/);
    assert.equal(logged[1].meta.err.message, "no such channel");
});

test("denied is a warning and unknown is debug", async () => {
    await quietly(async () => {
        commandLog.denied("output", "text", WHO);
        commandLog.unknown("dance", "text", WHO);
    });
    assert.deepEqual(logged.map((e) => [e.level, e.event]), [["warn", "command.denied"], ["debug", "command.unknown"]]);
    assert.equal(logged[0].msg, "kingnoskcaj tried to run @HiBot output without permission");
    assert.equal(logged[1].msg, "kingnoskcaj sent an unknown command: @HiBot dance");
});

test("with no tag, the user id is shown", async () => {
    await quietly(() => commandLog.run("stats", "", "text", { user: "u9" }, () => {}));
    assert.equal(logged[0].msg, "u9 ran @HiBot stats");
});
