require('dotenv').config({ path: './keys.env' })

//import modules (log first: it reads the LOG_* env vars, which dotenv has just loaded)
var log = require("./log");
var logMongo = require("./logMongo");
var logDiscord = require("./logDiscord");
var hi = require("./hi");
var db = require("./db");
var config = require("./config")
var commands = require("./commands/router")
var tools = require("./tools/runner")

// Import discord.js and create the client
const { Client, Events, GatewayIntentBits, Partials } = require('discord.js')
//v14 needs explicit intents. MessageContent is privileged: it must also be switched on for the bot
//in the Discord developer portal, or message.content arrives empty and no hi ever validates.
//Channel partial = DMs (bot admin commands) arrive at all.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

//logs also go to MongoDB (HIB-32). the sink queues lines until the DB is connected (setReady, below)
const mongoLog = logMongo.createMongoSink({ writeBucket: db.writeLogBucket, machine: process.env.FLY_MACHINE_ID });
log.addSink(mongoLog);
//...and, when LOG_WEBHOOK is set, to a Discord channel (HIB-9). a webhook is plain HTTPS, so it still works
//when the bot's gateway connection is down. unset = no Discord logging.
let discordLog = null;
if (process.env.LOG_WEBHOOK) {
  discordLog = logDiscord.createDiscordSink({ url: process.env.LOG_WEBHOOK });
  log.addSink(discordLog);
  discordLog.start();
}
log.info('bot.start', 'starting HiBot', { boot: log.boot, node: process.version, machine: process.env.FLY_MACHINE_ID });

// Register an event so that when the bot is ready, it will log a messsage to the terminal
client.once(Events.ClientReady, async () => {
  log.info('bot.ready', `Logged in as ${client.user.tag}!`, { guilds: client.guilds.cache.size });
  try {
    await db.connect();
  } catch (err) {
    //without the database nothing works. exit so fly restarts us and tries again, rather than
    //sitting "ready" but broken.
    await log.fatal('db.connect.failed', 'could not connect to MongoDB: ' + err.message, err);
    return;
  }
  mongoLog.setReady();
  await config.applyStoredSettings(client);
  hi.restartPings(client);

  //on-demand maintenance tools, gated behind env (TOOLS=true + TOOL_TO_USE=<name>). see tools/runner.js
  if (process.env.TOOLS === 'true') {
    try {
      await tools.runTool(client);
    } catch (err) {
      log.error('tool.failed', 'tool failed: ' + err.message, err);
    }
  }
})

//a stray rejection (e.g. a failed fire-and-forget DB write, HIB-21) is logged and the bot keeps running.
process.on('unhandledRejection', (err) => log.error('unhandled.rejection', 'unhandled rejection: ' + (err && err.message), err));
//anything uncaught is fatal: log it, flush every sink, then exit 1 so fly restarts the machine
//(restart policy 'always'). staying alive after one left the bot running but dead (HIB-31).
process.on('uncaughtException', (err) => log.fatal('fatal', 'uncaught exception: ' + (err && err.message), err));
client.on(Events.Error, (err) => log.error('client.error', 'discord client error: ' + err.message, err));

//the gateway connection is what died in HIB-31, so record every change to it
client.on(Events.ShardDisconnect, (event, id) => log.warn('shard.disconnect', `shard ${id} disconnected (code ${event && event.code})`, { shard: id, code: event && event.code }));
client.on(Events.ShardReconnecting, (id) => log.warn('shard.reconnecting', `shard ${id} reconnecting`, { shard: id }));
client.on(Events.ShardResume, (id, replayed) => log.info('shard.resume', `shard ${id} resumed (${replayed} events replayed)`, { shard: id, replayed: replayed }));
client.on(Events.ShardError, (err, id) => log.error('shard.error', `shard ${id} error: ${err.message}`, { shard: id, err: err }));
client.on(Events.Invalidated, () => log.error('client.invalidated', 'discord session invalidated'));
client.on(Events.Warn, (message) => log.warn('client.warn', message));

//close the DB pool cleanly when the process is told to stop (e.g. on redeploy)
async function shutdown(signal) {
  log.info('bot.shutdown', 'received ' + signal + ', shutting down');
  await log.flush();        //before db.close(): the logs are written through the DB connection
  mongoLog.stop();
  if (discordLog) discordLog.stop();
  await db.close();
  await client.destroy();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

//When joining a server, register with the db
client.on(Events.GuildCreate, guild => {
    log.info('guild.joined', "Joined a new guild: " + guild.name, { guild: guild.id });
    db.newServer(guild.id, guild.channels.cache.find(channel => channel.name === "bot-control"))
})

// Register an event to handle incoming messages
client.on(Events.MessageCreate, async msg => {
    try {
        await hi.checkHi(msg, client);
        await commands.botCommands(msg, client);
    } catch (err) {
        log.error('message.failed', 'message handler failed: ' + err.message, err);
    }
})

// client.login logs the bot in and sets it up for use. You'll enter your token here.
client.login(process.env.LOGIN).catch((err) => log.fatal('login.failed', 'discord login failed: ' + err.message, err));
