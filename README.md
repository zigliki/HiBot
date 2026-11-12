# HiBot
silly discord bot that manages a #hi channel

Project has an issue tracker https://zigliki.atlassian.net/browse/HIB however, due to the free jira plan, it is in accessible to everyone. Please Submit issues at hibot.zigliki.com

## The game
People post `hi` in a server's `#hi` channel. A hi only counts if:
- the message is exactly `hi`
- it's from a different person than the last valid hi (no back-to-back)
- it's at least 24 hours after the last valid hi

Anything else in `#hi` gets deleted, and the bot says why in the server's bot-control channel. If a channel goes
7 days without a hi, the bot posts `hi` itself to get the chain going again. It runs in several servers at once.

## Commands
Two ways to run a command, with the same results:
- Mention the bot, e.g. `@HiBot stats`
- Slash commands, e.g. `/stats`, in any channel

Commands:
- `stats`, `first`, `top`, `chain` (add `@user` to `stats`/`first` to look someone else up)
- `output` (server admins) sets the bot-control channel
- `pic` and `status` (bot admin only) change the bot's picture and status. These are `@HiBot` or DM only, there is no slash version.

Slash commands are registered per server, never globally. Shaun The Sheep's `/chain` also offers the pre-HiBot
"golden age" (`era`); every other server gets the main set. A server gets its commands when the bot joins it.

## Running it
It's Node.js with discord.js and MongoDB (Atlas), deployed on fly.io. The hi state, per-user stats, settings and
logs are all stored in MongoDB, so a restart doesn't lose anything.

The bot reads real environment variables (`LOGIN`, `MONGO_URI`, `DEV`). fly provides them as secrets; locally,
`--env-file` loads them from a file.

```
npm install
npm start                                 # needs the env vars set (fly secrets)
npm test                                  # unit tests, no network needed
npm run logs                              # read the bot's logs from MongoDB (keys.env)
npm run register-commands                 # dry run: show what each server would get
npm run register-commands -- --apply      # register slash commands in every server the bot is in
```

### Staging
`npm run staging` runs the bot locally with its own Discord bot (HiBot-Staging) and its own MongoDB, so it never
touches prod and prod keeps running. Create `keys.staging.env` (gitignored):

```
LOGIN=<staging bot token>
MONGO_URI=<staging database url>
DEV=<your discord user id>
GOLDEN_AGE_GUILD=<optional: a server id to play Shaun The Sheep>
```

A guard refuses to start if the staging file points at the same bot or database as `keys.env`. Useful scripts:
`npm run logs:staging` and `npm run register-commands:staging` (add `-- --apply`).

See CLAUDE.md for how the project is laid out, how logging and the health check work, and how to deploy.
