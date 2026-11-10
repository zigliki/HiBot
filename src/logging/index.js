//the logger (HIB-32/HIB-9/HIB-11): independent sinks (console, mongo, discord), each with its own level from an env var
//must not require db.js (db requires this), so sinks that need the database get it injected
const crypto = require('crypto');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const OFF = Infinity;
const MAX_MSG = 1000;
const MAX_STACK = 2000;
const DEFAULT_FLUSH_TIMEOUT = 3000;

function parseLevel(raw, fallback) {
    //blank -> fallback, off -> never logs, junk -> fallback (and say so)
    if (raw == null || String(raw).trim() === '') return fallback;
    const v = String(raw).trim().toLowerCase();
    if (v === 'off') return OFF;
    if (LEVELS[v]) return LEVELS[v];
    console.error('log: ignoring unknown log level "' + raw + '" (use debug|info|warn|error|off)');
    return fallback;
}

function serializeError(err) {
    return {
        name: err.name,
        message: String(err.message).slice(0, MAX_MSG),
        stack: err.stack ? String(err.stack).slice(0, MAX_STACK) : undefined
    };
}

function cleanMeta(meta) {
    //keep meta small and JSON-safe: Errors become plain objects
    if (meta == null) return undefined;
    if (meta instanceof Error) return { err: serializeError(meta) };
    if (typeof meta !== 'object') return { value: meta };
    const out = {};
    for (const key of Object.keys(meta)) {
        out[key] = meta[key] instanceof Error ? serializeError(meta[key]) : meta[key];
    }
    return out;
}

//meta keys shown as the [guild] prefix or the sentence, so they're left out of the printed meta
const CONTEXT_KEYS = ['guild', 'guildName', 'user', 'userTag'];

function contextTag(meta) {
    //[Guild Name], or [guild id] when we only have the id
    const name = meta && (meta.guildName || meta.guild);
    return name ? '[' + name + ']' : '';
}

function withoutContext(meta) {
    if (!meta) return null;
    const out = {};
    for (const key of Object.keys(meta)) {
        if (!CONTEXT_KEYS.includes(key)) out[key] = meta[key];
    }
    return Object.keys(out).length ? out : null;
}

function formatLine(entry) {
    let line = entry.ts.toISOString() + ' ' + entry.level.toUpperCase().padEnd(5) + ' ' + entry.event;
    const tag = contextTag(entry.meta);
    if (tag) line += ' ' + tag;
    if (entry.msg) line += ' ' + entry.msg;
    const rest = withoutContext(entry.meta);
    if (rest) {
        try {
            line += ' ' + JSON.stringify(rest);
        } catch (e) {
            line += ' [unserializable meta]';
        }
    }
    return line;
}

function createConsoleSink(out) {
    //looked up at write time so tests can stub the console
    return {
        name: 'console',
        envVar: 'LOG_CONSOLE_LEVEL',
        defaultLevel: 'info',
        write(entry) {
            const c = out || console;
            const method = entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'log';
            c[method](formatLine(entry));
        }
    };
}

function rawError(message) {
    //for a broken sink: never goes through log (no recursion) and never throws
    try {
        console.error(message);
    } catch (e) { /* nothing left to do */ }
}

function createLogger(opts) {
    opts = opts || {};
    const env = opts.env || process.env;
    const now = opts.now || (() => new Date());
    const boot = opts.boot || crypto.randomBytes(3).toString('hex');
    const sinks = [];
    let seq = 0;

    //sink: { name, envVar, defaultLevel, write(entry), flush? }, write may return a promise
    function addSink(sink) {
        const level = parseLevel(sink.envVar && env[sink.envVar], LEVELS[sink.defaultLevel]);
        const registered = { name: sink.name, level: level, write: sink.write, flush: sink.flush };
        sinks.push(registered);
        return registered;
    }

    function guard(sinkName, fn) {
        //a failing sink must never break the caller or the other sinks
        try {
            const result = fn();
            if (result && typeof result.catch === 'function') {
                result.catch((err) => rawError('log: sink "' + sinkName + '" failed: ' + (err && err.message)));
            }
            return result;
        } catch (err) {
            rawError('log: sink "' + sinkName + '" failed: ' + (err && err.message));
        }
    }

    function write(level, event, msg, meta) {
        const lvl = LEVELS[level];
        const entry = {
            ts: now(),
            level: level,
            lvl: lvl,
            event: event,
            msg: msg == null ? '' : String(msg).slice(0, MAX_MSG),
            seq: ++seq,
            boot: boot
        };
        const cleaned = cleanMeta(meta);
        if (cleaned) entry.meta = cleaned;
        for (const sink of sinks) {
            if (lvl < sink.level) continue;
            guard(sink.name, () => sink.write(entry));
        }
    }

    async function flush(timeoutMs) {
        //drain every sink, e.g. before exiting. bounded by a timeout, never rejects
        let timer;
        const timeout = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs == null ? DEFAULT_FLUSH_TIMEOUT : timeoutMs); });
        const drained = Promise.all(sinks.map((sink) => {
            if (!sink.flush) return Promise.resolve();
            return Promise.resolve(guard(sink.name, () => sink.flush())).catch(() => {});
        }));
        await Promise.race([drained, timeout]);
        clearTimeout(timer);
    }

    const fatalHooks = [];
    function onFatal(fn) {
        //fn(event, msg) runs when log.fatal is called (e.g. the fail heartbeat), best effort
        fatalHooks.push(fn);
    }

    let dying = false;
    async function fatal(event, msg, meta) {
        //log, run the hooks, flush every sink, then exit 1 so fly restarts us. only the first fatal counts
        if (dying) return;
        dying = true;
        write('error', event, msg, meta);
        const limit = opts.fatalFlushMs == null ? DEFAULT_FLUSH_TIMEOUT : opts.fatalFlushMs;
        let timer;
        const timeout = new Promise((resolve) => { timer = setTimeout(resolve, limit); });
        const hooks = Promise.all(fatalHooks.map((fn) => Promise.resolve(guard('fatal hook', () => fn(event, msg))).catch(() => {})));
        await Promise.race([hooks, timeout]);
        clearTimeout(timer);
        await flush(limit);
        (opts.exit || process.exit)(1);
    }

    return {
        boot: boot,
        addSink: addSink,
        flush: flush,
        fatal: fatal,
        onFatal: onFatal,
        debug: (event, msg, meta) => write('debug', event, msg, meta),
        info: (event, msg, meta) => write('info', event, msg, meta),
        warn: (event, msg, meta) => write('warn', event, msg, meta),
        error: (event, msg, meta) => write('error', event, msg, meta)
    };
}

//the app-wide logger. console is always on, mongo and discord are added at startup
const defaultLogger = createLogger();
defaultLogger.addSink(createConsoleSink());

module.exports = Object.assign(defaultLogger, { createLogger, createConsoleSink, parseLevel, formatLine, contextTag, LEVELS });
