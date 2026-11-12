const { test } = require("node:test");
const assert = require("node:assert");
const db = require("../src/data/db");
const admin = require("../src/commands/admin");

// adminCommand doesn't await the handlers, so let them settle before looking at what happened
const settle = () => new Promise((resolve) => setImmediate(resolve));

function mkClient(avatarCalls) {
    return { user: { setAvatar: async (url) => { avatarCalls.push(url); }, setActivity: () => {} } };
}

test("pic sets the avatar and replies, without saving the url to the settings doc (HIB-42)", async () => {
    const avatars = [];
    const saved = [];
    const replies = [];
    db.setSettings = async (updates) => { saved.push(updates); };
    admin.adminCommand(mkClient(avatars), "pic", ["http://x/y.png"], (m) => replies.push(m));
    await settle();
    assert.deepEqual(avatars, ["http://x/y.png"]);
    assert.deepEqual(saved, []);
    assert.deepEqual(replies, ["profile picture updated :+1:"]);
});

test("status still saves the activity so it survives a restart", async () => {
    const saved = [];
    db.setSettings = async (updates) => { saved.push(updates); };
    admin.adminCommand(mkClient([]), "status", ["watching", "#hi"], () => {});
    await settle();
    assert.deepEqual(saved, [{ activity: "#hi", activity_type: "WATCHING" }]);
});
