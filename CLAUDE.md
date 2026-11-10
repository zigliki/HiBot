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
  machine costs money; instead "staging" = run the bot locally via `npm run staging` (HIB-26).
- Secrets (fly): `LOGIN` (bot token), `MONGO_PWD`, `DEV` (admin's Discord user ID).
  Read live values with `fly ssh console -a <app> -C "printenv LOGIN"`. For local runs, build a
  gitignored `keys.env` from prod's live secrets with `npm run pull-keys`.

## Layout
- `index.js` — entry point: create client, wire events (ready/message/guildCreate/shard lifecycle),
  fatal-error handling, shutdown (flush logs, then close DB), login.
- `log.js` — the logger (HIB-32/HIB-9/HIB-11): `log.info('hi.valid', msg, meta)`, levels debug<info<warn<error,
  independent sinks, `log.fatal` (log → flush → exit 1). `logMongo.js` — the MongoDB sink. Use these, not
  `console.*`. See "Logging" below.
- `hi.js` — the game (`checkHi`; chain revival via `restartPings`/`schedulePing`).
- `db.js` — data layer; shared MongoClient. Collections: `hi` (per-server state, incl. chain
  fields `currentChain`/`longestChain` (HiBot-era) + `preChain` (pre-HiBot golden age) — HIB-28),
  `settings` (single global doc), `stats` (per-user-per-server: successful/avgHi/firstHi/lastHi),
  `logs` (daily log buckets — see Logging).
- `config.js` — `applyStoredSettings` (re-applies stored activity on startup).
- `commands/` — `router.js` (parse `@HiBot <cmd>` + dispatch), `admin.js` (pic/status/output),
  `stats.js` (`stats`/`first`/`top [board]`/`chain`).
- `tools/` — `runner.js` (env-gated one-off tool dispatcher), `backfill.js` (HIB-20 stats import;
  exports shared `collectValidHis`), `chainBackfill.js` (HIB-28 longest-chain import).

### Logging (HIB-32 / HIB-9 / HIB-11, epic HIB-13)
One logger, independent sinks, each with its own min level via env (`debug|info|warn|error|off`):
`LOG_CONSOLE_LEVEL` (default `info`; what `fly logs` shows), `LOG_MONGO_LEVEL` (default `debug`; the full
record), `LOG_DISCORD_LEVEL` (default `info`; webhook sink, only active when `LOG_WEBHOOK` is set). Changing
one on fly = `fly secrets set` (restarts the bot).
- **Mongo `logs` collection = daily buckets**, one doc per bot run (`boot`) per UTC day (`day`) per size-roll
  (`part`): counters (`n/warns/errors/firstTs/lastTs`) + a `lines` array of `{ts, level, lvl, event, msg, meta, seq}`.
  TTL index on `day` (`LOG_MONGO_TTL_DAYS`, default 14). Writes are batched (~5s) and queued while Mongo is
  down (capped; a `log.dropped` line marks any gap). The sink never logs through `log` (no recursion).
- **Read them: `npm run logs -- --since 2h --level warn --event shard`**, or `--summary` for one row per
  bot run (start, last seen, errors, gap before the next boot — how a crash looks from outside). Read-only;
  needs `keys.env`.
- **Fatal errors exit.** `uncaughtException`, a failed `db.connect()` and a failed login call `log.fatal`
  (flush sinks, `exit(1)`); fly's `restart policy = always` brings the bot back. `unhandledRejection` is
  logged only (HIB-30/HIB-21). Gateway (`shard.*`) and Mongo (`db.offline`/`db.online`) connectivity changes
  are logged as events.
- Event names are dotted (`hi.valid`, `hi.rejected.toosoon|sameuser|nothi`, `ping.*`, `shard.*`, `db.*`, `tool.*`).

### Commands (`@HiBot <command>`)
- Public (append `@user` to `stats`/`first` to look up someone else; accepts `<@id>` and `<@!id>`):
  `stats` / `my-stats`, `first` / `firsthi` / `first-hi`,
  `top` / `top-stats` (`top`/`top his` = count, `top average` = lowest avg gap, min 10 hi's),
  `chain` / `longest` (HiBot-era) and `chain prebot` (pre-HiBot "golden age", 2-day gap break).
  Stats output pings only the requester (allowedMentions); others render as tags without a ping.
- Server admins: `output`. Bot admin (`DEV`) only: `pic` / `status` (these also work by DMing the bot).

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

### Local "staging" (HIB-26)
There is no staging app/DB. `npm run staging` (scripts/staging.sh) ensures the prod fly machine(s)
are paused, then runs the SAME bot locally against the SAME prod token + prod Atlas DB. Prod MUST be
paused while the local bot runs — one token = one live bot, else both double-process every message.
Needs `keys.env` (`npm run pull-keys`, run while a prod machine is up). Local runs hit the real prod
data — accepted as fine for this low-stakes bot.

**Resume is manual by design.** `staging` LEAVES prod paused on exit so you can iterate (many local
runs) without prod flapping up/down. Resume yourself when done: `npm run prod:resume`. (`prod:pause`
is the symmetric manual pause; both call scripts/prod.sh, idempotent.) `RESUME=1 npm run staging`
auto-resumes on exit for a one-shot run. Pausing is idempotent, so only the forgotten *resume* is a
risk — the script prints a loud reminder that the live bot is still down.

## Deploying — read before you deploy (hard-won)
- `fly.toml` = **PRODUCTION** (`app = zigliki-hi-bot`); a bare `fly deploy` deploys prod. No staging
  config — for dev, `npm run staging` runs locally (see above).
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
- **Branch `HIB-22+HIB-26`** (uncommitted): folder refactor (HIB-22) + HIB-26, now reworked — no
  separate staging fly app (cost); "staging" is `npm run staging` (local run against prod, prod paused).
  `fly.toml` = prod, `fly.prod.toml` deleted. To ship: `npm run pull-keys` → `npm run staging` to
  smoke-test `@HiBot stats`/`top` locally → commit → `fly deploy` (prod) → merge to master.
- Open HIB tickets: **HIB-21** (DB writes are fire-and-forget — unhandled rejections / silent failures),
  **HIB-23** (`restartPings` can fire an immediate `hi` on boot when a server is overdue).
- Small follow-ups (no ticket yet): exclude HiBot from the `top` leaderboard in `db.getTopStats`
  (its stats are saved intentionally but shouldn't rank); accept `<@!id>` (nickname) mentions in the
  command parser, not just `<@id>`.
