//meta for log lines about a guild (and a user). the sinks print guildName as the [guild] prefix
function forGuild(guild){
    return guild ? { guild: guild.id, guildName: guild.name } : {};
}

function forMessage(msg){
    //a DM has no member, so fall back to the author
    var user = (msg.member && msg.member.user) || msg.author;
    return Object.assign(forGuild(msg.guild), user ? { user: user.id, userTag: user.tag } : {});
}

function forInteraction(interaction){
    return Object.assign(forGuild(interaction.guild), { user: interaction.user.id, userTag: interaction.user.tag });
}

module.exports = { forGuild, forMessage, forInteraction };
