#!/usr/bin/env node
// registerCommands.js - register the slash commands (src/commands/slash.js) with Discord (HIB-37).
//
//   npm run register-commands                      dry run: prints what would be registered, sends nothing
//   npm run register-commands -- --apply           register globally (can take up to an hour to show up)
//   npm run register-commands -- --guild <id> --apply    register in one server only (shows up immediately)
//
// This REPLACES every command at that scope, so a command not in the list is removed. Needs LOGIN in keys.env.
// Prod runs the old code until it's deployed, so a command registered early shows up and fails to answer.
const path = require('path');
const { REST, Routes } = require('discord.js');

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

async function register(opts, commands, deps) {
    //deps: { rest, log } so tests can stand in for Discord
    const body = commands.map((c) => c.data.toJSON());
    const where = opts.guild ? 'server ' + opts.guild : 'every server (global)';
    deps.log('target: ' + where);
    body.forEach((json) => deps.log('  ' + describe(json)));
    if (!opts.apply) {
        deps.log('dry run: nothing was sent. add --apply to register these (this replaces all commands at that scope)');
        return { applied: false, count: body.length };
    }
    const app = await deps.rest.get(Routes.currentApplication());
    const route = opts.guild ? Routes.applicationGuildCommands(app.id, opts.guild) : Routes.applicationCommands(app.id);
    const result = await deps.rest.put(route, { body: body });
    deps.log('registered ' + result.length + ' commands');
    return { applied: true, count: result.length };
}

async function main() {
    require('dotenv').config({ path: path.join(__dirname, '..', 'keys.env') });
    const opts = parseArgs(process.argv.slice(2));
    const { commands } = require('../src/commands/slash');
    const rest = opts.apply ? new REST().setToken(process.env.LOGIN) : null;
    await register(opts, commands, { rest: rest, log: console.log });
}

if (require.main === module) {
    main().catch((err) => {
        console.error('register-commands: ' + err.message);
        process.exit(1);
    });
}

module.exports = { parseArgs, describe, register };
