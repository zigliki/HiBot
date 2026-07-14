var db = require("../db");
var hi = require("../hi");
var backfill = require("./backfill");

// One-off chain backfill (HIB-28). Computes the all-time longest hi chain (+ its
// participants) and the current in-progress chain for a server, from the full #hi
// history. Run via the tools framework (TOOLS=true, TOOL_TO_USE=chainBackfill,
// CHAIN_BACKFILL_CHANNEL_ID=<#hi id>, CHAIN_BACKFILL_APPLY=true to write). Clear
// those env vars once it has run.
//
// Replays the SAME ordered valid-hi sequence as the stats backfill (via the shared
// collectValidHis) through the live hi.advanceChain, so the backfill and the runtime
// can't disagree about chains. botId is the bot's own id: its revival his are the
// chain boundaries (assumes the bot account id hasn't changed over history).
async function runChainBackfill(channel, botId, options) {
    options = options || {};
    const apply = options.apply === true;

    const collected = await backfill.collectValidHis(channel);

    //replay through the exact runtime chain logic
    var data = {
        currentChain: { count: 0, participants: {}, startedAt: null },
        longestChain: { count: 0, participants: {}, startedAt: null, endedAt: null }
    };
    for (const m of collected.his) {
        hi.advanceChain(data, m.user, m.ts, botId);
    }

    const longest = data.longestChain;
    const current = data.currentChain;

    //always log (visible in fly logs) so a dry run is useful
    console.log("chain backfill: " + collected.rawCount + " messages, " + collected.his.length +
        " valid his" + (apply ? " (writing)" : " (dry run)"));
    console.log("  longest chain: " + longest.count + " hi's" +
        (longest.count ? " (" + isoDay(longest.startedAt) + " -> " + isoDay(longest.endedAt) + ")" : ""));
    Object.keys(longest.participants || {})
        .map(u => ({ u: u, n: longest.participants[u] }))
        .sort((a, b) => b.n - a.n)
        .forEach(p => console.log("    " + p.u + ": " + p.n));
    console.log("  current (in-progress) chain: " + current.count + " hi's");

    if (apply) {
        await db.setChains(channel.guild.id, current, longest);
    }

    return { total: collected.rawCount, valid: collected.his.length, longest: longest.count, current: current.count, applied: apply };
}

function isoDay(ts) {
    return new Date(ts).toISOString().slice(0, 10);
}

module.exports = { runChainBackfill };
