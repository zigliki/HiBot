const { test } = require("node:test");
const assert = require("node:assert");

const dbPath = require.resolve("../src/data/db");

// load db.js fresh with MONGO_URI set to `value` (undefined = unset)
function loadDb(value) {
    delete require.cache[dbPath];
    if (value === undefined) delete process.env.MONGO_URI;
    else process.env.MONGO_URI = value;
    return require("../src/data/db");
}

test("connect: a missing MONGO_URI fails with a message that says what to set", async () => {
    const db = loadDb(undefined);
    await assert.rejects(db.connect(), /MONGO_URI is not set/);
    assert.strictEqual(db.isConnected(), false);
});

test("connect: an empty MONGO_URI counts as missing", async () => {
    const db = loadDb("");
    await assert.rejects(db.connect(), /MONGO_URI is not set/);
});

test("requiring db with a MONGO_URI set does not connect or throw", () => {
    const db = loadDb("mongodb://127.0.0.1:1/");
    assert.strictEqual(db.isConnected(), false);
});

test("requiring db without a MONGO_URI does not throw", () => {
    assert.doesNotThrow(() => loadDb(undefined));
});
