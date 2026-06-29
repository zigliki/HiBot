var db = require("../db");

// One-off stats backfill (HIB-20). Not a normal part of the bot - it's run via the
// tools framework (TOOLS=true, TOOL_TO_USE=backfill, BACKFILL_CHANNEL_ID=<#hi id>,
// BACKFILL_APPLY=true to write). Clear those env vars once it has run.
// Pages through a channel's full history and (optionally) writes per-user stats,
// replaying the game rules over the past messages.
async function runBackfill(channel, options) {
    options = options || {};
    const apply = options.apply === true;

    //page backwards through the entire channel history, 100 at a time
    var raw = [];
    var before;
    while (true) {
        const batch = await channel.messages.fetch({ limit: 100, before: before });
        if (batch.size === 0) break;
        for (const m of batch.values()) {
            raw.push({ user: m.author.id, tag: m.author.tag, content: m.content, ts: m.createdTimestamp });
        }
        before = batch.last().id;
    }

    //oldest -> newest (Discord returns newest first)
    raw.sort((a, b) => a.ts - b.ts);

    //replay the rules: must be "hi" and not the same user back-to-back.
    //NO time-gap check - the 24h rule was added later and shouldn't apply to history.
    //fold replaced accounts into the current account (old id -> new id) so the
    //earliest hi (and combined totals) land on the account the person uses now.
    const REMAP = {
        "128714146773598208": "201560166397771776", // deathslash1924 -> vinhtage_gamer
        "128717967180431360": "338891480686919683"  // chrisk8837 -> mitonlid
    };

    const tally = new Map();
    var lastValidUser = null;
    for (const m of raw) {
        if (m.content.trim().toLowerCase() !== "hi") continue;
        const user = REMAP[m.user] || m.user;
        if (user === lastValidUser) continue;

        var t = tally.get(user);
        if (!t) {
            t = { user: user, tag: m.tag, successful: 0, firstHi: m.ts, lastHi: m.ts };
            tally.set(user, t);
        }
        t.successful++;
        t.tag = m.tag;       //keep the most recent username for display
        t.lastHi = m.ts;
        lastValidUser = user;
    }

    const serverId = channel.guild.id;
    const docs = [...tally.values()].map(t => ({
        user: t.user,
        tag: t.tag,
        server: serverId,
        successful: t.successful,
        avgHi: t.successful > 1 ? Math.round((t.lastHi - t.firstHi) / (t.successful - 1)) : 0,
        firstHi: t.firstHi,
        lastHi: t.lastHi
    }));
    docs.sort((a, b) => b.successful - a.successful);

    //always log what we found (visible in fly logs) so a dry run is useful
    console.log("backfill: " + raw.length + " messages, " + docs.length + " users" + (apply ? " (writing)" : " (dry run)"));
    for (const d of docs) {
        console.log("  " + d.tag + " (" + d.user + "): " + d.successful + " his, " +
            "first " + new Date(d.firstHi).toISOString().slice(0, 10) + ", " +
            "last " + new Date(d.lastHi).toISOString().slice(0, 10) + ", " +
            "avg " + (d.successful > 1 ? (d.avgHi / 86400000).toFixed(1) + "d" : "n/a"));
    }

    if (apply) {
        //idempotent: absolute upserts, so a re-run just overwrites with the same totals
        for (const d of docs) {
            await db.setStats(d.user, d.server, {
                successful: d.successful,
                avgHi: d.avgHi,
                firstHi: d.firstHi,
                lastHi: d.lastHi
            });
        }
    }

    return { total: raw.length, users: docs.length, applied: apply };
}

module.exports = { runBackfill };
