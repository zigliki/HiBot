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

const { fromInteraction } = require("../src/discord/commandContext");

test("fromInteraction: ids come from the interaction and client", () => {
    const ctx = fromInteraction({ user: { id: "REQ" }, guildId: "g1" }, { user: { id: "BOT" } });
    assert.deepEqual([ctx.guildId, ctx.userId, ctx.botId, ctx.replied], ["g1", "REQ", "BOT", false]);
});

test("fromInteraction: the first reply fills in the deferred message, later ones are follow-ups, only the requester is pinged", async () => {
    const calls = [];
    const interaction = {
        user: { id: "REQ" }, guildId: "g1",
        editReply: async (p) => { calls.push(["editReply", p]); return "edited"; },
        followUp: async (p) => { calls.push(["followUp", p]); return "followed"; }
    };
    const ctx = fromInteraction(interaction, { user: { id: "BOT" } });
    assert.equal(await ctx.reply("one <@OTHER>"), "edited");
    assert.equal(ctx.replied, true);
    assert.equal(await ctx.reply("two"), "followed");
    assert.deepEqual(calls, [
        ["editReply", { content: "one <@OTHER>", allowedMentions: { users: ["REQ"] } }],
        ["followUp", { content: "two", allowedMentions: { users: ["REQ"] } }]
    ]);
});
