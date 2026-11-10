//heartbeat + watchdog (HIB-34). the bot pings Healthchecks.io while it's healthy, so we get alerted when the
//pings stop. the watchdog exits if the gateway stays down, so fly restarts the bot
const { Status } = require('discord.js');

const DEFAULTS = {
    heartbeatMs: 5 * 60 * 1000,
    watchdogMs: 5 * 60 * 1000,
    watchdogCheckMs: 30 * 1000,
    pingTimeoutMs: 10 * 1000
};
//not being healthy yet is normal for this long after startup
const BOOT_GRACE_MS = 2 * 60 * 1000;

function numberEnv(raw, fallback) {
    //blank or junk -> fallback. 0 is valid (turns the watchdog off)
    if (raw == null || String(raw).trim() === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function createHealth(opts) {
    const client = opts.client;
    const log = opts.log;
    const dbConnected = opts.dbConnected || (() => true);
    const env = opts.env || process.env;
    const now = opts.now || Date.now;
    const fetchFn = opts.fetch || globalThis.fetch;
    const url = env.HEALTHCHECK_URL ? String(env.HEALTHCHECK_URL).trim().replace(/\/+$/, '') : '';
    const heartbeatMs = numberEnv(env.HEALTHCHECK_INTERVAL_MS, DEFAULTS.heartbeatMs) || DEFAULTS.heartbeatMs;
    const watchdogMs = numberEnv(env.WATCHDOG_MS, DEFAULTS.watchdogMs);   //0 = watchdog off
    const watchdogCheckMs = opts.watchdogCheckMs || DEFAULTS.watchdogCheckMs;
    const pingTimeoutMs = opts.pingTimeoutMs || DEFAULTS.pingTimeoutMs;

    let heartbeatTimer = null;
    let watchdogTimer = null;
    let gatewayDownSince = null;
    let lastHealthy = null;
    let started = false;
    let startedAt = now();
    let everHealthy = false;

    function gatewayReady() {
        return client.ws.status === Status.Ready;
    }

    function check() {
        //overall verdict for the heartbeat, with the reason when it's bad
        if (!gatewayReady()) return { healthy: false, reason: 'gateway not ready (status ' + client.ws.status + ')' };
        if (!dbConnected()) return { healthy: false, reason: 'database not connected' };
        return { healthy: true, reason: null };
    }

    async function ping(suffix) {
        //true if the monitor acknowledged. never throws, a flaky monitor shouldn't hurt the bot
        if (!url) return false;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), pingTimeoutMs) : null;
        try {
            const res = await fetchFn(url + (suffix || ''), { method: 'GET', signal: controller ? controller.signal : undefined });
            return !!(res && res.ok);
        } catch (err) {
            log.warn('health.ping.failed', 'heartbeat ping failed: ' + (err && err.message));
            return false;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async function heartbeat() {
        const verdict = check();
        if (verdict.healthy) everHealthy = true;
        //we start before the gateway is READY, so don't log unhealthy until we've been healthy once or the grace is up
        const bootGrace = !everHealthy && now() - startedAt < BOOT_GRACE_MS;
        if (verdict.healthy !== lastHealthy && !(bootGrace && !verdict.healthy)) {
            //only log changes
            if (verdict.healthy) {
                if (lastHealthy === false) log.warn('health.recovered', 'bot is healthy again');
            } else {
                log.warn('health.unhealthy', 'not sending heartbeats: ' + verdict.reason);
            }
            lastHealthy = verdict.healthy;
        }
        //unhealthy: stay quiet, the missing ping is the alarm
        if (!verdict.healthy) return false;
        return await ping('');
    }

    function watchdogTick() {
        if (gatewayReady()) {
            if (gatewayDownSince != null) {
                log.info('watchdog.recovered', 'gateway is READY again after ' + Math.round((now() - gatewayDownSince) / 1000) + 's');
            }
            gatewayDownSince = null;
            return;
        }
        if (gatewayDownSince == null) {
            gatewayDownSince = now();
            log.warn('watchdog.gateway.down', 'gateway not READY (status ' + client.ws.status + '), restarting if it is not back within ' + Math.round(watchdogMs / 1000) + 's');
            return;
        }
        const downMs = now() - gatewayDownSince;
        if (downMs >= watchdogMs) {
            //log.fatal also sends the fail ping (hook in start) and flushes the sinks before exiting
            log.fatal('watchdog', 'gateway not READY for ' + Math.round(downMs / 1000) + 's (status ' + client.ws.status + '), exiting so fly restarts the bot');
        }
    }

    function start() {
        if (started) return;
        started = true;
        startedAt = now();
        //a crash alerts straight away, not after the grace period
        log.onFatal(() => ping('/fail'));
        if (url) {
            heartbeat();
            heartbeatTimer = setInterval(heartbeat, heartbeatMs);
            heartbeatTimer.unref();
            log.info('health.enabled', 'heartbeat on, every ' + Math.round(heartbeatMs / 1000) + 's while healthy');
        } else {
            log.info('health.disabled', 'HEALTHCHECK_URL not set, heartbeat is off');
        }
        if (watchdogMs > 0) {
            watchdogTimer = setInterval(watchdogTick, watchdogCheckMs);
            watchdogTimer.unref();
        } else {
            log.info('watchdog.disabled', 'WATCHDOG_MS=0, watchdog is off');
        }
    }

    function stop() {
        clearInterval(heartbeatTimer);
        clearInterval(watchdogTimer);
        heartbeatTimer = null;
        watchdogTimer = null;
    }

    return { start, stop, check, heartbeat, watchdogTick, ping, url };
}

module.exports = { createHealth, numberEnv, DEFAULTS };
