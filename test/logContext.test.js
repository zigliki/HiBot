const { test } = require("node:test");
const assert = require("node:assert");
const { forGuild, forMessage } = require("../src/logging/context");

test("forGuild: id and name, or nothing when there's no guild", () => {
    assert.deepEqual(forGuild({ id: "3765", name: "Test Server" }), { guild: "3765", guildName: "Test Server" });
    assert.deepEqual(forGuild(undefined), {});
});

test("forMessage: guild plus the author; a message with no member still works", () => {
    const msg = { guild: { id: "3765", name: "Test Server" }, member: { user: { id: "1768", tag: "kingnoskcaj" } } };
    assert.deepEqual(forMessage(msg), { guild: "3765", guildName: "Test Server", user: "1768", userTag: "kingnoskcaj" });
    assert.deepEqual(forMessage({ guild: { id: "3765", name: "Test Server" } }), { guild: "3765", guildName: "Test Server" });
});

test("forMessage: a DM has no member, so the author is used", () => {
    const dm = { author: { id: "OWNER", tag: "mark" } };
    assert.deepEqual(forMessage(dm), { user: "OWNER", userTag: "mark" });
});
