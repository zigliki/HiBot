var log = require("./logging");
var db = require("./data/db");

function register(client, healthMonitor, sinks){
    //a stray rejection (e.g. a failed fire-and-forget DB write, HIB-21) is logged and the bot keeps running.
    process.on('unhandledRejection', (err) => log.error('unhandled.rejection', 'unhandled rejection: ' + (err && err.message), err));
    //anything uncaught is fatal: log it, flush every sink, then exit 1 so fly restarts the machine
    //(restart policy 'always'). staying alive after one left the bot running but dead (HIB-31).
    process.on('uncaughtException', (err) => log.fatal('fatal', 'uncaught exception: ' + (err && err.message), err));

    //close the DB pool cleanly when the process is told to stop (e.g. on redeploy)
    async function shutdown(signal) {
        log.info('bot.shutdown', 'received ' + signal + ', shutting down');
        healthMonitor.stop();
        await log.flush();        //before db.close(): the logs are written through the DB connection
        sinks.mongoLog.stop();
        if (sinks.discordLog) sinks.discordLog.stop();
        await db.close();
        await client.destroy();
        process.exit(0);
    }
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = { register };
