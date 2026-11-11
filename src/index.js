//import modules (log first: it reads the LOG_* env vars, so they have to be in the environment already)
var log = require("./logging");
var logSetup = require("./logging/setup");
var health = require("./health");
var db = require("./data/db");
var createClient = require("./discord/client");
var lifecycle = require("./lifecycle");
var ready = require("./events/ready");
var connection = require("./events/connection");
var guildCreate = require("./events/guildCreate");
var guildDelete = require("./events/guildDelete");
var messageCreate = require("./events/messageCreate");
var interactionCreate = require("./events/interactionCreate");

const client = createClient();
const sinks = logSetup.addSinks(db.writeLogBucket);
log.info('bot.start', 'starting HiBot', { boot: log.boot, node: process.version, machine: process.env.FLY_MACHINE_ID });

ready.register(client, sinks.mongoLog);
connection.register(client);
guildCreate.register(client);
guildDelete.register(client);
messageCreate.register(client);
interactionCreate.register(client);

//heartbeat to Healthchecks.io + watchdog (HIB-34). started right away so a login that never completes is caught too
const healthMonitor = health.createHealth({ client: client, log: log, dbConnected: db.isConnected });
healthMonitor.start();

lifecycle.register(client, healthMonitor, sinks);

// client.login logs the bot in and sets it up for use. You'll enter your token here.
client.login(process.env.LOGIN).catch((err) => log.fatal('login.failed', 'discord login failed: ' + err.message, err));
