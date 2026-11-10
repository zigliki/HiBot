const { test } = require("node:test");
const assert = require("node:assert");
const { Routes } = require("discord.js");
const { commands } = require("../src/commands/slash");
const { parseArgs, describe, register } = require("../scripts/registerCommands");

test("parseArgs: dry run by default; --apply and --guild; bad input is an error", () => {
    assert.deepEqual(parseArgs([]), { apply: false, guild: null });
    assert.deepEqual(parseArgs(["--apply"]), { apply: true, guild: null });
    assert.deepEqual(parseArgs(["--guild", "123", "--apply"]), { apply: true, guild: "123" });
    assert.throws(() => parseArgs(["--guild"]), /needs a server id/);
    assert.throws(() => parseArgs(["--nope"]), /unknown option/);
});

test("describe: name, options (* = required) and whether it's admin-only by default", () => {
    assert.equal(describe({ name: "stats", options: [{ name: "user" }] }), "/stats (user)");
    assert.equal(describe({ name: "output", options: [{ name: "channel", required: true }], default_member_permissions: "8" }), "/output (channel*) [admins only by default]");
});

function fakeDiscord() {
    const calls = [];
    return {
        calls,
        deps: {
            rest: {
                get: async (route) => { calls.push(["get", route]); return { id: "APP" }; },
                put: async (route, opts) => { calls.push(["put", route, opts.body.length]); return opts.body; }
            },
            log: () => {}
        }
    };
}

test("a dry run lists the commands and sends nothing", async () => {
    const lines = [];
    const fake = fakeDiscord();
    const result = await register({ apply: false, guild: null }, commands, { rest: fake.deps.rest, log: (l) => lines.push(l) });
    assert.deepEqual(result, { applied: false, count: 5 });
    assert.deepEqual(fake.calls, []);
    assert.ok(lines.some((l) => l.includes("/output (channel*) [admins only by default]")));
    assert.ok(lines.some((l) => l.startsWith("dry run: nothing was sent")));
});

test("--apply with a guild registers in just that server, using the application id Discord reports", async () => {
    const fake = fakeDiscord();
    const result = await register({ apply: true, guild: "G1" }, commands, fake.deps);
    assert.deepEqual(result, { applied: true, count: 5 });
    assert.deepEqual(fake.calls, [["get", Routes.currentApplication()], ["put", Routes.applicationGuildCommands("APP", "G1"), 5]]);
});

test("--apply without a guild registers globally", async () => {
    const fake = fakeDiscord();
    await register({ apply: true, guild: null }, commands, fake.deps);
    assert.deepEqual(fake.calls[1], ["put", Routes.applicationCommands("APP"), 5]);
});
