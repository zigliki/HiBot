//what a command handler needs from whoever ran it: the guild, the requester and a way to reply
//the same handlers serve a text message now and a slash command later (HIB-37)
function fromMessage(message, client){
    var userId = message.member.user.id;
    return {
        guildId: message.guild.id,
        userId: userId,
        botId: client.user.id,
        reply: function(content){
            //stats output names lots of users; only ever ping the requester, so running
            //`top`/`chain` etc. doesn't notify everyone on the board (HIB-28). Other <@id>
            //mentions still render as names, just without a ping.
            return message.channel.send({ content: content, allowedMentions: { users: [userId] } });
        }
    };
}

module.exports = { fromMessage };
