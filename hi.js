var db = require("./db");

const DAY_IN_MILLIS = 86400000;
const PING_DELAY = DAY_IN_MILLIS * 7;
const pingArray = Object.create(null);

function schedulePing(server, channel, delay) {
    //(re)arm the ping timer for a server. when it fires, the bot says hi
    clearTimeout(pingArray[server]);
    pingArray[server] = setTimeout(function () {
        channel.send("hi");
    }, delay);
}

async function restartPings(client) {
    //rebuild the in-memory ping timers from the DB after a restart
    console.log("restarting ping timers");
    var servers = await db.getAllServers();
    for (const data of servers) {
        //the bot only ever pings to revive the chain; skip if the last hi was the bot's
        if (data.lastUser == client.user.id) continue;
        //skip servers that have never had a hi
        if (!data.lastHi) continue;

        var guild = client.guilds.cache.get(data.server);
        if (typeof guild == 'undefined') {
            console.log("  no longer in guild " + data.server + ", skipping");
            continue;
        }
        var channel = guild.channels.cache.find(channel => channel.name === "hi");
        if (typeof channel == 'undefined') {
            console.log("  no #hi channel in " + guild.name + ", skipping");
            continue;
        }

        //fire 7 days after the last hi, or right away if that's already passed
        var delay = Math.max(0, data.lastHi + PING_DELAY - Date.now());
        console.log("  scheduling ping for " + guild.name + " in " + msToTime(delay));
        schedulePing(data.server, channel, delay);
    }
}

function advanceChain(data, userId, timestamp, botId){
    //track the server's chain of consecutive valid hi's (HIB-28).
    //chain boundary = the bot's revival hi: reaching it means the previous chain
    //died (7 days quiet), so the bot's hi counts for no chain and the next human
    //hi starts a fresh one.
    if(userId == botId){
        data.currentChain = { count: 0, participants: {}, startedAt: null };
        return;
    }
    var cur = data.currentChain || { count: 0, participants: {}, startedAt: null };
    cur.participants = cur.participants || {};
    if(cur.count == 0) cur.startedAt = timestamp;
    cur.count += 1;
    cur.participants[userId] = (cur.participants[userId] || 0) + 1;
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
        console.log("[" + msg.createdTimestamp + "]: \"" + msg.content + "\" from " + msg.member.user.tag)
        if(msg.content == "hi"){
            //message is hi
            console.log("  next \"hi\" expected at " + data.nextHi)
            if(msg.createdTimestamp < data.nextHi){
                //not long enough since last hi
                console.log("  not long enough since last \"hi\"")
                console.log("  deleting \"hi\"")
                msg.delete();
                //inform user why their hi is bad
                if (typeof botControlChannel != 'undefined')
                    botControlChannel.send("Sorry <@" + msg.member.user.id + ">, you tried to say hi too soon :frowning: \nThe next hi can occur in " + msToTime(data.nextHi - msg.createdTimestamp));
            } else{
                //24 hours since last hi
                if(msg.member.user.id == data.lastUser){
                    //invalid hi
                    console.log("  same user as last \"hi\"")
                    console.log("  deleting \"hi\"")
                    msg.delete();
                    //inform user why their hi is bad
                   if (typeof botControlChannel != 'undefined')
                    botControlChannel.send("Sorry <@" + msg.member.user.id + ">, you said the last hi\nLet somebody else say hi first :slight_smile:");
                } else {
                    //valid new hi
                    console.log("  valid \"hi\" from " + msg.member.user.tag)
                    console.log("  updating data")
                    data.lastHi = msg.createdTimestamp
                    data.nextHi = data.lastHi + DAY_IN_MILLIS;
                    data.lastUser = msg.member.user.id;
                    //maintain the server's hi chain (HIB-28)
                    advanceChain(data, msg.member.user.id, msg.createdTimestamp, client.user.id);
                    if(data.lastUser != client.user.id){
                        //if the last hi wasn't from the bot, set up a ping for 7 days
                        console.log("  resetting ping timer")
                        schedulePing(data.server, msg.channel, PING_DELAY);
                    }
                    db.setHi(data);
                    //record the successful hi against the user's stats (HIB-2)
                    db.recordHi(msg.member.user.id, msg.guild.id, msg.createdTimestamp);
                }
            }
        } else {
            //message is not hi
            console.log("  message is not \"hi\"")
            console.log("  deleting message")
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