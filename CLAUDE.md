# HiBot

A Discord bot for the "hi" game: in a server's `#hi` channel people post `hi`. A `hi`
only counts if it's exactly `"hi"`, from a **different user than the previous valid hi**
(no back-to-back), and at least **24h** after the last one. If a channel goes **7 days**
quiet, the bot posts `hi` itself to revive the chain. Runs in multiple servers at once.

## Stack & hosting
- Node.js + **discord.js v14** (HIB-31; needs explicit intents incl. privileged MessageContent; `<@id>` mentions) + **mongodb v5**.
- **MongoDB Atlas.** One shared `MongoClient`, created once at startup and reused — keeps the
  cluster from going idle (HIB-19). Connect on boot, close on shutdown.
- Deployed on **fly.io**. Single app `zigliki-hi-bot` (prod). **No staging app** — a second fly
  machine costs money; instead "staging" = run the bot locally with its own Discord bot + own MongoDB (HIB-41).
- The code reads **only real env vars** (no dotenv). fly provides secrets as env; locally `node --env-file=<file>` loads one.
- Secrets (fly): `LOGIN` (bot token), `MONGO_URI` (full connection string, replaced `MONGO_PWD` in HIB-41 — set the fly
  secret BEFORE deploying code that needs it, or prod crash-loops on `bad auth`), `DEV` (admin's Discord user ID).
  Read live values with `fly ssh console -a <app> -C "printenv LOGIN"`. For local runs, build a
  gitignored `keys.env` from prod's live secrets with `npm run pull-keys` (only run it when asked; it reads prod's secrets).

## Layout
Source lives in `src/` (HIB-36). Entry is `src/index.js` (`npm start`); it builds the client, adds the log sinks,
registers the event files and the health monitor, then logs in.
- `src/index.js` — wiring only.
- `src/discord/` — helpers that talk to the Discord API: `client.js` (creates the discord.js client: intents/partials),
  `guildInfo.js` (`describeGuild`/`logGuild`/`logAll`: a `guild.info` line per server — members, #hi, bot-control — at
  startup and on join, plus a `guild.problem` warning for anything wrong: no #hi, missing permissions in #hi, no
  bot-control channel), `settings.js` (`applyStoredSettings` re-applies the stored activity on startup, `activityEnum`).
