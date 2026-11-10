#!/usr/bin/env node
// logs.js - read-only viewer for the bot's MongoDB logs (HIB-32). The bot stores log lines in daily
// buckets (see logMongo.js); this unwinds them and prints matching lines oldest-first.
//
//   npm run logs -- --since 2h --level warn --event shard
//   npm run logs -- --summary --since 3d          one row per bot run (boot): start, last seen, errors
//
//   --since <dur|date>   30m / 2h / 3d, or an ISO date (default 1h)
//   --until <dur|date>   upper bound, same format (default now)
//   --level <name>       minimum level: debug|info|warn|error (default debug = everything)
//   --event <prefix>     only events starting with this, e.g. hi.rejected or shard
//   --boot <id>          only one bot run
//   --limit <n>          newest n matching lines (default 200)
//   --summary            list bot runs instead of lines
//   --json               raw JSON, one object per line
//
// Needs keys.env (npm run pull-keys). Never writes.
const path = require('path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const UNITS = { s: 1000, m: 60000, h: 3600000, d: 86400000 };

function parseTime(value, now) {
    //"2h" -> that long ago; anything else must be a date
    const m = /^(\d+)([smhd])$/.exec(value);
    if (m) return new Date(now - Number(m[1]) * UNITS[m[2]]);
    const d = new Date(value);
    if (isNaN(d.getTime())) throw new Error('bad time "' + value + '" (use 30m, 2h, 3d or an ISO date)');
    return d;
}

function parseArgs(argv, now) {
    now = now || Date.now();
    const opts = { since: parseTime('1h', now), until: new Date(now), minLevel: LEVELS.debug, event: null, boot: null, limit: 200, summary: false, json: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => {
            if (i + 1 >= argv.length) throw new Error(arg + ' needs a value');
            return argv[++i];
        };
        switch (arg) {
            case '--since': opts.since = parseTime(next(), now); break;
            case '--until': opts.until = parseTime(next(), now); break;
            case '--level': {
                const name = next().toLowerCase();
                if (!LEVELS[name]) throw new Error('bad level "' + name + '" (use debug|info|warn|error)');
                opts.minLevel = LEVELS[name];
                break;
            }
            case '--event': opts.event = next(); break;
            case '--boot': opts.boot = next(); break;
            case '--limit': opts.limit = Number(next()); if (!(opts.limit > 0)) throw new Error('--limit must be a positive number'); break;
            case '--summary': opts.summary = true; break;
            case '--json': opts.json = true; break;
            default: throw new Error('unknown option ' + arg);
        }
    }
    return opts;
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPipeline(opts) {
    //a bucket can hold lines from outside the window, so prefilter whole buckets, unwind, then filter lines
    const bucket = { lastTs: { $gte: opts.since }, firstTs: { $lte: opts.until } };
    if (opts.boot) bucket.boot = opts.boot;
    if (opts.summary) {
        return [
            { $match: bucket },
            { $project: { _id: 0, boot: 1, machine: 1, day: 1, part: 1, n: 1, warns: 1, errors: 1, firstTs: 1, lastTs: 1 } },
            { $sort: { firstTs: 1 } }
        ];
    }
    const line = { 'lines.ts': { $gte: opts.since, $lte: opts.until }, 'lines.lvl': { $gte: opts.minLevel } };
    if (opts.event) line['lines.event'] = { $regex: '^' + escapeRegex(opts.event) };
    return [
        { $match: bucket },
        { $unwind: '$lines' },
        { $match: line },
        { $sort: { 'lines.ts': -1, 'lines.seq': -1 } },     // newest first so $limit keeps the latest lines
        { $limit: opts.limit },
        { $project: { _id: 0, boot: 1, machine: 1, line: '$lines' } }
    ];
}

function summarizeRuns(buckets) {
    //fold buckets into one row per boot, ordered by start, with the gap to the next boot. a boot that
    //stops logging and is followed by another one is how a crash/restart looks from the outside.
    const byBoot = new Map();
    for (const b of buckets) {
        const r = byBoot.get(b.boot) || { boot: b.boot, machine: b.machine, firstTs: b.firstTs, lastTs: b.lastTs, n: 0, warns: 0, errors: 0, buckets: 0 };
        if (b.firstTs < r.firstTs) r.firstTs = b.firstTs;
        if (b.lastTs > r.lastTs) r.lastTs = b.lastTs;
        r.n += b.n;
        r.warns += b.warns;
        r.errors += b.errors;
        r.buckets++;
        byBoot.set(b.boot, r);
    }
    const runs = [...byBoot.values()].sort((a, b) => a.firstTs - b.firstTs);
    runs.forEach((r, i) => { r.gapToNextMs = i + 1 < runs.length ? runs[i + 1].firstTs - r.lastTs : null; });
    return runs;
}

function fmtDuration(ms) {
    if (ms == null) return 'still running / latest';
    const s = Math.round(ms / 1000);
    return s < 120 ? s + 's' : s < 7200 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h';
}

async function main() {
    require('dotenv').config({ path: path.join(__dirname, '..', 'keys.env') });
    const db = require('../src/data/db');
    const log = require('../src/logging');
    const opts = parseArgs(process.argv.slice(2));
    try {
        const rows = await db.aggregateLogs(buildPipeline(opts));
        if (opts.summary) {
            const runs = summarizeRuns(rows);
            if (opts.json) return runs.forEach((r) => console.log(JSON.stringify(r)));
            for (const r of runs) {
                console.log(r.boot + '  machine ' + r.machine + '  ' + r.firstTs.toISOString() + ' -> last seen ' + r.lastTs.toISOString() +
                    '  lines ' + r.n + '  warns ' + r.warns + '  errors ' + r.errors + '  next boot after ' + fmtDuration(r.gapToNextMs));
            }
            if (!runs.length) console.log('no log buckets in that window');
            return;
        }
        rows.reverse();                                          //oldest first for reading
        for (const row of rows) {
            console.log(opts.json ? JSON.stringify(row) : row.boot + ' ' + log.formatLine(row.line));
        }
        if (!rows.length) console.log('no matching log lines');
    } finally {
        await db.close();
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error('logs: ' + err.message);
        process.exit(1);
    });
}

module.exports = { parseArgs, parseTime, buildPipeline, summarizeRuns, fmtDuration };
