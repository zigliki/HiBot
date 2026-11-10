const { Events } = require("discord.js");
var log = require("../logging");
var db = require("../data/db");

function register(client){
    //When joining a server, register with the db
    client.on(Events.GuildCreate, guild => {
        log.info('guild.joined', "Joined a new guild: " + guild.name, { guild: guild.id });
        db.newServer(guild.id, guild.channels.cache.find(channel => channel.name === "bot-control"))
    })
}

module.exports = { register };
