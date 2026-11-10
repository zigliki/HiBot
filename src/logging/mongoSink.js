//MongoDB sink for the logger (HIB-32). lines are stored in daily buckets: one doc per bot run (boot) per utc day,
//with counters and a lines array. batched, and queued (capped) while mongo is unreachable
//never logs through log itself (no recursion), problems go to console.error. the db call is injected
const DAY_MS = 86400000;

function dayStart(ts) {
    //utc midnight of the entry's day
    return Math.floor(ts.getTime() / DAY_MS) * DAY_MS;
}

function rawReport(message) {
    try {
        console.error(message);
    } catch (e) { /* nothing left to do */ }
}

function safeMeta(meta) {
    //meta must survive json and bson, so a bad entry can't jam the queue
    if (meta === undefined) return undefined;
    try {
        return JSON.parse(JSON.stringify(meta));
    } catch (e) {
        return { unserializable: true };
    }
}

function createMongoSink(opts) {
    //async (filter, update) => upsert one bucket
    const writeBucket = opts.writeBucket;
    const machine = opts.machine || 'local';
    const flushIntervalMs = opts.flushIntervalMs || 5000;
    //flush early at batchSize lines, drop the oldest beyond maxQueue
    const batchSize = opts.batchSize || 50;
    const maxQueue = opts.maxQueue || 1000;
    //start a new part well under mongo's 16mb document limit
    const rollBytes = opts.rollBytes || 8 * 1024 * 1024;
    const now = opts.now || (() => new Date());
    const report = opts.report || rawReport;

    let queue = [];
    let dropped = 0;
    //false until db.connect() has finished
    let ready = false;
    let flushing = null;
    let failing = false;
    let timer = null;
    let lastBoot = null;
    //day -> { part, bytes } for this process
    const buckets = new Map();

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
        //$min/$max keep the timestamps right if batches land out of order
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
                //put this day and later ones back at the front and retry on the next flush
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
                //leave a marker where lines were lost
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
        //call once db.connect() has finished, queued lines go out now and then every few seconds
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
