const { Events } = require("discord.js");
var log = require("../logging");
var db = require("../data/db");
var settings = require("../settings");
var hi = require("../game/hi");
var tools = require("../tools/runner");

function register(client, mongoLog){
    //when the bot is ready: connect the db, restore the saved status, re-arm the ping timers
    client.once(Events.ClientReady, async () => {
        log.info('bot.ready', `Logged in as ${client.user.tag}!`, { guilds: client.guilds.cache.size });
        try {
            await db.connect();
        } catch (err) {
            //without the database nothing works: exit so fly restarts us and retries
            await log.fatal('db.connect.failed', 'could not connect to MongoDB: ' + err.message, err);
            return;
        }
        mongoLog.setReady();
        await settings.applyStoredSettings(client);
        hi.restartPings(client);

        //on-demand maintenance tools, gated behind env (TOOLS=true + TOOL_TO_USE=<name>). see tools/runner.js
        if (process.env.TOOLS === 'true') {
            try {
                await tools.runTool(client);
            } catch (err) {
                log.error('tool.failed', 'tool failed: ' + err.message, err);
            }
        }
    })
}

module.exports = { register };
