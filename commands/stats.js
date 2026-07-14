var db = require("../db");

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

module.exports = { getUserStats, getTopFive };
