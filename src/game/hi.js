var db = require("../data/db");
var log = require("../logging");
var logContext = require("../logging/context");

const DAY_IN_MILLIS = 86400000;
const PING_DELAY = DAY_IN_MILLIS * 7;
const pingArray = Object.create(null);

function schedulePing(server, channel, delay) {
    //(re)arm the ping timer for a server. when it fires, the bot says hi
    clearTimeout(pingArray[server]);
    pingArray[server] = setTimeout(function () {
        var where = logContext.forGuild(channel.guild);
        log.info("ping.fired", "ping fired, saying hi", where);
        channel.send("hi").catch(function (err) {
            log.error("ping.failed", "couldn't post the ping: " + err.message, Object.assign({ err: err }, where));
        });
    }, delay);
}

async function restartPings(client) {
    //rebuild the in-memory ping timers from the DB after a restart
    log.info("ping.restart", "restarting ping timers");
    var servers = await db.getAllServers();
    for (const data of servers) {
        //the bot only ever pings to revive the chain; skip if the last hi was the bot's
        if (data.lastUser == client.user.id) continue;
        //skip servers that have never had a hi
        if (!data.lastHi) continue;

        var guild = client.guilds.cache.get(data.server);
        if (typeof guild == 'undefined') {
            log.info("ping.skip", "ping skipped, the bot is no longer in this server", { guild: data.server });
            continue;
        }
        var channel = guild.channels.cache.find(channel => channel.name === "hi");
        if (typeof channel == 'undefined') {
            log.info("ping.skip", "ping skipped, no #hi channel", logContext.forGuild(guild));
            continue;
        }

        //fire 7 days after the last hi, or right away if that's already passed
        var delay = Math.max(0, data.lastHi + PING_DELAY - Date.now());
        log.info("ping.scheduled", "ping scheduled in " + msToTime(delay), Object.assign({ inMs: delay }, logContext.forGuild(guild)));
        schedulePing(data.server, channel, delay);
    }
}

function advanceChain(data, userId, timestamp, botId, gapMs){
    //track the server's chain of consecutive valid hi's (HIB-28). A chain breaks on:
    //  - a bot revival hi (post-deploy): the bot only his to revive a dead chain, so
    //    its hi is a boundary and never counts as a participant; the next human hi
    //    starts a fresh chain.
    //  - a gap of >= the break threshold between valid his: that long a quiet stretch
    //    means the chain died. Defaults to PING_DELAY (7d, the revival window); the
    //    backfill passes a tighter value for the pre-HiBot golden age (played daily).
    var gap = gapMs || PING_DELAY;
    if(userId == botId){
        data.currentChain = { count: 0, participants: {}, startedAt: null, lastTs: null };
        return;
    }
    var cur = data.currentChain || { count: 0, participants: {}, startedAt: null, lastTs: null };
    cur.participants = cur.participants || {};
    //a long quiet gap means the previous chain died - start a new one from this hi
    if(cur.count > 0 && cur.lastTs != null && (timestamp - cur.lastTs) >= gap){
        cur = { count: 0, participants: {}, startedAt: null, lastTs: null };
    }
    if(cur.count == 0) cur.startedAt = timestamp;
    cur.count += 1;
    cur.participants[userId] = (cur.participants[userId] || 0) + 1;
    cur.lastTs = timestamp;
    data.currentChain = cur;
    //longestChain is a live snapshot of the record, including the ongoing chain
    var longest = data.longestChain || { count: 0 };
    if(cur.count > longest.count){
        data.longestChain = {
            count: cur.count,
            participants: Object.assign({}, cur.participants),
            startedAt: cur.startedAt,
            endedAt: timestamp
        };
    }
}

async function checkHi(msg, client){
    if(msg.channel.name == "hi"){
        //check that the message was sent to #hi

        //get data from DB
        var data = await db.getHi(msg.guild.id);
        var botControlChannel = msg.guild.channels.cache.find(channel => channel.id === data.botControl)

        //log and process hi
        var who = logContext.forMessage(msg);
        var name = msg.member.user.id == client.user.id ? "HiBot" : msg.member.user.tag;
        log.debug("hi.message", name + " said \"" + msg.content + "\"", who)
        if(msg.content == "hi"){
            //message is hi
            log.debug("hi.expected", "next \"hi\" expected at " + data.nextHi, who)
            if(msg.createdTimestamp < data.nextHi){
                //not long enough since last hi
                log.info("hi.rejected.toosoon", name + " said hi too soon, deleted it", who)
                msg.delete();
                //inform user why their hi is bad
                if (typeof botControlChannel != 'undefined')
                    botControlChannel.send("Sorry <@" + msg.member.user.id + ">, you tried to say hi too soon :frowning: \nThe next hi can occur in " + msToTime(data.nextHi - msg.createdTimestamp));
            } else{
                //24 hours since last hi
                if(msg.member.user.id == data.lastUser){
                    //invalid hi
                    log.info("hi.rejected.sameuser", name + " said hi twice in a row, deleted it", who)
                    msg.delete();
                    //inform user why their hi is bad
                   if (typeof botControlChannel != 'undefined')
                    botControlChannel.send("Sorry <@" + msg.member.user.id + ">, you said the last hi\nLet somebody else say hi first :slight_smile:");
                } else {
                    //valid new hi
                    log.info("hi.valid", name + " said hi" + (msg.member.user.id == client.user.id ? " (ping)" : ""), who)
                    data.lastHi = msg.createdTimestamp
                    data.nextHi = data.lastHi + DAY_IN_MILLIS;
                    data.lastUser = msg.member.user.id;
                    //maintain the server's hi chain (HIB-28)
                    advanceChain(data, msg.member.user.id, msg.createdTimestamp, client.user.id);
                    if(data.lastUser != client.user.id){
                        //if the last hi wasn't from the bot, set up a ping for 7 days
                        log.debug("ping.reset", "ping timer reset", who)
                        schedulePing(data.server, msg.channel, PING_DELAY);
                    }
                    db.setHi(data);
                    //record the successful hi against the user's stats (HIB-2)
                    db.recordHi(msg.member.user.id, msg.guild.id, msg.createdTimestamp);
                }
            }
        } else {
            //message is not hi
            log.info("hi.rejected.nothi", name + " said something that isn't hi, deleted it", who)
            msg.delete();
            //inform user that only hi is allowed
           if (typeof botControlChannel != 'undefined')
            botControlChannel.send("Only hi is allowed in <#" + msg.channel.id + "> <@" + msg.member.user.id + "> :rage:");
        }
    }
}

function msToTime(duration) {
    var milliseconds = Math.floor((duration % 1000) / 100),
      seconds = Math.floor((duration / 1000) % 60),
      minutes = Math.floor((duration / (1000 * 60)) % 60),
      hours = Math.floor((duration / (1000 * 60 * 60)) % 24);
  
    hours = (hours < 10) ? "0" + hours : hours;
    minutes = (minutes < 10) ? "0" + minutes : minutes;
    seconds = (seconds < 10) ? "0" + seconds : seconds;
  
    return hours + ":" + minutes + ":" + seconds;
  }

module.exports = { checkHi, restartPings, advanceChain };