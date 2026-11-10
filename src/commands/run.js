var log = require("../logging");

//one place that logs every command, for text messages ("text", "dm") and slash commands ("slash") alike (HIB-38)
const MAX_ARGS = 200;

function describe(name, args, via){
    var shown = (args || "").slice(0, MAX_ARGS);
    var command = via == "slash" ? "/" + name : (via == "dm" ? name : "@HiBot " + name);
    return command + (shown ? " " + shown : "") + (via == "dm" ? " (DM)" : "");
}

function who(meta){
    return meta.userTag || meta.user;
}

//run a command handler: log that it ran, and log (not throw) if it fails. true if it finished
async function run(name, args, via, meta, handler){
    log.info("command.run", who(meta) + " ran " + describe(name, args, via), Object.assign({ command: name, args: args, via: via }, meta));
    try {
        await handler();
        return true;
    } catch(err) {
        log.error("command.failed", describe(name, args, via) + " failed: " + err.message, Object.assign({ command: name, via: via, err: err }, meta));
        return false;
    }
}

//the person isn't allowed to run it, so it was ignored
function denied(name, via, meta){
    log.warn("command.denied", who(meta) + " tried to run " + describe(name, "", via) + " without permission", Object.assign({ command: name, via: via }, meta));
}

//a message that mentioned the bot with a word that isn't a command
function unknown(name, via, meta){
    log.debug("command.unknown", who(meta) + " sent an unknown command: " + describe(name, "", via), Object.assign({ command: name, via: via }, meta));
}

module.exports = { run, denied, unknown };
