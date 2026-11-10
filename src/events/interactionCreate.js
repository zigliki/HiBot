const { Events, MessageFlags } = require("discord.js");
var log = require("../logging");
var logContext = require("../logging/context");
var slash = require("../commands/slash");
var commandLog = require("../commands/run");
var commandContext = require("../discord/commandContext");

function optionsText(interaction){
    //what was typed, e.g. "board:average", for the log
    return interaction.options.data.map(option => option.name + ":" + option.value).join(" ");
}

async function handle(interaction, client){
    if(!interaction.isChatInputCommand()) return;
    var who = logContext.forInteraction(interaction);
    var command = slash.byName[interaction.commandName];

    if(!command){
        commandLog.unknown(interaction.commandName, "slash", who);
        await interaction.reply({ content: "I don't know that command", flags: MessageFlags.Ephemeral });
        return;
    }
    if(command.allowed && !command.allowed(interaction)){
        commandLog.denied(command.data.name, "slash", who);
        await interaction.reply({ content: "you need to be a server admin to use that", flags: MessageFlags.Ephemeral });
        return;
    }

    //discord only waits 3 seconds for a first answer, so say we're working on it before the db lookups
    await interaction.deferReply(command.ephemeral ? { flags: MessageFlags.Ephemeral } : {});
    var ctx = commandContext.fromInteraction(interaction, client);
    var ok = await commandLog.run(command.data.name, optionsText(interaction), "slash", who, () => command.execute(ctx, interaction, client));
    if(!ok && !ctx.replied){
        await interaction.editReply({ content: "something went wrong, please try again" });
    }
}

function register(client){
    client.on(Events.InteractionCreate, interaction => {
        handle(interaction, client).catch(err => {
            //e.g. the interaction expired before we could answer it
            log.error("command.failed", "couldn't answer a slash command: " + err.message, Object.assign({ err: err }, logContext.forInteraction(interaction)));
        });
    });
}

module.exports = { register, handle };
