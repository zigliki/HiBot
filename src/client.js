const { Client, GatewayIntentBits, Partials } = require("discord.js");

function createClient(){
    //v14 needs explicit intents. MessageContent is privileged: it must also be switched on for the bot
    //in the Discord developer portal, or message.content arrives empty and no hi ever validates.
    //Channel partial = DMs (bot admin commands) arrive at all.
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
