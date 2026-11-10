const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, ChannelType } = require("discord.js");
var stats = require("./stats");
var admin = require("./admin");

//slash commands are a second way to run the same commands as the @HiBot text ones, so they call the same handlers
//data is what gets registered with Discord, execute(ctx, interaction, client) runs the command. ephemeral = only the
//requester sees the reply. allowed(interaction) is checked again here, Discord's own permission hiding isn't enough
const GUILD_ONLY = InteractionContextType.Guild;

function isServerAdmin(interaction){
    //same rule as the text command: Administrator in this server, or the bot admin (DEV)
    return interaction.memberPermissions.has(PermissionFlagsBits.Administrator) || interaction.user.id == process.env.DEV;
}

function targetId(interaction){
    //the optional user picked, or undefined to mean the requester
    var user = interaction.options.getUser("user");
    return user ? user.id : undefined;
}

const commands = [
    {
        data: new SlashCommandBuilder()
            .setName("stats")
            .setDescription("Show hi stats for you or another member")
            .setContexts(GUILD_ONLY)
            .addUserOption(option => option.setName("user").setDescription("Whose stats to show (default: you)")),
        execute: (ctx, interaction) => stats.getUserStats(ctx, targetId(interaction))
    },
    {
        data: new SlashCommandBuilder()
            .setName("first")
            .setDescription("Show when you or another member first said hi")
            .setContexts(GUILD_ONLY)
            .addUserOption(option => option.setName("user").setDescription("Whose first hi to show (default: you)")),
        execute: (ctx, interaction) => stats.getFirstHi(ctx, targetId(interaction))
    },
    {
        data: new SlashCommandBuilder()
            .setName("top")
            .setDescription("Show the hi leaderboard")
            .setContexts(GUILD_ONLY)
            .addStringOption(option => option.setName("board").setDescription("Which leaderboard (default: most hi's)")
                .addChoices({ name: "most hi's", value: "his" }, { name: "lowest average gap", value: "average" })),
        execute: (ctx, interaction) => stats.getTop(ctx, interaction.options.getString("board") || undefined)
    },
    {
        data: new SlashCommandBuilder()
            .setName("chain")
            .setDescription("Show the longest hi chain")
            .setContexts(GUILD_ONLY)
            .addStringOption(option => option.setName("era").setDescription("Which era (default: HiBot)")
                .addChoices({ name: "HiBot", value: "hibot" }, { name: "pre-HiBot golden age", value: "prebot" })),
        execute: (ctx, interaction) => stats.getChain(ctx, interaction.options.getString("era") == "prebot" ? "prebot" : undefined)
    },
    {
        data: new SlashCommandBuilder()
            .setName("output")
            .setDescription("Set the channel where the bot explains why it deleted a message")
            .setContexts(GUILD_ONLY)
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addChannelOption(option => option.setName("channel").setDescription("The bot-control channel").setRequired(true).addChannelTypes(ChannelType.GuildText)),
        ephemeral: true,
        allowed: isServerAdmin,
        execute: async (ctx, interaction, client) => {
            var channel = interaction.options.getChannel("channel");
            await admin.setOutputChannel(client, ctx.guildId, channel.id);
            await ctx.reply("output channel set to <#" + channel.id + ">");
        }
    }
];

//name -> command, for the interactionCreate handler
const byName = {};
commands.forEach(command => { byName[command.data.name] = command; });

module.exports = { commands, byName };
