var db = require("./db");

async function applyStoredSettings(client){
    //presence resets whenever the bot reconnects, so re-apply the stored activity on startup.
    //the avatar persists on Discord's side once set, so it doesn't need re-applying here.
    var settings = await db.getSettings();
    if(settings && settings.activity){
        client.user.setActivity(settings.activity, { type: settings.activity_type });
        console.log("restored activity: " + settings.activity_type + " " + settings.activity);
    } else {
        client.user.setActivity('#hi', { type: 'WATCHING' });
    }
}

module.exports = { applyStoredSettings };
