//MongoDB sink for log.js (HIB-32). Log lines are stored in daily buckets: one document per bot run
//(`boot`) per UTC day (`day`) per size-roll (`part`), holding that day's lines in a `lines` array plus
//counters (n / warns / errors / firstTs / lastTs) you can scan without opening the array.
//
//  { boot, day, part, machine, n, warns, errors, firstTs, lastTs,
//    lines: [ { ts, level, lvl, event, msg, meta?, seq }, ... ] }
//
//Not one document per line (thousands of tiny docs) and not one per run (a run lasts weeks, so it would grow
//forever and never expire under the TTL index on `day`). Writes are batched; if Mongo is unreachable the
//lines wait in a capped in-memory queue and are written when it returns.
//
//This sink must never throw into the app or log through `log` itself (no recursion): problems are
//reported with raw console.error only. The database call is injected so this file doesn't need db.js.
const DAY_MS = 86400000;

function dayStart(ts) {
    //UTC midnight of the entry's day (the epoch is day-aligned, so flooring works)
    return Math.floor(ts.getTime() / DAY_MS) * DAY_MS;
}

function rawReport(message) {
    try {
        console.error(message);
    } catch (e) { /* nothing left to do */ }
}

function safeMeta(meta) {
    //meta must survive JSON + BSON. anything that can't is replaced, so one bad entry can never jam the queue
    if (meta === undefined) return undefined;
    try {
        return JSON.parse(JSON.stringify(meta));
    } catch (e) {
        return { unserializable: true };
    }
}

function createMongoSink(opts) {
    const writeBucket = opts.writeBucket;                        //async (filter, update) => upsert one bucket
    const machine = opts.machine || 'local';
    const flushIntervalMs = opts.flushIntervalMs || 5000;
    const batchSize = opts.batchSize || 50;                      //flush early once this many lines are waiting
    const maxQueue = opts.maxQueue || 1000;                      //oldest lines are dropped beyond this
    const rollBytes = opts.rollBytes || 8 * 1024 * 1024;         //start a new part well under the 16 MB doc limit
    const now = opts.now || (() => new Date());
    const report = opts.report || rawReport;

    let queue = [];
    let dropped = 0;
    let ready = false;                                           //false until db.connect() has finished
    let flushing = null;
    let failing = false;
    let timer = null;
    let lastBoot = null;
    const buckets = new Map();                                   //dayMs -> { part, bytes } for this process

    function trim() {
        while (queue.length > maxQueue) {
            queue.shift();
            dropped++;
        }
    }

    function write(entry) {
        lastBoot = entry.boot;
        const stored = Object.assign({}, entry);
        const meta = safeMeta(entry.meta);
        if (meta === undefined) delete stored.meta; else stored.meta = meta;
        queue.push(stored);
        trim();
        if (ready && queue.length >= batchSize) flushNow();
    }

    async function writeGroup(dayMs, entries) {
        const state = buckets.get(dayMs) || { part: 0, bytes: 0 };
        const lines = entries.map((e) => {
            const line = { ts: e.ts, level: e.level, lvl: e.lvl, event: e.event, msg: e.msg, seq: e.seq };
            if (e.meta !== undefined) line.meta = e.meta;
            return line;
        });
        const size = JSON.stringify(lines).length;
        if (state.bytes > 0 && state.bytes + size > rollBytes) {
            state.part++;
            state.bytes = 0;
        }
        let warns = 0, errors = 0, firstTs = entries[0].ts, lastTs = entries[0].ts;
        for (const e of entries) {
            if (e.lvl === 30) warns++;
            if (e.lvl >= 40) errors++;
            if (e.ts < firstTs) firstTs = e.ts;
            if (e.ts > lastTs) lastTs = e.ts;
        }
        //$min/$max (not $set) keep the timestamps right even if batches land out of order
        await writeBucket(
            { boot: entries[0].boot, day: new Date(dayMs), part: state.part },
            {
                $push: { lines: { $each: lines } },
                $inc: { n: lines.length, warns: warns, errors: errors },
                $min: { firstTs: firstTs },
                $max: { lastTs: lastTs },
                $setOnInsert: { machine: machine }
            }
        );
        state.bytes += size;
        buckets.set(dayMs, state);
    }

    async function writeBatch(batch) {
        //a batch can straddle midnight, so write one bucket per UTC day, oldest day first
        const groups = new Map();
        for (const e of batch) {
            const key = dayStart(e.ts);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(e);
        }
        const keys = [...groups.keys()].sort((a, b) => a - b);
        for (let i = 0; i < keys.length; i++) {
            try {
                await writeGroup(keys[i], groups.get(keys[i]));
            } catch (err) {
                //put this day and every later one back at the front, in order, and retry on the next flush
                const remaining = [];
                for (let j = i; j < keys.length; j++) remaining.push(...groups.get(keys[j]));
                queue = remaining.concat(queue);
                trim();
                if (!failing) {
                    failing = true;
                    report('log: mongo sink write failed, will keep retrying: ' + (err && err.message));
                }
                return false;
            }
        }
        if (failing) {
            failing = false;
            report('log: mongo sink recovered');
        }
        return true;
    }

    async function drain() {
        while (queue.length) {
            const batch = queue;
            queue = [];
            if (!(await writeBatch(batch))) return;
            if (dropped > 0) {
                //lines were lost while Mongo was unreachable: leave a marker where the gap is
                queue.push({
                    ts: now(), level: 'warn', lvl: 30, event: 'log.dropped', seq: 0, boot: lastBoot,
                    msg: dropped + ' log line(s) were dropped while MongoDB was unreachable',
                    meta: { dropped: dropped }
                });
                dropped = 0;
            }
        }
    }

    function flushNow() {
        if (!ready) return Promise.resolve();
        if (!flushing) {
            flushing = drain().catch((err) => report('log: mongo sink flush failed: ' + (err && err.message))).then(() => { flushing = null; });
        }
        return flushing;
    }

    async function flush() {
        //wait out any flush in progress, then write whatever arrived meanwhile
        while (flushing) await flushing;
        await flushNow();
    }

    function setReady() {
        //call once db.connect() has finished: writes queued since startup go out now, then every few seconds
        ready = true;
        flushNow();
        timer = setInterval(flushNow, flushIntervalMs);
        timer.unref();
    }

    function stop() {
        clearInterval(timer);
        timer = null;
    }

    return {
        name: 'mongo',
        envVar: 'LOG_MONGO_LEVEL',
        defaultLevel: 'debug',
        write: write,
        flush: flush,
        setReady: setReady,
        stop: stop,
        pending: () => queue.length
    };
}

module.exports = { createMongoSink };
