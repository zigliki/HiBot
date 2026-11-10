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
Mention the bot, e.g. `@HiBot stats`:
- `stats`, `first`, `top`, `chain` (add `@user` to `stats`/`first` to look someone else up)
- `output` (server admins) sets the bot-control channel
- `pic` and `status` (bot admin only) change the bot's picture and status

## Running it
It's Node.js with discord.js and MongoDB (Atlas), deployed on fly.io. The hi state, per-user stats, settings and
logs are all stored in MongoDB, so a restart doesn't lose anything.

```
npm install
npm start       # needs keys.env (LOGIN, MONGO_PWD, DEV)
npm test        # unit tests, no network needed
npm run logs    # read the bot's logs from MongoDB
```

`npm run staging` runs the bot locally against the production database (and pauses the fly machine while it
does). See CLAUDE.md for how the project is laid out, how logging and the health check work, and how to deploy.
