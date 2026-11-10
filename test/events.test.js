const { test } = require("node:test");
const assert = require("node:assert");
const EventEmitter = require("events");

// register each event file on a bare emitter and see which events it listens to
function listensTo(file, ...args){
    const client = new EventEmitter();
    require("../src/events/" + file).register(client, ...args);
    return client.eventNames().sort();
}

test("ready listens for clientReady", () => {
    assert.deepEqual(listensTo("ready", { setReady() {} }), ["clientReady"]);
});

test("messageCreate, interactionCreate, guildCreate and guildDelete listen for their events", () => {
    assert.deepEqual(listensTo("messageCreate"), ["messageCreate"]);
    assert.deepEqual(listensTo("interactionCreate"), ["interactionCreate"]);
    assert.deepEqual(listensTo("guildCreate"), ["guildCreate"]);
    assert.deepEqual(listensTo("guildDelete"), ["guildDelete"]);
});

test("connection listens for the gateway events and client errors", () => {
    assert.deepEqual(listensTo("connection"), ["error", "invalidated", "shardDisconnect", "shardError", "shardReconnecting", "shardResume", "warn"]);
});
