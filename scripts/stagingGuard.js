// stagingGuard.js - refuses a staging run that would touch prod (HIB-41).
// Compares the staging env file with the prod one (keys.env) and exits 1 on a problem.
//
//   node scripts/stagingGuard.js <staging env file> <prod env file>
const fs = require('fs');
const { parseEnv } = require('util');

//host part of a mongodb:// or mongodb+srv:// connection string ('' when there isn't one)
function hostOf(uri) {
    const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri || '');
    return match ? match[1] : '';
}

//what is wrong with the staging env (empty = safe to run); both are plain {KEY: value} objects
function check(staging, prod) {
    const problems = [];
    if (!staging.LOGIN) problems.push('LOGIN is missing');
    if (!staging.MONGO_URI) problems.push('MONGO_URI is missing');
    if (staging.LOGIN && staging.LOGIN === prod.LOGIN) {
        problems.push("LOGIN is prod's bot token");
    }
    const host = hostOf(staging.MONGO_URI);
    if (host && host === hostOf(prod.MONGO_URI)) {
        problems.push("MONGO_URI is prod's database host (" + host + ')');
    }
    if (staging.HEALTHCHECK_URL && staging.HEALTHCHECK_URL === prod.HEALTHCHECK_URL) {
        problems.push("HEALTHCHECK_URL is prod's (staging would ping prod's check)");
    }
    return problems;
}

function readEnv(file) {
    return fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : null;
}

function main() {
    const [stagingFile, prodFile] = process.argv.slice(2);
    const staging = readEnv(stagingFile);
    if (!staging) {
        console.error(stagingFile + ' not found');
        process.exit(1);
    }
    const prod = readEnv(prodFile);
    if (!prod) console.warn(prodFile + ' not found, so staging could not be compared with prod');

    const problems = check(staging, prod || {});
    if (problems.length) {
        console.error('staging refused to start:');
        problems.forEach((p) => console.error('  - ' + p));
        process.exit(1);
    }
    console.log('staging database host: ' + hostOf(staging.MONGO_URI));
}

if (require.main === module) main();

module.exports = { hostOf, check };
