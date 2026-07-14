var db = require("../db");

function formatDuration(ms){
    //ms -> human-ish "Xd Yh" for stat display
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    return days + "d " + hours + "h";
}

function reply(message, content){
    //stats output names lots of users; only ever ping the requester, so running
    //`top`/`chain` etc. doesn't notify everyone on the board (HIB-28). Other <@id>
    //mentions still render as names, just without a ping.
    return message.channel.send(content, { allowedMentions: { users: [message.member.user.id] } });
}

function parseUserId(arg){
    //pull a user id out of a mention arg; accept both <@id> and <@!id> (nickname)
    var m = arg && arg.match(/^<@!?(\d+)>$/);
    return m ? m[1] : null;
}

async function getUserStats(message, client, targetArg){
    //defaults to the requester; a mention arg (@HiBot stats @user) looks up someone else (HIB-28)
    var targetId = parseUserId(targetArg) || message.member.user.id;
    var self = targetId === message.member.user.id;
    //rank + share are measured against the leaderboard with HiBot excluded (HIB-28)
    var board = await db.getServerStats(message.guild.id, client.user.id);
    var stat = board.find(function(s){ return s.user == targetId; });
    if(stat == null){
        reply(message,"<@" + targetId + "> " + (self ? "you haven't" : "hasn't") + " said a successful hi here yet :slight_smile:");
        return;
    }
    //avgHi is undefined until there are at least two his to measure a gap between
    var avg = stat.successful > 1 ? formatDuration(stat.avgHi) : "n/a";
    //board is sorted by successful desc, so index+1 is the rank
    var rank = board.findIndex(function(s){ return s.user == targetId; }) + 1;
    var total = board.reduce(function(sum, s){ return sum + s.successful; }, 0);
    var share = (stat.successful / total * 100).toFixed(1);
    var lead = self ? ("<@" + targetId + "> your") : ("<@" + targetId + ">'s");
    reply(message,
        lead + " hi stats for this server:\n" +
        "successful hi's: " + stat.successful + "\n" +
        "average time between hi's: " + avg + "\n" +
        "rank: #" + rank + " of " + board.length + "\n" +
        "share: " + share + "% of this server's hi's\n" +
        "last hi: " + new Date(stat.lastHi).toUTCString()
    );
}

async function getFirstHi(message, targetArg){
    //defaults to the requester; a mention arg (@HiBot first @user) looks up someone else (HIB-28)
    //firstHi has always been stored (HIB-2) but was never surfaced until now
    var targetId = parseUserId(targetArg) || message.member.user.id;
    var self = targetId === message.member.user.id;
    var stat = await db.getUserStats(targetId, message.guild.id);
    if(stat == null || !stat.firstHi){
        reply(message,"<@" + targetId + "> " + (self ? "you haven't" : "hasn't") + " said a successful hi here yet :slight_smile:");
        return;
    }
    var lead = self ? ("<@" + targetId + "> your") : ("<@" + targetId + ">'s");
    reply(message, lead + " first hi here was " + new Date(stat.firstHi).toUTCString());
}

async function getChain(message){
    //show the server's longest chain of consecutive valid hi's + who was in it (HIB-28)
    var data = await db.getHi(message.guild.id);
    var longest = data.longestChain;
    if(!longest || !longest.count){
        reply(message,"no hi chain recorded for this server yet :slight_smile:");
        return;
    }
    //participants: { userId: count } -> "name (xN)", biggest contributor first
    var parts = Object.keys(longest.participants || {})
        .map(function(uid){ return { uid: uid, n: longest.participants[uid] }; })
        .sort(function(a, b){ return b.n - a.n; })
        .map(function(p){
            var member = message.guild.members.cache.get(p.uid);
            var name = member ? member.displayName : "<@" + p.uid + ">";
            return name + " (x" + p.n + ")";
        });
    var out =
        "longest hi chain in this server: " + longest.count + " hi's\n" +
        new Date(longest.startedAt).toUTCString() + " → " + new Date(longest.endedAt).toUTCString() + "\n" +
        "participants: " + parts.join(", ");
    //bonus: how the current running chain compares
    var cur = data.currentChain;
    if(cur && cur.count){
        out += "\ncurrent chain: " + cur.count + " hi's and counting";
    }
    reply(message,out);
}

async function getTop(message, client, board){
    //leaderboards for a server, HiBot always excluded (revival his shouldn't rank) - HIB-2/HIB-28
    board = (board || "his").toLowerCase();
    var all = await db.getServerStats(message.guild.id, client.user.id);
    var userId = message.member.user.id;

    switch(board){
        case "his":
            //most successful his (count) - rewards long-term dedication
            sendBoard(message, all, userId,
                "top hi-ers in this server:",
                "no hi stats recorded for this server yet :slight_smile:",
                function(stat){ return stat.successful + " hi's"; });
            return;
        case "avg":
        case "average":
            //most consistent: lowest average gap, min 10 his to qualify (HIB-28)
            var ranked = all.filter(function(s){ return s.successful >= 10; })
                            .sort(function(a, b){ return a.avgHi - b.avgHi; });
            sendBoard(message, ranked, userId,
                "most consistent hi-ers (lowest avg gap, min 10 hi's):",
                "no one has 10+ hi's in this server yet :slight_smile:",
                function(stat){ return "avg " + formatDuration(stat.avgHi) + " (" + stat.successful + " hi's)"; });
            return;
        default:
            reply(message,"unknown leaderboard \"" + board + "\" - try: `top`, `top average`");
    }
}

function sendBoard(message, board, userId, header, emptyMsg, valueFn){
    //render a top-5 leaderboard; if the requester isn't in the top 5, append their rank (HIB-28)
    if(board.length == 0){
        reply(message,emptyMsg);
        return;
    }
    function line(stat, rank){
        //prefer a cached display name, fall back to a mention; flag the requester
        var member = message.guild.members.cache.get(stat.user);
        var name = member ? member.displayName : "<@" + stat.user + ">";
        var you = stat.user == userId ? " (you)" : "";
        return rank + ". " + name + " - " + valueFn(stat) + you;
    }
    var lines = board.slice(0, 5).map(function(stat, i){ return line(stat, i + 1); });
    var rank = board.findIndex(function(s){ return s.user == userId; });
    if(rank >= 5){
        lines.push("...");
        lines.push(line(board[rank], rank + 1));
    }
    reply(message,header + "\n" + lines.join("\n"));
}

module.exports = { getUserStats, getFirstHi, getTop, getChain };
