require('dotenv').config({ path: './keys.env' })

//import modules
var hi = require("./hi");
var db = require("./db");
var cmd = require("./botControl")

// Import discord.js and create the client
const Discord = require('discord.js')
const client = new Discord.Client();

// Register an event so that when the bot is ready, it will log a messsage to the terminal
client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  await db.connect();
  await cmd.applyStoredSettings(client);
  hi.restartPings(client);
})

//close the DB pool cleanly when the process is told to stop (e.g. on redeploy)
async function shutdown() {
  await db.close();
  await client.destroy();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

//When joining a server, register with the db
client.on("guildCreate", guild => {
    console.log("Joined a new guild: " + guild.name);
    db.newServer(guild.id, guild.channels.cache.find(channel => channel.name === "bot-control"))
})

// Register an event to handle incoming messages
client.on('message', async msg => {
    hi.checkHi(msg, client);
    cmd.botCommands(msg, client);
})

// client.login logs the bot in and sets it up for use. You'll enter your token here.
client.login(process.env.LOGIN);