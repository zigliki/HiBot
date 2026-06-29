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

    if(attention == prefix) {
        if(message.member.guild.me.hasPermission('ADMINISTRATOR') || message.member.user.id == process.env.DEV){
            switch(command){
                case("output"):
                    setOutputChannel(client, message.guild.id, args[0].slice(2, args[0].length - 1));
                    break;
                case("stats"):
                case("my-stats"):
                    getUserStats(message);
                    break;
                case("top"):
                case("top-stats"):
                    getTopFive(message);
                    break;
            }
        }
        if(message.member.user.id == process.env.DEV){
            //pic/status are admin commands; same handler as the DM path
            adminCommand(client, command, args, (text) => message.channel.send(text));
        }
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

function getUserStats(message){
    //TODO
}

function getTopFive(message){
    //TODO
}

module.exports = { botCommands, applyStoredSettings }
