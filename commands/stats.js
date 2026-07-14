var db = require("../db");

function formatDuration(ms){
    //ms -> human-ish "Xd Yh" for stat display
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    return days + "d " + hours + "h";
}

async function getUserStats(message, client){
    //show the requesting user their own stats in this server (HIB-2, expanded HIB-28)
    var userId = message.member.user.id;
    //rank + share are measured against the leaderboard with HiBot excluded (HIB-28)
    var board = await db.getServerStats(message.guild.id, client.user.id);
    var stat = board.find(function(s){ return s.user == userId; });
    if(stat == null){
        message.channel.send("<@" + userId + "> you haven't said a successful hi here yet :slight_smile:");
        return;
    }
    //avgHi is undefined until there are at least two his to measure a gap between
    var avg = stat.successful > 1 ? formatDuration(stat.avgHi) : "n/a";
    //board is sorted by successful desc, so index+1 is the rank
    var rank = board.findIndex(function(s){ return s.user == userId; }) + 1;
    var total = board.reduce(function(sum, s){ return sum + s.successful; }, 0);
    var share = (stat.successful / total * 100).toFixed(1);
    message.channel.send(
        "<@" + stat.user + "> your hi stats for this server:\n" +
        "successful his: " + stat.successful + "\n" +
        "average time between his: " + avg + "\n" +
        "rank: #" + rank + " of " + board.length + "\n" +
        "share: " + share + "% of this server's his\n" +
        "last hi: " + new Date(stat.lastHi).toUTCString()
    );
}

async function getFirstHi(message){
    //dedicated command for a user's first hi in this server (HIB-28)
    //firstHi has always been stored (HIB-2) but was never surfaced until now
    var stat = await db.getUserStats(message.member.user.id, message.guild.id);
    if(stat == null || !stat.firstHi){
        message.channel.send("<@" + message.member.user.id + "> you haven't said a successful hi here yet :slight_smile:");
        return;
    }
    message.channel.send("<@" + stat.user + "> your first hi here was " + new Date(stat.firstHi).toUTCString());
}

async function getTopFive(message, client){
    //leaderboard of the most successful hi-ers in this server (HIB-2)
    //full board with HiBot excluded - its revival his shouldn't rank (HIB-28)
    var board = await db.getServerStats(message.guild.id, client.user.id);
    if(board.length == 0){
        message.channel.send("no hi stats recorded for this server yet :slight_smile:");
        return;
    }
    var userId = message.member.user.id;
    function line(stat, rank){
        //prefer a cached display name, fall back to a mention; flag the requester
        var member = message.guild.members.cache.get(stat.user);
        var name = member ? member.displayName : "<@" + stat.user + ">";
        var you = stat.user == userId ? " (you)" : "";
        return rank + ". " + name + " - " + stat.successful + " his" + you;
    }
    var lines = board.slice(0, 5).map(function(stat, i){ return line(stat, i + 1); });
    //if the requester isn't in the top 5, append their own rank so they can see it (HIB-28)
    var rank = board.findIndex(function(s){ return s.user == userId; });
    if(rank >= 5){
        lines.push("...");
        lines.push(line(board[rank], rank + 1));
    }
    message.channel.send("top hi-ers in this server:\n" + lines.join("\n"));
}

module.exports = { getUserStats, getFirstHi, getTopFive };
