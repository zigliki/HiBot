//Discord webhook sink for the logger (HIB-9), only added when LOG_WEBHOOK is set. a webhook is plain HTTPS, so it
//still works when the gateway is down. batched (~5s) under the 2000 char limit, never pings, respects rate limits,
//queues (capped) if Discord is unreachable. never logs through log itself, problems go to console.error
//discord caps a message at 2000 chars, leave headroom
const MAX_MESSAGE = 1900;
const MAX_LINE = 300;
const ICONS = { debug: '🔹', info: 'ℹ️', warn: '⚠️', error: '🔴' };

function rawReport(message) {
    try {
        console.error(message);
    } catch (e) { /* nothing left to do */ }
}

function formatEntry(entry) {
    //e.g.  ⚠️ `22:34:32Z` **shard.disconnect** shard 0 disconnected (code 1006)
    const time = entry.ts.toISOString().slice(11, 19) + 'Z';
    const line = ICONS[entry.level] + ' `' + time + '` **' + entry.event + '**' + (entry.msg ? ' ' + entry.msg : '');
    return line.length > MAX_LINE ? line.slice(0, MAX_LINE - 1) + '…' : line;
}

function chunkLines(lines) {
    //group lines into messages that fit under the limit (a line is never split)
    const chunks = [];
    let current = [];
    let size = 0;
    for (const line of lines) {
        if (current.length && size + 1 + line.length > MAX_MESSAGE) {
            chunks.push(current);
            current = [];
            size = 0;
        }
        current.push(line);
        size += (current.length > 1 ? 1 : 0) + line.length;
    }
    if (current.length) chunks.push(current);
    return chunks;
}

function createDiscordSink(opts) {
    const url = opts.url;
    const fetchFn = opts.fetch || globalThis.fetch;
    const flushIntervalMs = opts.flushIntervalMs || 5000;
    //the oldest lines are dropped beyond maxQueue
    const maxQueue = opts.maxQueue || 200;
    const now = opts.now || Date.now;
    const sleep = opts.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const report = opts.report || rawReport;

    //already-formatted lines
    let queue = [];
    let dropped = 0;
    let flushing = null;
    let failing = false;
    //rate limited until this time (ms)
    let pausedUntil = 0;
    let timer = null;

    function trim() {
        while (queue.length > maxQueue) {
            queue.shift();
            dropped++;
        }
    }

    function write(entry) {
        queue.push(formatEntry(entry));
        trim();
    }

    function fail(message) {
        if (!failing) {
            failing = true;
            report('log: discord sink: ' + message);
        }
    }

    async function post(lines) {
        //ok, retry (try again later) or drop (rejected, resending won't help)
        try {
            const res = await fetchFn(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                //parse: [] means this can never ping anyone
                body: JSON.stringify({ username: 'HiBot logs', content: lines.join('\n'), allowed_mentions: { parse: [] } })
            });
            if (res.ok) {
                failing = false;
                return 'ok';
            }
            if (res.status === 429) {
                let seconds = 1;
                try {
                    const body = await res.json();
                    if (body && typeof body.retry_after === 'number') seconds = body.retry_after;
                } catch (e) { /* no usable body: wait the default */ }
                pausedUntil = now() + seconds * 1000;
                return 'retry';
            }
            if (res.status >= 500) {
                fail('Discord returned ' + res.status + ', will keep retrying');
                return 'retry';
            }
            fail('webhook rejected the message (' + res.status + '), dropping it - is LOG_WEBHOOK still valid?');
            return 'drop';
        } catch (err) {
            fail('Discord unreachable (' + (err && err.message) + '), will keep retrying');
            return 'retry';
        }
    }

    async function drain() {
        while (queue.length && now() >= pausedUntil) {
            const lines = queue;
            queue = [];
            if (dropped > 0) {
                lines.unshift('… ' + dropped + ' log line(s) were dropped while Discord was unreachable');
                dropped = 0;
            }
            const chunks = chunkLines(lines);
            for (let i = 0; i < chunks.length; i++) {
                const outcome = await post(chunks[i]);
                if (outcome === 'retry') {
                    //this message and every later one go back to the front, in order
                    queue = [].concat(...chunks.slice(i), queue);
                    trim();
                    return;
                }
            }
        }
    }

    function flushNow() {
        if (!flushing) {
            flushing = drain().catch((err) => report('log: discord sink flush failed: ' + (err && err.message))).then(() => { flushing = null; });
        }
        return flushing;
    }

    async function flush() {
        //wait out any flush in progress, then send the rest. a short rate limit is waited out so a fatal message isn't lost
        while (flushing) await flushing;
        for (let attempt = 0; attempt < 2; attempt++) {
            const wait = pausedUntil - now();
            if (wait > 0) {
                if (wait > 2000) return;
                await sleep(wait);
            }
            await flushNow();
            //only go round again if we were just rate limited; other failures are left for the timer
            if (!queue.length || pausedUntil <= now()) return;
        }
    }

    function start() {
        timer = setInterval(flushNow, flushIntervalMs);
        timer.unref();
    }

    function stop() {
        clearInterval(timer);
        timer = null;
    }

    return {
        name: 'discord',
        envVar: 'LOG_DISCORD_LEVEL',
        defaultLevel: 'info',
        write: write,
        flush: flush,
        start: start,
        stop: stop,
        pending: () => queue.length
    };
}

module.exports = { createDiscordSink, formatEntry, chunkLines };
