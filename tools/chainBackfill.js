var db = require("../db");
var hi = require("../hi");
var backfill = require("./backfill");

//pre-HiBot chains break on a 2-day quiet gap (the golden age was played near-daily,
//the 11:59/12:01 era); the HiBot era uses the 7-day PING_DELAY / bot revivals - HIB-28
const PRE_HIBOT_GAP = 2 * 86400000;

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

    //split history at the bot's first hi (its first revival ~= go-live). Everything
    //before is the pre-HiBot "golden age"; everything from it onward is the HiBot era.
    const firstBotIdx = collected.his.findIndex(function(h){ return h.user === botId; });
    const preHis = firstBotIdx === -1 ? [] : collected.his.slice(0, firstBotIdx);
    const era = firstBotIdx === -1 ? collected.his.slice() : collected.his.slice(firstBotIdx);
    if (firstBotIdx === -1) {
        console.log("chain backfill: WARNING - no bot hi found; treating all his as HiBot era");
    }

    //HiBot era: default PING_DELAY (7d) gap + bot revivals as boundaries
    var data = {
        currentChain: { count: 0, participants: {}, startedAt: null, lastTs: null },
        longestChain: { count: 0, participants: {}, startedAt: null, endedAt: null }
    };
    for (const m of era) hi.advanceChain(data, m.user, m.ts, botId);

    //pre-HiBot golden age: no bot to revive, played near-daily, so a tighter gap breaks it
    var preData = {
        currentChain: { count: 0, participants: {}, startedAt: null, lastTs: null },
        longestChain: { count: 0, participants: {}, startedAt: null, endedAt: null }
    };
    for (const m of preHis) hi.advanceChain(preData, m.user, m.ts, botId, PRE_HIBOT_GAP);

    const longest = data.longestChain;
    const current = data.currentChain;
    const golden = preData.longestChain;

    //always log (visible in fly logs) so a dry run is useful
    console.log("chain backfill: " + collected.rawCount + " messages, " + collected.his.length +
        " valid his (" + era.length + " HiBot-era, " + preHis.length + " pre-HiBot)" +
        (apply ? " (writing)" : " (dry run)"));
    logChain("HiBot-era longest", longest);
    logChain("pre-HiBot golden longest", golden);
    console.log("  current (in-progress) chain: " + current.count + " hi's");

    if (apply) {
        await db.setChains(channel.guild.id, current, longest, golden);
    }

    return {
        total: collected.rawCount, valid: collected.his.length,
        era: era.length, pre: preHis.length,
        longest: longest.count, golden: golden.count, current: current.count,
        applied: apply
    };
}

function logChain(label, chain) {
    console.log("  " + label + ": " + chain.count + " hi's" +
        (chain.count ? " (" + isoDay(chain.startedAt) + " -> " + isoDay(chain.endedAt) + ")" : ""));
    Object.keys(chain.participants || {})
        .map(function(u){ return { u: u, n: chain.participants[u] }; })
        .sort(function(a, b){ return b.n - a.n; })
        .forEach(function(p){ console.log("    " + p.u + ": " + p.n); });
}

function isoDay(ts) {
    return new Date(ts).toISOString().slice(0, 10);
}

module.exports = { runChainBackfill };
