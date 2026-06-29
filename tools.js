var backfill = require("./backfill");

// On-demand maintenance tools, gated behind env vars so they never run in normal operation:
//   TOOLS=true             enable tool running at all
//   TOOL_TO_USE=<name>     which tool to run (e.g. "backfill")
//   ...plus that tool's own config vars (listed per case below)
//
// Remember to clear these env vars once the tool has run, or it re-runs on every restart.
async function runTool(client) {
    const tool = process.env.TOOL_TO_USE;
    if (!tool) {
        console.log("TOOLS is set but TOOL_TO_USE is empty - nothing to run");
        return;
    }
    console.log("running tool: " + tool);

    switch (tool) {
        case "backfill": {
            //BACKFILL_CHANNEL_ID = the #hi channel to backfill; BACKFILL_APPLY=true to write (else dry run)
            const channel = await client.channels.fetch(process.env.BACKFILL_CHANNEL_ID);
            const result = await backfill.runBackfill(channel, { apply: process.env.BACKFILL_APPLY === 'true' });
            console.log("backfill finished: " + JSON.stringify(result));
            break;
        }
        default:
            console.log("unknown tool: " + tool);
    }
}

module.exports = { runTool };
