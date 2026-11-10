const { test } = require("node:test");
const assert = require("node:assert");
const { parseUserId } = require("../src/commands/args");

test("parseUserId: accepts <@id> and the nickname form <@!id>", () => {
    assert.equal(parseUserId("<@222>"), "222");
    assert.equal(parseUserId("<@!222>"), "222");
});

test("parseUserId: anything else is null (so the command falls back to the requester)", () => {
    for (const arg of [undefined, "", "222", "@222", "<@>", "<@abc>", "<#222>", "<@222> extra"]) {
        assert.equal(parseUserId(arg), null, String(arg));
    }
});
