const { test } = require("node:test");
const assert = require("node:assert");
const { hostOf, check } = require("../scripts/stagingGuard");

const prod = {
    LOGIN: "prod-token",
    MONGO_URI: "mongodb+srv://zigliki-admin:prodpass@hibot.nectjrd.mongodb.net/?retryWrites=true&w=majority",
    HEALTHCHECK_URL: "https://hc-ping.com/prod"
};

const staging = {
    LOGIN: "staging-token",
    MONGO_URI: "mongodb+srv://zigliki-admin:stagingpass@hibot.169awbe.mongodb.net/?retryWrites=true&w=majority",
    HEALTHCHECK_URL: ""
};

test("hostOf: pulls the host out of srv and plain connection strings", () => {
    assert.strictEqual(hostOf(prod.MONGO_URI), "hibot.nectjrd.mongodb.net");
    assert.strictEqual(hostOf("mongodb://localhost:27017/HiBot"), "localhost:27017");
    assert.strictEqual(hostOf("mongodb+srv://hibot.169awbe.mongodb.net/"), "hibot.169awbe.mongodb.net");
    assert.strictEqual(hostOf(undefined), "");
    assert.strictEqual(hostOf("not a uri"), "");
});

test("check: a separate bot and database is fine", () => {
    assert.deepStrictEqual(check(staging, prod), []);
});

test("check: refuses prod's bot token", () => {
    const problems = check({ ...staging, LOGIN: "prod-token" }, prod);
    assert.strictEqual(problems.length, 1);
    assert.match(problems[0], /prod's bot token/);
});

test("check: refuses prod's database host even with a different password", () => {
    const problems = check({ ...staging, MONGO_URI: "mongodb+srv://other:pw@hibot.nectjrd.mongodb.net/" }, prod);
    assert.strictEqual(problems.length, 1);
    assert.match(problems[0], /prod's database host \(hibot\.nectjrd\.mongodb\.net\)/);
});

test("check: refuses prod's health check URL but allows an empty one", () => {
    const problems = check({ ...staging, HEALTHCHECK_URL: prod.HEALTHCHECK_URL }, prod);
    assert.strictEqual(problems.length, 1);
    assert.match(problems[0], /HEALTHCHECK_URL/);
});

test("check: a missing token or connection string is reported", () => {
    const problems = check({ HEALTHCHECK_URL: "" }, prod);
    assert.deepStrictEqual(problems, ["LOGIN is missing", "MONGO_URI is missing"]);
});

test("check: an old-style staging file with MONGO_PWD and no MONGO_URI is refused", () => {
    const problems = check({ LOGIN: "staging-token", MONGO_PWD: "pw" }, prod);
    assert.deepStrictEqual(problems, ["MONGO_URI is missing"]);
});

test("check: with no prod values to compare against, only the missing-key checks apply", () => {
    assert.deepStrictEqual(check(staging, {}), []);
});
