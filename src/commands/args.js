function parseUserId(arg){
    //pull a user id out of a mention arg; accept both <@id> and <@!id> (nickname)
    var m = arg && arg.match(/^<@!?(\d+)>$/);
    return m ? m[1] : null;
}

module.exports = { parseUserId };
