const { Events } = require("discord.js");
var log = require("../logging");
var hi = require("../game/hi");
var commands = require("../commands/router");

function register(client){
    //handle incoming messages: the hi game, then bot commands
    client.on(Events.MessageCreate, async msg => {
        try {
            await hi.checkHi(msg, client);
            await commands.botCommands(msg, client);
        } catch (err) {
            log.error('message.failed', 'message handler failed: ' + err.message, err);
        }
    })
}

module.exports = { register };
