const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");

function sourceFiles(dir){
    //every .js file under src/
    var out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out = out.concat(sourceFiles(full));
        else if (entry.name.endsWith(".js")) out.push(full);
    }
    return out;
}

test("every module under src/ loads (a wrong require path would crash the bot on boot)", () => {
    //src/index.js is the entry point: requiring it would start the bot
    const files = sourceFiles(SRC).filter((f) => f !== path.join(SRC, "index.js"));
    assert.ok(files.length >= 15, "expected to find the source files, found " + files.length);
    for (const file of files) {
        assert.doesNotThrow(() => require(file), path.relative(SRC, file));
    }
});

test("src/index.js only requires files that exist", () => {
    //the entry point can't be loaded here, so check its relative requires resolve instead
    const source = fs.readFileSync(path.join(SRC, "index.js"), "utf8");
    const paths = [...source.matchAll(/require\(["'](\.[^"']+)["']\)/g)].map((m) => m[1]);
    assert.ok(paths.length >= 8);
    for (const p of paths) {
        assert.doesNotThrow(() => require.resolve(path.join(SRC, p)), p);
    }
});
