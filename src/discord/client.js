const { Client, GatewayIntentBits, Partials } = require("discord.js");

function createClient(){
    //v14 needs explicit intents. MessageContent is privileged: enable it in the developer portal too, or content is empty
    //the Channel partial lets DMs (bot admin commands) arrive
    return new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel],
    });
}

module.exports = createClient;
