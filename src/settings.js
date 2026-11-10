var db = require("./data/db");
var log = require("./logging");
var admin = require("./commands/admin");

async function applyStoredSettings(client){
    //presence resets whenever the bot reconnects, so re-apply the stored activity on startup.
    //the avatar persists on Discord's side once set, so it doesn't need re-applying here.
    var settings = await db.getSettings();
    if(settings && settings.activity){
        client.user.setActivity(settings.activity, { type: admin.activityEnum(settings.activity_type) });
        log.info("settings.restored", "restored activity: " + settings.activity_type + " " + settings.activity);
    } else {
        client.user.setActivity('#hi', { type: admin.activityEnum('WATCHING') });
    }
}

module.exports = { applyStoredSettings };
