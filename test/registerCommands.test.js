const { test } = require("node:test");
const assert = require("node:assert");
const { Routes } = require("discord.js");
const slash = require("../src/commands/slash");
const slashRegistry = require("../src/discord/slashRegistry");
const { parseArgs, describe, register } = require("../scripts/registerCommands");

const GOLDEN = slash.goldenAgeGuild();

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

// stands in for Discord: records every call, and `fail` lists the servers whose registration is refused
function fakeDiscord(guilds, fail) {
    const calls = [];
    return {
        calls,
        rest: {
            get: async (route) => {
                calls.push(["get", route]);
                return route === Routes.currentApplication() ? { id: "APP" } : guilds;
            },
            put: async (route, opts) => {
                calls.push(["put", route, opts.body.map((c) => c.name + (c.name === "chain" && c.options.length ? "+era" : ""))]);
                if ((fail || []).some((id) => route.includes("/" + id + "/"))) throw new Error("Missing Access");
                return opts.body;
            }
        }
    };
}

const MAIN = ["stats", "first", "top", "chain", "output"];
const GOLDEN_SET = ["stats", "first", "top", "chain+era", "output"];

test("a dry run lists both sets and sends nothing", async () => {
    const lines = [];
    const fake = fakeDiscord([]);
    const result = await register({ apply: false, guild: null }, { rest: fake.rest, log: (l) => lines.push(l) });
    assert.deepEqual(result, { applied: false, servers: 0, failed: [] });
    assert.deepEqual(fake.calls, []);
    assert.ok(lines.some((l) => l.startsWith("every server except " + GOLDEN)));
    assert.ok(lines.some((l) => l.startsWith("the golden-age server " + GOLDEN)));
    assert.ok(lines.includes("  /chain (era)"));
    assert.ok(lines.includes("  /chain"));
    assert.ok(lines.some((l) => l.includes("/output (channel*) [admins only by default]")));
    assert.ok(lines.some((l) => l.startsWith("dry run: nothing was sent")));
});

test("a dry run for one server shows only the set that server would get", async () => {
    const lines = [];
    await register({ apply: false, guild: "OTHER" }, { rest: null, log: (l) => lines.push(l) });
    assert.equal(lines[0], "server OTHER would get:");
    assert.ok(!lines.includes("  /chain (era)"));
});

test("--apply registers every server the bot is in, each with the set it should get, and nothing globally", async () => {
    const fake = fakeDiscord([{ id: GOLDEN, name: "Shaun The Sheep" }, { id: "G2", name: "Test Server" }]);
    const lines = [];
    const result = await register({ apply: true, guild: null }, { rest: fake.rest, log: (l) => lines.push(l) });
    assert.deepEqual(result, { applied: true, servers: 2, failed: [] });
    assert.deepEqual(fake.calls, [
        ["get", Routes.currentApplication()],
        ["get", Routes.userGuilds()],
        ["put", Routes.applicationGuildCommands("APP", GOLDEN), GOLDEN_SET],
        ["put", Routes.applicationGuildCommands("APP", "G2"), MAIN]
    ]);
    assert.ok(lines.includes("registered 5 commands in Shaun The Sheep (" + GOLDEN + ")"));
    assert.ok(!fake.calls.some((c) => c[0] === "put" && c[1] === Routes.applicationCommands("APP")));
});

test("--apply with --guild registers just that server and doesn't ask Discord for the server list", async () => {
    const fake = fakeDiscord([]);
    const result = await register({ apply: true, guild: "G2" }, { rest: fake.rest, log: () => {} });
    assert.deepEqual(result, { applied: true, servers: 1, failed: [] });
    assert.deepEqual(fake.calls, [["get", Routes.currentApplication()], ["put", Routes.applicationGuildCommands("APP", "G2"), MAIN]]);
});

test("a server that refuses (e.g. the bot lacks the commands scope there) is reported and the others still get registered", async () => {
    const fake = fakeDiscord([{ id: "G1", name: "One" }, { id: "G2", name: "Two" }, { id: "G3", name: "Three" }], ["G2"]);
    const lines = [];
    const result = await register({ apply: true, guild: null }, { rest: fake.rest, log: (l) => lines.push(l) });
    assert.deepEqual(result, { applied: true, servers: 3, failed: ["G2"] });
    assert.equal(fake.calls.filter((c) => c[0] === "put").length, 3);
    assert.ok(lines.includes("FAILED in Two (G2): Missing Access"));
});

test("registerForGuild: the golden-age server gets the era choice on /chain, every other server doesn't", async () => {
    const fake = fakeDiscord([]);
    assert.equal(await slashRegistry.registerForGuild(fake.rest, "APP", GOLDEN), 5);
    assert.equal(await slashRegistry.registerForGuild(fake.rest, "APP", "OTHER"), 5);
    assert.deepEqual(fake.calls[0][2], GOLDEN_SET);
    assert.deepEqual(fake.calls[1][2], MAIN);
});
