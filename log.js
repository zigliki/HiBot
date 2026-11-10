//In-house logger (HIB-32 / HIB-9 / HIB-11). One logger, several independent sinks (console, mongo,
//discord). Each sink has its own minimum level, set by an env var, and `off` disables it.
//
//  log.info('hi.valid', 'valid hi from x', { guild, user })     event = short dotted name
//
//This file must not require db.js (db.js requires this one) - sinks that need the database get it injected.
const crypto = require('crypto');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const OFF = Infinity;
const MAX_MSG = 1000;
const MAX_STACK = 2000;
const DEFAULT_FLUSH_TIMEOUT = 3000;

function parseLevel(raw, fallback) {
    //env value -> numeric threshold. unset/blank -> fallback, `off` -> never logs, junk -> fallback (and say so)
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
    //meta is stored as-is, so keep it small and JSON-safe: Errors become plain objects
    if (meta == null) return undefined;
    if (meta instanceof Error) return { err: serializeError(meta) };
    if (typeof meta !== 'object') return { value: meta };
    const out = {};
    for (const key of Object.keys(meta)) {
        out[key] = meta[key] instanceof Error ? serializeError(meta[key]) : meta[key];
    }
    return out;
}

function formatLine(entry) {
    let line = entry.ts.toISOString() + ' ' + entry.level.toUpperCase().padEnd(5) + ' ' + entry.event;
    if (entry.msg) line += ' ' + entry.msg;
    if (entry.meta) {
        try {
            line += ' ' + JSON.stringify(entry.meta);
        } catch (e) {
            line += ' [unserializable meta]';
        }
    }
    return line;
}

function createConsoleSink(out) {
    //out defaults to the global console, looked up at write time so it can be stubbed
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
    //last-resort reporting for a broken sink. never goes through log itself (no recursion, never throws)
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

    //sink: { name, envVar, defaultLevel, write(entry), flush()? } - write may return a promise
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
        //drain every sink (e.g. before exiting). bounded by a timeout and never rejects
        let timer;
        const timeout = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs == null ? DEFAULT_FLUSH_TIMEOUT : timeoutMs); });
        const drained = Promise.all(sinks.map((sink) => {
            if (!sink.flush) return Promise.resolve();
            return Promise.resolve(guard(sink.name, () => sink.flush())).catch(() => {});
        }));
        await Promise.race([drained, timeout]);
        clearTimeout(timer);
    }

    return {
        boot: boot,
        addSink: addSink,
        flush: flush,
        debug: (event, msg, meta) => write('debug', event, msg, meta),
        info: (event, msg, meta) => write('info', event, msg, meta),
        warn: (event, msg, meta) => write('warn', event, msg, meta),
        error: (event, msg, meta) => write('error', event, msg, meta)
    };
}

//the app-wide logger. the console sink is always registered; others (mongo, discord) are added at startup
const defaultLogger = createLogger();
defaultLogger.addSink(createConsoleSink());

module.exports = Object.assign(defaultLogger, { createLogger, createConsoleSink, parseLevel, formatLine, LEVELS });
