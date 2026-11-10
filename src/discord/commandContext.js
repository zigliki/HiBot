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

function fromInteraction(interaction, client){
    var userId = interaction.user.id;
    var ctx = {
        guildId: interaction.guildId,
        userId: userId,
        botId: client.user.id,
        replied: false,
        reply: function(content){
            //same rule as a message: only ping the requester
            var payload = { content: content, allowedMentions: { users: [userId] } };
            //the first reply fills in the deferred "thinking..." message, any more are follow-ups
            var sent = ctx.replied ? interaction.followUp(payload) : interaction.editReply(payload);
            ctx.replied = true;
            return sent;
        }
    };
    return ctx;
}

module.exports = { fromMessage, fromInteraction };
