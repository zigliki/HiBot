#!/usr/bin/env node
// registerCommands.js - register the slash commands (src/commands/slash.js) with Discord (HIB-37).
//
//   npm run register-commands                            dry run: prints what each server would get, sends nothing
//   npm run register-commands -- --apply                 register in every server the bot is in
//   npm run register-commands -- --guild <id> --apply    register in one server only
//
// Nothing is registered globally: each server gets its own set, and the golden-age server (Shaun The Sheep) gets a /chain
// that also offers the pre-HiBot era (see slash.js). The bot registers a server itself when it joins (src/events/guildCreate.js),
// so this script is for the servers it was already in, and for after a command changes.
// This REPLACES every command in a server, so a command not in its set is removed.
// `npm run register-commands` registers for the prod bot (LOGIN from keys.env); `npm run register-commands:staging`
// does the same for the staging bot (keys.staging.env). Both bots can be in the same server, each with its own commands.
// Prod runs the old code until it's deployed, so a command registered early shows up and fails to answer.
const { REST, Routes } = require('discord.js');
const slash = require('../src/commands/slash');
const slashRegistry = require('../src/discord/slashRegistry');

function parseArgs(argv) {
    const opts = { apply: false, guild: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--apply') opts.apply = true;
        else if (arg === '--guild') {
            if (i + 1 >= argv.length) throw new Error('--guild needs a server id');
            opts.guild = argv[++i];
        } else throw new Error('unknown option ' + arg);
    }
    return opts;
}

function describe(json) {
    //one line per command: name, options, who can see it by default
    const options = (json.options || []).map((o) => o.name + (o.required ? '*' : '')).join(', ');
    const hidden = json.default_member_permissions ? ' [admins only by default]' : '';
    return '/' + json.name + (options ? ' (' + options + ')' : '') + hidden;
}

function logSet(deps, title, set) {
    deps.log(title);
    set.forEach((c) => deps.log('  ' + describe(c.data.toJSON())));
}

async function register(opts, deps) {
    //deps: { rest, log } so tests can stand in for Discord
    if (!opts.apply) {
        if (opts.guild) {
            logSet(deps, 'server ' + opts.guild + ' would get:', slash.commandsFor(opts.guild));
        } else {
            logSet(deps, 'every server except ' + slash.goldenAgeGuild() + ' would get:', slash.commands);
            logSet(deps, 'the golden-age server ' + slash.goldenAgeGuild() + ' would get:', slash.goldenAgeCommands);
        }
        deps.log('dry run: nothing was sent. add --apply to register these (this replaces all commands in each server)');
        return { applied: false, servers: 0, failed: [] };
    }

    const app = await deps.rest.get(Routes.currentApplication());
    const guilds = opts.guild ? [{ id: opts.guild, name: opts.guild }] : await deps.rest.get(Routes.userGuilds());
    const failed = [];
    for (const guild of guilds) {
        try {
            const count = await slashRegistry.registerForGuild(deps.rest, app.id, guild.id);
            deps.log('registered ' + count + ' commands in ' + guild.name + ' (' + guild.id + ')');
        } catch (err) {
            failed.push(guild.id);
            deps.log('FAILED in ' + guild.name + ' (' + guild.id + '): ' + err.message);
        }
    }
    return { applied: true, servers: guilds.length, failed: failed };
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const rest = opts.apply ? new REST().setToken(process.env.LOGIN) : null;
    const result = await register(opts, { rest: rest, log: console.log });
    if (result.failed.length) process.exit(1);
}

if (require.main === module) {
    main().catch((err) => {
        console.error('register-commands: ' + err.message);
        process.exit(1);
    });
}

module.exports = { parseArgs, describe, register };
