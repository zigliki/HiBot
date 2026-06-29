var admin = require("./admin");
var stats = require("./stats");

function botCommands(message, client){
    //bot admin can DM the bot to change global properties (HIB-6)
    if(message.channel.type == "dm"){
        dmCommands(message, client);
        return;
    }

    const prefix = "<@" + client.user.id + ">";
    const [attention, command, ...args] = message.content.split(" ");

    if(attention != prefix) return;

    //public commands: anyone can look up stats
    switch(command){
        case("stats"):
        case("my-stats"):
            stats.getUserStats(message);
            return;
        case("top"):
        case("top-stats"):
            stats.getTopFive(message);
            return;
    }

    //server-admin (or bot admin) commands
    if(message.member.hasPermission('ADMINISTRATOR') || message.member.user.id == process.env.DEV){
        switch(command){
            case("output"):
                admin.setOutputChannel(client, message.guild.id, args[0].slice(2, args[0].length - 1));
                break;
        }
    }

    //bot-admin-only commands (global bot properties)
    if(message.member.user.id == process.env.DEV){
        //pic/status are admin commands; same handler as the DM path
        admin.adminCommand(client, command, args, (text) => message.channel.send(text));
    }
}

function dmCommands(message, client){
    //no guild context in a DM, so the only gate is the bot admin (DEV)
    if(message.author.id != process.env.DEV) return;

    const [command, ...args] = message.content.trim().split(" ");
    admin.adminCommand(client, command, args, (text) => message.channel.send(text));
}

module.exports = { botCommands };
