//meta for log lines about a guild (and a user). the sinks print guildName as the [guild] prefix
function forGuild(guild){
    return guild ? { guild: guild.id, guildName: guild.name } : {};
}

function forMessage(msg){
    var user = msg.member && msg.member.user;
    return Object.assign(forGuild(msg.guild), user ? { user: user.id, userTag: user.tag } : {});
}

module.exports = { forGuild, forMessage };
