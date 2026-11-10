const { PermissionFlagsBits } = require("discord.js");
var log = require("../logging");
var logContext = require("../logging/context");
var db = require("../data/db");

//what the bot needs in #hi: see it, post, delete other people's messages
const NEEDED = [
    ["View Channel", PermissionFlagsBits.ViewChannel],
    ["Send Messages", PermissionFlagsBits.SendMessages],
    ["Manage Messages", PermissionFlagsBits.ManageMessages],
    ["Read Message History", PermissionFlagsBits.ReadMessageHistory],
];

async function describeGuild(guild, botControlId){
    var hiChannel = guild.channels.cache.find(channel => channel.name === "hi");
    var control = botControlId ? guild.channels.cache.get(botControlId) : undefined;
    var missing = [];
    if(hiChannel){
        var me = await guild.members.fetchMe();
        var allowed = hiChannel.permissionsFor(me);
        missing = NEEDED.filter(p => !allowed || !allowed.has(p[1])).map(p => p[0]);
    }

    var problems = [];
    if(!hiChannel) problems.push("no #hi channel");
    if(missing.length) problems.push("missing permissions in #hi: " + missing.join(", "));
    if(!botControlId) problems.push("no bot-control channel set, so the bot can't say why it deleted a message");
    else if(!control) problems.push("the bot-control channel no longer exists");

    return {
        members: guild.memberCount,
        hiChannel: hiChannel ? { id: hiChannel.id, name: hiChannel.name } : null,
        botControl: control ? { id: control.id, name: control.name } : null,
        problems: problems
    };
}

async function logGuild(guild, botControlId, logger){
    //one info line about the server, then a warning for each thing that looks wrong
    logger = logger || log;
    var info = await describeGuild(guild, botControlId);
    var where = logContext.forGuild(guild);
    var summary = info.members + " members, " + (info.hiChannel ? "#hi ok" : "no #hi") + ", " +
        (info.botControl ? "bot-control #" + info.botControl.name : "no bot-control channel");
    logger.info("guild.info", summary, Object.assign({ members: info.members, hiChannel: info.hiChannel, botControl: info.botControl }, where));
    info.problems.forEach(function(problem){
        logger.warn("guild.problem", problem, where);
    });
}

async function logAll(client, logger){
    //at startup: one line per server the bot is in. a failure for one server doesn't skip the rest
    logger = logger || log;
    try {
        var servers = await db.getAllServers();
    } catch(err) {
        logger.warn("guild.info.failed", "couldn't read the servers to log their info: " + err.message, { err: err });
        return;
    }
    for(const guild of client.guilds.cache.values()){
        try {
            var data = servers.find(s => s.server == guild.id);
            await logGuild(guild, data && data.botControl, logger);
        } catch(err) {
            logger.warn("guild.info.failed", "couldn't log the server info: " + err.message, Object.assign({ err: err }, logContext.forGuild(guild)));
        }
    }
}

module.exports = { describeGuild, logGuild, logAll };
