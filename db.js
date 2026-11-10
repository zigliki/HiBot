//Import MongoDB and set up a single shared client for the whole app.
//Reusing one MongoClient (instead of opening/closing one per operation) keeps the
//driver's connection pool and background heartbeats alive, which stops Atlas from
//auto-pausing the cluster for inactivity (HIB-19).
const { MongoClient } = require('mongodb');
const log = require('./log');
const uri = "mongodb+srv://zigliki-admin:" + process.env.MONGO_PWD + "@hibot.nectjrd.mongodb.net/?retryWrites=true&w=majority";

const client = new MongoClient(uri);
const database = client.db("HiBot");
const hi = database.collection("hi");
const settings = database.collection("settings");
const stats = database.collection("stats");
const logs = database.collection("logs");

//server types that can take writes. if none of the servers are one of these, we've lost the database.
const WRITABLE_TYPES = ["RSPrimary", "Standalone", "Mongos", "LoadBalancer"];

function createTopologyWatcher(logger, now) {
    //turn the driver's topology events into two log lines: db.offline when the database becomes
    //unreachable and db.online when it's back. transitions only - heartbeats fire every ~10s, so
    //logging each one would drown everything. nothing is logged until we've been connected once
    //(a failure to connect at startup is handled by connect()'s caller).
    now = now || Date.now;
    let everUp = false;
    let offlineSince = null;
    let lastFailure = null;
    return {
        heartbeatFailed(ev) {
            lastFailure = ev && ev.failure && ev.failure.message;
        },
        topologyChanged(ev) {
            const up = [...ev.newDescription.servers.values()].some((s) => WRITABLE_TYPES.includes(s.type));
            if (up) {
                if (offlineSince != null) {
                    const downMs = now() - offlineSince;
                    offlineSince = null;
                    logger.warn("db.online", "MongoDB reachable again after " + Math.round(downMs / 1000) + "s", { downMs: downMs });
                }
                everUp = true;
            } else if (everUp && offlineSince == null) {
                offlineSince = now();
                logger.error("db.offline", "lost contact with MongoDB" + (lastFailure ? ": " + lastFailure : ""));
            }
        }
    };
}

const topologyWatcher = createTopologyWatcher(log);
client.on("serverHeartbeatFailed", (ev) => topologyWatcher.heartbeatFailed(ev));
client.on("topologyDescriptionChanged", (ev) => topologyWatcher.topologyChanged(ev));

async function ensureLogIndexes() {
    //logs are stored in daily buckets (see logMongo.js). the TTL index expires whole days; the unique
    //index makes the bucket upsert one lookup and stops a bucket being created twice. a failure here
    //must never stop the bot booting.
    const ttlSeconds = (Number(process.env.LOG_MONGO_TTL_DAYS) || 14) * 86400;
    try {
        await logs.createIndex({ boot: 1, day: 1, part: 1 }, { unique: true });
        try {
            await logs.createIndex({ day: 1 }, { expireAfterSeconds: ttlSeconds });
        } catch (err) {
            //same index, different TTL (LOG_MONGO_TTL_DAYS changed): adjust it in place
            if (err.codeName !== "IndexOptionsConflict" && err.codeName !== "IndexKeySpecsConflict") throw err;
            await database.command({ collMod: "logs", index: { keyPattern: { day: 1 }, expireAfterSeconds: ttlSeconds } });
        }
    } catch (err) {
        log.error("db.index.failed", "could not create the logs indexes: " + err.message, err);
    }
}

async function connect() {
    //connect once at startup so the cluster stays active even while the bot is idle
    await client.connect();
    log.info("db.connected", "connected to MongoDB");
    await ensureLogIndexes();
}

async function aggregateLogs(pipeline) {
    //read-only access for scripts/logs.js
    return await logs.aggregate(pipeline, { allowDiskUse: true }).toArray();
}

async function writeLogBucket(filter, update) {
    //upsert one daily log bucket (the logMongo sink builds the filter/update)
    await logs.updateOne(filter, update, { upsert: true });
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
            nextHi: 0,
            currentChain: { count: 0, participants: {}, startedAt: null, lastTs: null },
            longestChain: { count: 0, participants: {}, startedAt: null, endedAt: null },
            preChain: { count: 0, participants: {}, startedAt: null, endedAt: null }
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
            nextHi: data.nextHi,
            //chain state (HIB-28); default for docs created before chains existed
            currentChain: data.currentChain || { count: 0, participants: {}, startedAt: null, lastTs: null },
            longestChain: data.longestChain || { count: 0, participants: {}, startedAt: null, endedAt: null }
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

async function setChains(serverId, currentChain, longestChain, preChain) {
    //targeted update of just the chain fields - used by the HIB-28 chain backfill so
    //it doesn't clobber live game state (lastUser/lastHi/nextHi/botControl). preChain
    //is the pre-HiBot golden-age longest; runtime never touches it, only the backfill.
    await hi.updateOne({ server: serverId }, { $set: {
        currentChain: currentChain,
        longestChain: longestChain,
        preChain: preChain
    } });
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

async function setStats(userId, serverId, fields) {
    //absolute upsert used by the one-off backfill (HIB-20) - safe to re-run
    const doc = { $set: Object.assign({ user: userId, server: serverId }, fields) };
    await stats.updateOne({ user: userId, server: serverId }, doc, { upsert: true });
}

module.exports = { connect, close, newServer, getHi, setHi, getAllServers, setOutputChannel, getSettings, setSettings, recordHi, getUserStats, getServerStats, setStats, setChains, writeLogBucket, aggregateLogs, createTopologyWatcher }
