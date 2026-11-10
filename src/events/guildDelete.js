const { Events } = require("discord.js");
var log = require("../logging");
var logContext = require("../logging/context");

function handle(guild){
    //the server's data stays in the db in case the bot is added back
    log.info('guild.left', "the bot left a server", logContext.forGuild(guild));
}

function register(client){
    client.on(Events.GuildDelete, handle);
}

module.exports = { register, handle };
