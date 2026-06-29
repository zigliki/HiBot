//Import MongoDB and setup connection
var uri = "mongodb+srv://zigliki-admin:" + process.env.MONGO_PWD + "@hibot.nectjrd.mongodb.net/?retryWrites=true&w=majority";
var MongoClient = require('mongodb');

async function newServer(serverId, botChannel) {
    //connect to DB
    const dbclient = new MongoClient.MongoClient(uri);
    const database = dbclient.db("HiBot");
    const collection = database.collection("hi");

    //check to see if the server has been connected before
    const query = { server: serverId };
    var server = await collection.findOne(query);
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
        const result = await collection.insertOne(doc);
    }

    await dbclient.close();
}

async function setHi(data) {
    //connect to DB
    const dbclient = new MongoClient.MongoClient(uri);
    const database = dbclient.db("HiBot");
    const collection = database.collection("hi");

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
    const result = await collection.updateOne(query, doc);

    await dbclient.close();
}

async function getHi(serverId) {
    //conect to DB
    const dbclient = new MongoClient.MongoClient(uri);
    const database = dbclient.db("HiBot");
    const collection = database.collection("hi");

    //get the file that has the data
    const query = { server: serverId };
    var server = await collection.findOne(query);
    if (server == null) {
        await newServer(serverId);
        server = await collection.findOne(query);
    }

    await dbclient.close();
    return (server);
}

async function getAllServers() {
    //connect to DB
    const dbclient = new MongoClient.MongoClient(uri);
    const database = dbclient.db("HiBot");
    const collection = database.collection("hi");

    //get every server document
    var servers = await collection.find({}).toArray();

    await dbclient.close();
    return (servers);
}

async function setOutputChannel(serverId, channelId){
   //connect to DB
   const dbclient = new MongoClient.MongoClient(uri);
   const database = dbclient.db("HiBot");
   const collection = database.collection("hi");

   //set updates then push
   const doc = {
       $set: {
           botControl: channelId,
       },
   }
   const query = { server: serverId };
   const result = await collection.updateOne(query, doc);

   await dbclient.close();
}

async function getSettings() {
    //connect to DB
    const dbclient = new MongoClient.MongoClient(uri);
    const database = dbclient.db("HiBot");
    const collection = database.collection("settings");

    //bot-wide settings live in a single document
    var settings = await collection.findOne({});

    await dbclient.close();
    return (settings);
}

async function setSettings(updates) {
    //connect to DB
    const dbclient = new MongoClient.MongoClient(uri);
    const database = dbclient.db("HiBot");
    const collection = database.collection("settings");

    //merge the passed fields into the single settings document
    const doc = { $set: updates };
    await collection.updateOne({}, doc, { upsert: true });

    await dbclient.close();
}

module.exports = { newServer, getHi, setHi, getAllServers, setOutputChannel, getSettings, setSettings }