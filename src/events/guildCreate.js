const { Events } = require("discord.js");
var log = require("../logging");
var logContext = require("../logging/context");
var db = require("../data/db");
var guildInfo = require("../guildInfo");

async function handle(guild){
    log.info('guild.joined', "the bot joined a new server", logContext.forGuild(guild));
    //store the channel's id: the channel object itself can't be saved (it points back at its guild)
    var control = guild.channels.cache.find(channel => channel.name === "bot-control");
    try {
        await db.newServer(guild.id, control && control.id);
        var data = await db.getHi(guild.id);
        await guildInfo.logGuild(guild, data.botControl);
    } catch(err) {
        log.error('guild.join.failed', "couldn't set up the new server: " + err.message, Object.assign({ err: err }, logContext.forGuild(guild)));
    }
}

function register(client){
    //When joining a server, register with the db
    client.on(Events.GuildCreate, handle);
}

module.exports = { register, handle };
