const { Events } = require("discord.js");
var log = require("../logging");
var logContext = require("../logging/context");
var db = require("../data/db");

function register(client){
    //When joining a server, register with the db
    client.on(Events.GuildCreate, guild => {
        log.info('guild.joined', "the bot joined a new server", logContext.forGuild(guild));
        db.newServer(guild.id, guild.channels.cache.find(channel => channel.name === "bot-control"))
    })
}

module.exports = { register };
