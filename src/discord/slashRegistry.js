const { Routes } = require("discord.js");
var slash = require("../commands/slash");

//replace a server's slash commands with the set it should have (the golden-age server gets its own, see slash.js)
//nothing is registered globally, every server is registered on its own
async function registerForGuild(rest, applicationId, guildId){
    var body = slash.commandsFor(guildId).map(command => command.data.toJSON());
    var result = await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: body });
    return result.length;
}

module.exports = { registerForGuild };
