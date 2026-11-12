var db = require("../data/db");

function formatDuration(ms){
    //ms -> human-ish "Xd Yh" for stat display
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    return days + "d " + hours + "h";
}

async function getUserStats(ctx, targetId){
    //defaults to the requester; a target (@HiBot stats @user) looks up someone else (HIB-28)
    targetId = targetId || ctx.userId;
    var self = targetId === ctx.userId;
    //rank + share are measured against the leaderboard with HiBot excluded (HIB-28)
    var board = await db.getServerStats(ctx.guildId, ctx.botId);
    var stat = board.find(function(s){ return s.user == targetId; });
    if(stat == null){
        ctx.reply("<@" + targetId + "> " + (self ? "you haven't" : "hasn't") + " said a successful hi here yet :slight_smile:");
        return;
    }
    //avgHi is undefined until there are at least two his to measure a gap between
    var avg = stat.successful > 1 ? formatDuration(stat.avgHi) : "n/a";
    //board is sorted by successful desc, so index+1 is the rank
    var rank = board.findIndex(function(s){ return s.user == targetId; }) + 1;
    var total = board.reduce(function(sum, s){ return sum + s.successful; }, 0);
    var share = (stat.successful / total * 100).toFixed(1);
    var lead = self ? ("<@" + targetId + "> your") : ("<@" + targetId + ">'s");
    ctx.reply(
        lead + " hi stats for this server:\n" +
        "successful hi's: " + stat.successful + "\n" +
        "average time between hi's: " + avg + "\n" +
        "rank: #" + rank + " of " + board.length + "\n" +
        "share: " + share + "% of this server's hi's\n" +
        "last hi: " + new Date(stat.lastHi).toUTCString()
    );
}

async function getFirstHi(ctx, targetId){
    //defaults to the requester; a target (@HiBot first @user) looks up someone else (HIB-28)
    //firstHi has always been stored (HIB-2) but was never surfaced until now
    targetId = targetId || ctx.userId;
    var self = targetId === ctx.userId;
    var stat = await db.getUserStats(targetId, ctx.guildId);
    if(stat == null || !stat.firstHi){
        ctx.reply("<@" + targetId + "> " + (self ? "you haven't" : "hasn't") + " said a successful hi here yet :slight_smile:");
        return;
    }
    var lead = self ? ("<@" + targetId + "> your") : ("<@" + targetId + ">'s");
    ctx.reply(lead + " first hi here was " + new Date(stat.firstHi).toUTCString());
}

async function getChain(ctx, which){
    //`chain` = HiBot-era longest; `chain prebot` = pre-HiBot golden-age longest (HIB-28)
    var pre = ["pre", "prebot", "golden", "goldenage", "gold"].indexOf((which || "").toLowerCase()) !== -1;
    var data = await db.getHi(ctx.guildId);
    var chain = pre ? data.preChain : data.longestChain;
    if(!chain || !chain.count){
        ctx.reply(pre
            ? "the pre-HiBot golden age is only a Shaun The Sheep thing, there's no record of it for this server :slight_smile:"
            : "no hi chain recorded for this server yet :slight_smile:");
        return;
    }
    //participants: { userId: count } -> mention (xN), biggest contributor first
    var parts = Object.keys(chain.participants || {})
        .map(function(uid){ return { uid: uid, n: chain.participants[uid] }; })
        .sort(function(a, b){ return b.n - a.n; })
        //render as mentions for consistent tags; allowedMentions keeps them ping-free
        .map(function(p){ return "<@" + p.uid + "> (x" + p.n + ")"; });
    var label = pre ? "longest pre-HiBot chain (the golden age)" : "longest hi chain in this server";
    var out =
        label + ": " + chain.count + " hi's\n" +
        new Date(chain.startedAt).toUTCString() + " → " + new Date(chain.endedAt).toUTCString() + "\n" +
        "participants: " + parts.join(", ");
    //bonus: the current running chain (HiBot-era view only)
    if(!pre){
        var cur = data.currentChain;
        if(cur && cur.count){
            out += "\ncurrent chain: " + cur.count + " hi's and counting";
        }
    }
    ctx.reply(out);
}

async function getTop(ctx, board){
    //leaderboards for a server, HiBot always excluded (revival his shouldn't rank) - HIB-2/HIB-28
    board = (board || "his").toLowerCase();
    var all = await db.getServerStats(ctx.guildId, ctx.botId);

    switch(board){
        case "his":
            //most successful his (count) - rewards long-term dedication
            sendBoard(ctx, all,
                "top hi-ers in this server:",
                "no hi stats recorded for this server yet :slight_smile:",
                function(stat){ return stat.successful + " hi's"; });
            return;
        case "avg":
        case "average":
            //most consistent: lowest average gap, min 10 his to qualify (HIB-28)
            var ranked = all.filter(function(s){ return s.successful >= 10; })
                            .sort(function(a, b){ return a.avgHi - b.avgHi; });
            sendBoard(ctx, ranked,
                "most consistent hi-ers (lowest avg gap, min 10 hi's):",
                "no one has 10+ hi's in this server yet :slight_smile:",
                function(stat){ return "avg " + formatDuration(stat.avgHi) + " (" + stat.successful + " hi's)"; });
            return;
        default:
            ctx.reply("unknown leaderboard \"" + board + "\" - try: `top`, `top average`");
    }
}

function sendBoard(ctx, board, header, emptyMsg, valueFn){
    //render a top-5 leaderboard; if the requester isn't in the top 5, append their rank (HIB-28)
    var userId = ctx.userId;
    if(board.length == 0){
        ctx.reply(emptyMsg);
        return;
    }
    function line(stat, rank){
        //always render as a mention so names are consistent and the requester gets a
        //ping; allowedMentions (see reply) suppresses pings for everyone else (HIB-28)
        var you = stat.user == userId ? " (you)" : "";
        return rank + ". <@" + stat.user + "> - " + valueFn(stat) + you;
    }
    var lines = board.slice(0, 5).map(function(stat, i){ return line(stat, i + 1); });
    var rank = board.findIndex(function(s){ return s.user == userId; });
    if(rank >= 5){
        lines.push("...");
        lines.push(line(board[rank], rank + 1));
    }
    ctx.reply(header + "\n" + lines.join("\n"));
}

module.exports = { getUserStats, getFirstHi, getTop, getChain };