- `src/events/` — one file per Discord event group: `ready.js` (connect DB, restore settings, re-arm pings, run
  tools, log each server's info), `messageCreate.js` (hi check, then commands), `guildCreate.js` / `guildDelete.js`
  (server joined / left), `connection.js` (gateway/shard events, logged). Each exports `register(client, ...)`; `src/index.js` lists them explicitly.
- `src/lifecycle.js` — process handlers (unhandled rejection, fatal uncaught exception) and shutdown (flush logs,
  then close the DB).
- `src/logging/` — the logger (HIB-32/HIB-9/HIB-11): `index.js` is `log` (`log.info('hi.valid', msg, meta)`,
  levels debug<info<warn<error, independent sinks, `log.fatal` = log → flush → exit 1), `mongoSink.js` and
  `discordSink.js` are the sinks, `setup.js` adds them. Use these, not `console.*`. See "Logging" below.
- `src/game/hi.js` — the game (`checkHi`; chain revival via `restartPings`/`schedulePing`).
- `src/data/db.js` — data layer; shared MongoClient. Collections: `hi` (per-server state, incl. chain
  fields `currentChain`/`longestChain` (HiBot-era) + `preChain` (pre-HiBot golden age) — HIB-28),
  `settings` (single global doc), `stats` (per-user-per-server: successful/avgHi/firstHi/lastHi),
  `logs` (daily log buckets — see Logging).
- `src/health.js` — heartbeat + watchdog (see Logging).
- `src/commands/` — `router.js` (parse `@HiBot <cmd>` + dispatch), `admin.js` (pic/status/output),
  `stats.js` (`stats`/`first`/`top [board]`/`chain`).
- `src/tools/` — `runner.js` (env-gated one-off tool dispatcher), `backfill.js` (HIB-20 stats import;
  exports shared `collectValidHis`), `chainBackfill.js` (HIB-28 longest-chain import).
- `scripts/` — shell helpers (`staging.sh`, `stagingGuard.js`, `prod.sh`, `pull-keys.sh`), `logs.js` (`npm run logs`) and `registerCommands.js` (`npm run register-commands`).
- `test/` — the `node:test` suite. `test/modules.test.js` loads every module under `src/`, so a wrong
  `require` path fails `npm test` instead of crash-looping prod.

### Logging (HIB-32 / HIB-9 / HIB-11, epic HIB-13)
One logger, independent sinks, each with its own min level via env (`debug|info|warn|error|off`):
`LOG_CONSOLE_LEVEL` (default `info`; what `fly logs` shows), `LOG_MONGO_LEVEL` (default `debug`; the full
record), `LOG_DISCORD_LEVEL` (default `info`; webhook sink, only active when `LOG_WEBHOOK` is set). Changing
one on fly = `fly secrets set` (restarts the bot).
- **Discord feed:** create a webhook in a private channel (Channel settings → Integrations → Webhooks) and
  `fly secrets set LOG_WEBHOOK=<url> -a zigliki-hi-bot` (treat the URL as a secret). For local `staging` runs add
  `LOG_WEBHOOK=` to the env file by hand (`pull-keys` only copies LOGIN/MONGO_URI/DEV). Plain HTTPS, so it works
  when the gateway is down; batched ~5s, never pings, respects rate limits, queues if Discord is unreachable.
- **Mongo `logs` collection = daily buckets**, one doc per bot run (`boot`) per UTC day (`day`) per size-roll
  (`part`): counters (`n/warns/errors/firstTs/lastTs`) + a `lines` array of `{ts, level, lvl, event, msg, meta, seq}`.
  TTL index on `day` (`LOG_MONGO_TTL_DAYS`, default 14). Writes are batched (~5s) and queued while Mongo is
  down (capped; a `log.dropped` line marks any gap). The sink never logs through `log` (no recursion).
- **Read them: `npm run logs -- --since 2h --level warn --event shard`** (`--guild <name|id>` for one server), or `--summary` for one row per
  bot run (start, last seen, errors, gap before the next boot — how a crash looks from outside). Read-only;
  needs `keys.env`.
- **Fatal errors exit.** `uncaughtException`, a failed `db.connect()` and a failed login call `log.fatal`
  (flush sinks, `exit(1)`); fly's `restart policy = always` brings the bot back. `unhandledRejection` is
  logged only (HIB-30/HIB-21). Gateway (`shard.*`) and Mongo (`db.offline`/`db.online`) connectivity changes
  are logged as events.
- **Health / dead-man's switch (HIB-34, `src/health.js`).** The bot pings a Healthchecks.io check
  (`HEALTHCHECK_URL`, a secret; unset = off) every `HEALTHCHECK_INTERVAL_MS` (default 5 min) **only while
  healthy** = gateway READY and Mongo connected, so a bot that's "started" but disconnected goes quiet. When
  pings stop the service alerts us (check set to period 1h / grace 1h → worst-case ~2h; `log.fatal` also sends
  `<url>/fail` so a crash alerts at once). Fly's own health checks can't do this (a failing check never restarts a
  machine and this worker has no HTTP service); a second fly app would cost money and share fly's failure modes.
  **Watchdog:** gateway not READY for `WATCHDOG_MS` (default 5 min, `0` = off) → `log.fatal('watchdog')` → exit 1
  → fly restarts. Gateway only: restarting can't fix a Mongo outage. Events: `health.*`, `watchdog.*`.
  Set the URL with `fly secrets set HEALTHCHECK_URL=<url> -a zigliki-hi-bot` (restarts the bot) and add it to
  `keys.env` by hand for staging (`pull-keys` doesn't copy it).
- **Guild context (HIB-33).** Lines about a server pass `logContext.forGuild(guild)` / `forMessage(msg)`
  (`src/logging/context.js`) as meta (`guild` id, `guildName`, plus `user`/`userTag` for messages). The sinks print the
  name as a `[Guild]` prefix and leave those keys out of the printed meta; Mongo keeps them all. Write the message as
  a sentence (`kingnoskcaj said hi`), not "valid hi from …". Discord shows info lines as just `[time] [Guild] sentence`
  and adds the bold event name only for warn/error; the console line always includes the event.
- Event names are dotted (`hi.valid`, `hi.rejected.toosoon|sameuser|nothi`, `ping.*`, `shard.*`, `db.*`, `health.*`, `watchdog.*`, `tool.*`).

### Commands (`@HiBot <command>`)
- Public (append `@user` to `stats`/`first` to look up someone else; accepts `<@id>` and `<@!id>`):
  `stats` / `my-stats`, `first` / `firsthi` / `first-hi`,
  `top` / `top-stats` (`top`/`top his` = count, `top average` = lowest avg gap, min 10 hi's),
  `chain` / `longest` (HiBot-era) and `chain prebot` (pre-HiBot "golden age", 2-day gap break).
  Stats output pings only the requester (allowedMentions); others render as tags without a ping.
- Server admins: `output` (sets the bot-control channel; creates the server's `hi` doc if it's missing). Bot admin (`DEV`) only: `pic` / `status` (these also work by DMing the bot) and are text-only on purpose, so they can't leak out via slash.
- **Slash commands (HIB-37)** — `/stats`, `/first`, `/top`, `/chain`, `/output`, defined in `src/commands/slash.js`, handled by
  `src/events/interactionCreate.js`. They work in any channel; text commands have no channel restriction either. Both paths call the
  same handlers with a `ctx = { guildId, userId, botId, reply }`. **Registered per server, never globally** (a PUT replaces all of a
  server's commands): every server gets the main set, and the golden-age server (Shaun The Sheep, `128039782679969792`, override with
  env `GOLDEN_AGE_GUILD`) gets a `/chain` that also offers `era` (prebot). `guildCreate` registers a joining server
  (`src/discord/slashRegistry.js`; failure is a `commands.register.failed` warning). For servers the bot was already in, or after
  a command changes: `npm run register-commands` (dry run) / `-- --apply` / `-- --guild <id> --apply`; `:staging` variant uses
  `keys.staging.env`. Prod's code must be deployed before `--apply`, or the new commands show up and don't answer.
- **Command logging (HIB-38)** — every command goes through `commandLog` and logs `command.run` (info), `command.failed` (error),
  `command.denied` (warn) or `command.unknown` (debug), with `via: text|slash`.

### One-off tools
Gated by env: `TOOLS=true`, `TOOL_TO_USE=<name>`, plus that tool's vars. **Clear these after
running** — they re-run every restart. Both replay `#hi` history via the shared `collectValidHis`.
- `backfill` (HIB-20, stats): `BACKFILL_CHANNEL_ID`, `BACKFILL_APPLY=true` to write vs dry-run.
- `chainBackfill` (HIB-28, longest+current chain): `CHAIN_BACKFILL_CHANNEL_ID`,
  `CHAIN_BACKFILL_APPLY=true` to write vs dry-run.

### Tests (HIB-29)
`npm test` runs a **`node:test`** suite (zero deps) over `test/*.test.js`. It covers the **pure
logic only** — `hi.advanceChain` (chain growth / revival reset / gap + era thresholds),
`commands/stats` (rank, share, `top` boards, `chain`/`prebot`, requester-only pings, `@user`
lookup), `tools/` backfill replay + era split, and the logger (`log`, the Mongo bucket sink, the
`scripts/logs.js` query builder, `log.fatal`, the db topology watcher) — using light `db`/message/channel/
collection stubs. The
connection layer (login / gateway / Mongo) is intentionally **not** tested. `test/` is excluded
from the fly image (.dockerignore).

### Local staging (HIB-26, reworked in HIB-41)
`npm run staging` (scripts/staging.sh) runs the same code locally as a **separate Discord app (HiBot-Staging, Message Content
Intent enabled) against a separate MongoDB** (database name `HiBot` on its own cluster), so prod keeps running and nothing is paused.
Needs a gitignored `keys.staging.env` with `LOGIN`, `MONGO_URI`, `DEV` and optionally `GOLDEN_AGE_GUILD` (a server id that plays
Shaun The Sheep; the Test Server does). `scripts/stagingGuard.js` refuses to start if that file shares the token or database with
`keys.env`, and prints the staging database host. `HEALTHCHECK_URL` stays empty. Read its logs with `npm run logs:staging`.
A fresh staging DB starts empty: `output` and `guildCreate` create a server's `hi` doc, and settings (status, activity) were copied once.
`npm start` does not load any env file. `npm run prod:pause` / `prod:resume` (scripts/prod.sh) remain for pausing the fly machine;
after a deploy onto a stopped machine, `npm run prod:resume`.

## Deploying — read before you deploy (hard-won)
- `fly.toml` = **PRODUCTION** (`app = zigliki-hi-bot`); a bare `fly deploy` deploys prod. No staging
  config — for dev, `npm run staging` runs locally (see above). After deploying slash command changes, run
  `npm run register-commands -- --apply`.
- Use fly's **remote builder** (plain `fly deploy`), **not `--local-only`** — local-only hits a legacy
  `/api/v1/releases` 422 on this old (Nomad→v2 migrated) app. Remote builder works.
- `package.json` **must** have a `start` script — the buildpack needs it to define the `web` process,
  or the release 422s ("no process").
- Builder is `heroku/builder:24` (old `heroku/buildpacks:20` was retired by Heroku).
- Worker config: **no `[http_service]`** → fly won't autostop the bot (it has no inbound HTTP).
- Interactive commands (`fly launch`, `fly config save`, etc.) fail in non-interactive shells; run them in a real terminal.

## Project management
- Jira project **HIB** (cloud `zigliki`, cloudId `db16b2a3-32bf-4e3a-802d-40bdc14a98fd`).
  Workflow: Open → In Progress → In Review → Done (no direct Open→Done).
- Infra **management** (provisioning apps, secrets, hosting) is a **ZiglikiIT** concern, not HIB.
  HIB tickets are about bot **utilisation** (what the bot does).

## Current state & TODO
- **Prod is healthy:** deployed, and the stats backfill is written (full `#hi` history back to 2017,
  with replaced-account merges baked in: deathslash→vinhtage_gamer, chrisk→mitonlid).
- **Branch `HIB-37+HIB-38`** (not pushed): slash commands, per-server sets, command logging. To ship: push, PR, merge, `fly deploy`, then
  `npm run register-commands -- --apply` for prod.
- Open HIB tickets: **HIB-21** (DB writes are fire-and-forget — unhandled rejections / silent failures),
  **HIB-23** (`restartPings` can fire an immediate `hi` on boot when a server is overdue).
- Small follow-ups (no ticket yet): exclude HiBot from the `top` leaderboard in `db.getTopStats`
  (its stats are saved intentionally but shouldn't rank); accept `<@!id>` (nickname) mentions in the
  command parser, not just `<@id>`.
