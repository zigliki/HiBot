const { test } = require("node:test");
const assert = require("node:assert");
const { fromMessage } = require("../src/discord/commandContext");

test("fromMessage: guild, requester and bot ids come from the message and client", () => {
    const message = { member: { user: { id: "REQ" } }, guild: { id: "g1" }, channel: { send: () => {} } };
    const ctx = fromMessage(message, { user: { id: "BOT" } });
    assert.deepEqual([ctx.guildId, ctx.userId, ctx.botId], ["g1", "REQ", "BOT"]);
});

test("fromMessage: reply posts to the channel and only ever pings the requester", async () => {
    const sent = [];
    const message = { member: { user: { id: "REQ" } }, guild: { id: "g1" }, channel: { send: async (opts) => { sent.push(opts); return "sent"; } } };
    const ctx = fromMessage(message, { user: { id: "BOT" } });
    const result = await ctx.reply("hello <@OTHER>");
    assert.deepEqual(sent, [{ content: "hello <@OTHER>", allowedMentions: { users: ["REQ"] } }]);
    assert.equal(result, "sent");
});
