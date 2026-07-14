//Import MongoDB and set up a single shared client for the whole app.
//Reusing one MongoClient (instead of opening/closing one per operation) keeps the
//driver's connection pool and background heartbeats alive, which stops Atlas from
//auto-pausing the cluster for inactivity (HIB-19).
const { MongoClient } = require('mongodb');
const uri = "mongodb+srv://zigliki-admin:" + process.env.MONGO_PWD + "@hibot.nectjrd.mongodb.net/?retryWrites=true&w=majority";

const client = new MongoClient(uri);
const database = client.db("HiBot");
const hi = database.collection("hi");
const settings = database.collection("settings");
const stats = database.collection("stats");

async function connect() {
    //connect once at startup so the cluster stays active even while the bot is idle
    await client.connect();
    console.log("connected to MongoDB");
}

async function close() {
    //close the pool cleanly on shutdown
    await client.close();
}

async function newServer(serverId, botChannel) {
    //check to see if the server has been connected before
    const query = { server: serverId };
    var server = await hi.findOne(query);
    if (server == null) {
        //new to server
        //create document then push
        const doc = {
            server: serverId,
            botControl: botChannel,
            lastUser: 0,
            lastHi: 0,
            nextHi: 0
        }
        await hi.insertOne(doc);
    }
}

async function setHi(data) {
    //set updates then push
    const doc = {
        $set: {
            server: data.server,
            botControl: data.botControl,
            lastUser: data.lastUser,
            lastHi: data.lastHi,
            nextHi: data.nextHi
        },
    }
    const query = { server: data.server };
    await hi.updateOne(query, doc);
}

async function getHi(serverId) {
    //get the file that has the data
    const query = { server: serverId };
    var server = await hi.findOne(query);
    if (server == null) {
        await newServer(serverId);
        server = await hi.findOne(query);
    }
    return (server);
}

async function getAllServers() {
    //get every server document
    return await hi.find({}).toArray();
}

async function setOutputChannel(serverId, channelId){
    //set updates then push
    const doc = {
        $set: {
            botControl: channelId,
        },
    }
    const query = { server: serverId };
    await hi.updateOne(query, doc);
}

async function getSettings() {
    //bot-wide settings live in a single document
    return await settings.findOne({});
}

async function setSettings(updates) {
    //merge the passed fields into the single settings document
    await settings.updateOne({}, { $set: updates }, { upsert: true });
}

async function recordHi(userId, serverId, timestamp) {
    //per-user, per-server stats. this is the ONLY writer, so all derived fields
    //(avgHi) are recomputed here together and can't drift out of sync (HIB-2).
    const query = { user: userId, server: serverId };
    var stat = await stats.findOne(query);

    if (stat == null) {
        //first hi for this user in this server
        const doc = {
            user: userId,
            server: serverId,
            successful: 1,
            avgHi: 0,
            firstHi: timestamp,
            lastHi: timestamp
        }
        await stats.insertOne(doc);
        return;
    }

    //average gap between this user's his = total span / number of gaps
    const successful = stat.successful + 1;
    const avgHi = Math.round((timestamp - stat.firstHi) / (successful - 1));
    const doc = {
        $set: {
            successful: successful,
            avgHi: avgHi,
            lastHi: timestamp
        }
    }
    await stats.updateOne(query, doc);
}

async function getUserStats(userId, serverId) {
    //one user's stats in one server
    return await stats.findOne({ user: userId, server: serverId });
}

async function getServerStats(serverId, excludeUserId) {
    //every user's stats for a server, most successful first; optionally exclude one
    //user (HiBot excludes itself so its revival his don't skew rank/total) - HIB-28
    const query = { server: serverId };
    if (excludeUserId != null) query.user = { $ne: excludeUserId };
    return await stats.find(query).sort({ successful: -1 }).toArray();
}

async function getTopStats(serverId, limit, excludeUserId) {
    //leaderboard for a server, most successful his first; excludeUserId keeps HiBot
    //off the board (its stats are saved intentionally but shouldn't rank) - HIB-28
    const query = { server: serverId };
    if (excludeUserId != null) query.user = { $ne: excludeUserId };
    return await stats.find(query).sort({ successful: -1 }).limit(limit).toArray();
}

async function setStats(userId, serverId, fields) {
    //absolute upsert used by the one-off backfill (HIB-20) - safe to re-run
    const doc = { $set: Object.assign({ user: userId, server: serverId }, fields) };
    await stats.updateOne({ user: userId, server: serverId }, doc, { upsert: true });
}

module.exports = { connect, close, newServer, getHi, setHi, getAllServers, setOutputChannel, getSettings, setSettings, recordHi, getUserStats, getServerStats, getTopStats, setStats }
