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

module.exports = { connect, close, newServer, getHi, setHi, getAllServers, setOutputChannel, getSettings, setSettings }
