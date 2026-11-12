const { Events } = require("discord.js");
var log = require("../logging");

function register(client){
    client.on(Events.Error, (err) => log.error('client.error', 'discord client error: ' + err.message, err));

    //the gateway connection is what died in HIB-31, so record every change to it
    client.on(Events.ShardDisconnect, (event, id) => log.warn('shard.disconnect', `shard ${id} disconnected (code ${event && event.code})`, { shard: id, code: event && event.code }));
    client.on(Events.ShardReconnecting, (id) => log.debug('shard.reconnecting', `shard ${id} reconnecting`, { shard: id }));
    client.on(Events.ShardResume, (id, replayed) => log.debug('shard.resume', `shard ${id} resumed (${replayed} events replayed)`, { shard: id, replayed: replayed }));
    client.on(Events.ShardError, (err, id) => log.error('shard.error', `shard ${id} error: ${err.message}`, { shard: id, err: err }));
    client.on(Events.Invalidated, () => log.error('client.invalidated', 'discord session invalidated'));
    client.on(Events.Warn, (message) => log.warn('client.warn', message));
}

module.exports = { register };
