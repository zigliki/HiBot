const { test } = require("node:test");
const assert = require("node:assert");
const { parseArgs, parseTime, buildPipeline, summarizeRuns, fmtDuration } = require("../scripts/logs");

const NOW = Date.parse("2026-11-10T12:00:00Z");

test("parseTime: durations are relative to now, dates are absolute, junk is rejected", () => {
    assert.equal(parseTime("2h", NOW).getTime(), NOW - 2 * 3600000);
    assert.equal(parseTime("30m", NOW).getTime(), NOW - 30 * 60000);
    assert.equal(parseTime("2026-11-09T22:00:00Z", NOW).getTime(), Date.parse("2026-11-09T22:00:00Z"));
    assert.throws(() => parseTime("yesterday", NOW), /bad time/);
});

test("parseArgs: defaults, flags, and errors", () => {
    const d = parseArgs([], NOW);
    assert.equal(d.since.getTime(), NOW - 3600000);
    assert.equal(d.minLevel, 10);
    assert.equal(d.limit, 200);
    const o = parseArgs(["--since", "3d", "--level", "WARN", "--event", "shard", "--boot", "b1", "--limit", "5", "--summary", "--json"], NOW);
    assert.deepEqual([o.minLevel, o.event, o.boot, o.limit, o.summary, o.json], [30, "shard", "b1", 5, true, true]);
    assert.throws(() => parseArgs(["--level", "loud"], NOW), /bad level/);
    assert.throws(() => parseArgs(["--since"], NOW), /needs a value/);
    assert.throws(() => parseArgs(["--nope"], NOW), /unknown option/);
    assert.throws(() => parseArgs(["--limit", "0"], NOW), /positive/);
});

test("buildPipeline (lines): prefilters buckets, unwinds, filters lines, newest-first limit; event is an escaped prefix", () => {
    const opts = parseArgs(["--since", "2h", "--level", "warn", "--event", "hi.rejected", "--boot", "b1", "--limit", "50"], NOW);
    const p = buildPipeline(opts);
    assert.deepEqual(p[0], { $match: { lastTs: { $gte: opts.since }, firstTs: { $lte: opts.until }, boot: "b1" } });
    assert.deepEqual(p[1], { $unwind: "$lines" });
    assert.deepEqual(p[2].$match["lines.lvl"], { $gte: 30 });
    assert.deepEqual(p[2].$match["lines.event"], { $regex: "^hi\\.rejected" });
    assert.deepEqual(p[3], { $sort: { "lines.ts": -1, "lines.seq": -1 } });
    assert.deepEqual(p[4], { $limit: 50 });
});

test("buildPipeline (summary): bucket metadata only, never the lines array", () => {
    const p = buildPipeline(parseArgs(["--summary"], NOW));
    assert.equal(p.some((stage) => stage.$unwind), false);
    assert.equal("lines" in p[1].$project, false);
});

test("summarizeRuns: folds buckets per boot and reports the gap before the next boot", () => {
    const t = (s) => new Date(Date.parse("2026-11-10T00:00:00Z") + s * 1000);
    const runs = summarizeRuns([
        { boot: "b1", machine: "m1", day: t(0), part: 0, n: 10, warns: 1, errors: 0, firstTs: t(0), lastTs: t(100) },
        { boot: "b1", machine: "m1", day: t(86400), part: 0, n: 5, warns: 0, errors: 1, firstTs: t(86400), lastTs: t(86500) },
        { boot: "b2", machine: "m2", day: t(90000), part: 0, n: 3, warns: 0, errors: 0, firstTs: t(90000), lastTs: t(90010) }
    ]);
    assert.equal(runs.length, 2);
    assert.deepEqual([runs[0].boot, runs[0].n, runs[0].warns, runs[0].errors, runs[0].buckets], ["b1", 15, 1, 1, 2]);
    assert.equal(runs[0].gapToNextMs, (90000 - 86500) * 1000);
    assert.equal(runs[1].gapToNextMs, null);
    assert.equal(fmtDuration(null), "still running / latest");
    assert.equal(fmtDuration(45000), "45s");
    assert.equal(fmtDuration(600000), "10m");
});
