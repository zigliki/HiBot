const { ChannelType, PermissionFlagsBits } = require("discord.js");
var admin = require("./admin");
var stats = require("./stats");
var parse = require("./args");
var commandLog = require("./run");
var commandContext = require("../discord/commandContext");
var logContext = require("../logging/context");

function botCommands(message, client){
    //the bot's own messages (e.g. "@HiBot will output to this channel now") aren't commands
    if(message.author.id == client.user.id) return;

    var who = logContext.forMessage(message);

    //bot admin can DM the bot to change global properties (HIB-6)
    if(message.channel.type === ChannelType.DM){
        dmCommands(message, client, who);
        return;
    }

    const prefix = "<@" + client.user.id + ">";
    const [attention, command, ...args] = message.content.split(" ");

    if(attention != prefix) return;

    //public commands: anyone can look up stats
    var ctx = commandContext.fromMessage(message, client);
    var line = args.join(" ");
    switch(command){
        case("stats"):
        case("my-stats"):
            commandLog.run("stats", line, "text", who, () => stats.getUserStats(ctx, parse.parseUserId(args[0])));
            return;
        case("first"):
        case("firsthi"):
        case("first-hi"):
            commandLog.run("first", line, "text", who, () => stats.getFirstHi(ctx, parse.parseUserId(args[0])));
            return;
        case("top"):
        case("top-stats"):
            commandLog.run("top", line, "text", who, () => stats.getTop(ctx, args[0]));
            return;
        case("chain"):
        case("longest"):
        case("longest-chain"):
            commandLog.run("chain", line, "text", who, () => stats.getChain(ctx, args[0]));
            return;
    }

    //server-admin (or bot admin) commands
    if(command == "output"){
        if(message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.user.id == process.env.DEV){
            commandLog.run("output", line, "text", who, () => admin.setOutputChannel(client, message.guild.id, args[0].slice(2, args[0].length - 1)));
        } else {
            commandLog.denied("output", "text", who);
        }
        return;
    }

    //bot-admin-only commands (global bot properties)
    if(command == "pic" || command == "status"){
        if(message.member.user.id == process.env.DEV){
            //pic/status are admin commands; same handler as the DM path
            commandLog.run(command, line, "text", who, () => admin.adminCommand(client, command, args, (text) => message.channel.send(text)));
        } else {
            commandLog.denied(command, "text", who);
        }
        return;
    }

    commandLog.unknown(command, "text", who);
}

function dmCommands(message, client, who){
    const [command, ...args] = message.content.trim().split(" ");
    var isAdminCommand = command == "pic" || command == "status";

    //no guild context in a DM, so the only gate is the bot admin (DEV)
    if(message.author.id != process.env.DEV){
        if(isAdminCommand) commandLog.denied(command, "dm", who);
        return;
    }

    if(isAdminCommand){
        commandLog.run(command, args.join(" "), "dm", who, () => admin.adminCommand(client, command, args, (text) => message.channel.send(text)));
    } else {
        commandLog.unknown(command, "dm", who);
    }
}

module.exports = { botCommands };
