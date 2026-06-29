var db = require("./db");

const ACTIVITY_TYPES = ["PLAYING", "STREAMING", "LISTENING", "WATCHING", "COMPETING"];

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
            getUserStats(message);
            return;
        case("top"):
        case("top-stats"):
            getTopFive(message);
            return;
    }

    //server-admin (or bot admin) commands
    if(message.member.hasPermission('ADMINISTRATOR') || message.member.user.id == process.env.DEV){
        switch(command){
            case("output"):
                setOutputChannel(client, message.guild.id, args[0].slice(2, args[0].length - 1));
                break;
        }
    }

    //bot-admin-only commands (global bot properties)
    if(message.member.user.id == process.env.DEV){
        //pic/status are admin commands; same handler as the DM path
        adminCommand(client, command, args, (text) => message.channel.send(text));
    }
}

function dmCommands(message, client){
    //no guild context in a DM, so the only gate is the bot admin (DEV)
    if(message.author.id != process.env.DEV) return;

    const [command, ...args] = message.content.trim().split(" ");
    adminCommand(client, command, args, (text) => message.channel.send(text));
}

function adminCommand(client, command, args, reply){
    switch(command){
        case("pic"):
            if(!args[0]){
                reply("usage: pic <image url>");
                break;
            }
            setBotProfilePicture(client, args[0], reply);
            break;
        case("status"):
            var type = (args[0] || "").toUpperCase();
            if(!ACTIVITY_TYPES.includes(type)){
                reply("status type must be one of: " + ACTIVITY_TYPES.join(", "));
                break;
            }
            var activity = args.slice(1).join(" ");
            if(!activity){
                reply("usage: status <" + ACTIVITY_TYPES.join("|") + "> <message>");
                break;
            }
            setBotStatus(client, activity, type, reply);
            break;
    }
}

async function setOutputChannel(client, serverId, channelId){
    await db.setOutputChannel(serverId, channelId);
    client.channels.cache.get(channelId).send("<@" + client.user.id + "> will output to this channel now :+1:");
}

async function setBotProfilePicture(client, url, reply){
    //discord rate-limits avatar changes hard (only a couple per hour)
    try {
        await client.user.setAvatar(url);
        await db.setSettings({ default_pic: url });
        if(reply) reply("profile picture updated :+1:");
    } catch(err) {
        console.log("failed to set avatar: " + err.message);
        if(reply) reply("couldn't set the picture (Discord rate-limits avatar changes, try again later)");
    }
}

async function setBotStatus(client, activity, type, reply){
    client.user.setActivity(activity, { type: type });
    await db.setSettings({ activity: activity, activity_type: type });
    if(reply) reply("status set to " + type + " " + activity + " :+1:");
}

async function applyStoredSettings(client){
    //presence resets whenever the bot reconnects, so re-apply the stored activity on startup.
    //the avatar persists on Discord's side once set, so it doesn't need re-applying here.
    var settings = await db.getSettings();
    if(settings && settings.activity){
        client.user.setActivity(settings.activity, { type: settings.activity_type });
        console.log("restored activity: " + settings.activity_type + " " + settings.activity);
    } else {
        client.user.setActivity('#hi', { type: 'WATCHING' });
    }
}

function formatDuration(ms){
    //ms -> human-ish "Xd Yh" for stat display
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    return days + "d " + hours + "h";
}

async function getUserStats(message){
    //show the requesting user their own stats in this server (HIB-2)
    var stat = await db.getUserStats(message.member.user.id, message.guild.id);
    if(stat == null){
        message.channel.send("<@" + message.member.user.id + "> you haven't said a successful hi here yet :slight_smile:");
        return;
    }
    //avgHi is undefined until there are at least two his to measure a gap between
    var avg = stat.successful > 1 ? formatDuration(stat.avgHi) : "n/a";
    message.channel.send(
        "<@" + stat.user + "> your hi stats for this server:\n" +
        "successful his: " + stat.successful + "\n" +
        "average time between his: " + avg + "\n" +
        "last hi: " + new Date(stat.lastHi).toUTCString()
    );
}

async function getTopFive(message){
    //leaderboard of the most successful hi-ers in this server (HIB-2)
    var top = await db.getTopStats(message.guild.id, 5);
    if(top.length == 0){
        message.channel.send("no hi stats recorded for this server yet :slight_smile:");
        return;
    }
    var lines = top.map(function(stat, i){
        //prefer a cached display name, fall back to a mention
        var member = message.guild.members.cache.get(stat.user);
        var name = member ? member.displayName : "<@" + stat.user + ">";
        return (i + 1) + ". " + name + " - " + stat.successful + " his";
    });
    message.channel.send("top hi-ers in this server:\n" + lines.join("\n"));
}

module.exports = { botCommands, applyStoredSettings }
