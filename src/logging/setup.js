var log = require("./index");
var mongoSink = require("./mongoSink");
var discordSink = require("./discordSink");

function addSinks(writeBucket){
    //logs also go to MongoDB (HIB-32). the sink queues lines until the DB is connected (setReady)
    const mongoLog = mongoSink.createMongoSink({ writeBucket: writeBucket, machine: process.env.FLY_MACHINE_ID });
    log.addSink(mongoLog);
    //...and, when LOG_WEBHOOK is set, to a Discord channel (HIB-9). a webhook is plain HTTPS, so it still works
    //when the bot's gateway connection is down. unset = no Discord logging.
    let discordLog = null;
    if (process.env.LOG_WEBHOOK) {
        discordLog = discordSink.createDiscordSink({ url: process.env.LOG_WEBHOOK });
        log.addSink(discordLog);
        discordLog.start();
    }
    return { mongoLog: mongoLog, discordLog: discordLog };
}

module.exports = { addSinks };
