var db = require("../db");

const ACTIVITY_TYPES = ["PLAYING", "STREAMING", "LISTENING", "WATCHING", "COMPETING"];

//pic/status: bot-admin (DEV) commands to change global bot properties (HIB-6)
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

module.exports = { adminCommand, setOutputChannel };
