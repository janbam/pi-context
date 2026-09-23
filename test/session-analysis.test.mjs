import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { analyzeSessionSnapshot, parseSessionSnapshot, simulateSessionThreshold } from '../tools/session-analysis/analyze-session.mjs';

const timestamp = second => new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();
const entry = (id, type, second, extra = {}) => ({ id, type, timestamp: timestamp(second), ...extra });
const assistant = (id, parentId, second, usage, content = []) => entry(id, 'message', second, {
    parentId, message: { role: 'assistant', model: 'test-model', usage, content },
});
const compactCall = { type: 'toolCall', id: 'call-compact', name: 'context_compact', arguments: { target: 'root', backupCheckpoint: 'phase-backup' } };
const checkpointCall = { type: 'toolCall', name: 'context_checkpoint', arguments: { name: 'phase-start' } };
function snapshot(entries) {
    return parseSessionSnapshot(Buffer.from(entries.map(value => JSON.stringify(value)).join('\n') + '\n'));
}
function compactFixture() {
    return [
        entry('session', 'session', 0),
        assistant('a', 'session', 1, { input: 10, cacheRead: 90, output: 5, totalTokens: 105 }, [checkpointCall]),
        entry('label', 'label', 2, { parentId: 'a', targetId: 'a', label: 'phase-start' }),
        assistant('b', 'label', 3, { input: 150, output: 5 }, [compactCall]),
        entry('backup', 'label', 4, { parentId: 'b', targetId: 'b', label: 'phase-backup' }),
        entry('result', 'message', 5, { parentId: 'backup', message: { role: 'toolResult', toolCallId: 'call-compact', isError: false } }),
        assistant('aborted', 'result', 6, { input: 0, output: 0 }),
        entry('summary', 'branch_summary', 7, { parentId: null, fromId: 'aborted', summary: 'Do not export summary text' }),
        assistant('c', 'summary', 8, { input: 40, output: 3 }),
    ];
}

test('session snapshot fixes physical line cutoff and hash; tolerates only incomplete final line', () => {
    const first = JSON.stringify(entry('s', 'session', 0)) + '\n';
    const raw = Buffer.from(first + '{"type":');
    const parsed = parseSessionSnapshot(raw);
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.warnings.length, 1);
    assert.equal(parsed.snapshotLines, 2);
    const fixed = parseSessionSnapshot(raw, 1);
    assert.equal(fixed.snapshotSha256, createHash('sha256').update(first).digest('hex'));
    assert.deepEqual(fixed.warnings, []);
    assert.throws(() => parseSessionSnapshot(Buffer.from(first + '{bad}\n')), /invalid at line 2/);
    assert.throws(() => parseSessionSnapshot(Buffer.from('{bad}\n' + first)), /invalid at line 1/);
    assert.throws(() => parseSessionSnapshot(raw, 0), /positive integer/);
});

test('session analysis counts cache tokens, excludes zero context, and confirms compaction ancestry', () => {
    const data = analyzeSessionSnapshot(snapshot(compactFixture()));
    assert.equal(data.metadata.validRequests, 3);
    assert.equal(data.metadata.excludedZeroContext, 1);
    assert.equal(data.metadata.cumulativeTokens, 303);
    assert.equal(data.metadata.peakContext, 150);
    assert.deepEqual(data.checkpoints.map(value => value.kind), ['checkpoint', 'backup']);
    assert.equal(data.checkpoints[0].timestamp, timestamp(2));
    assert.equal(data.checkpoints[0].targetTime, timestamp(1));
    assert.equal(data.events[0].kind, 'pi-context');
    assert.equal(data.events[0].before, 150);
    assert.equal(data.events[0].after, 40);
    assert.equal(data.events[0].reduction, 110);
    assert.equal(JSON.stringify(data).includes('Do not export summary text'), false);
    assert.deepEqual(data.warnings, []);
});

test('ordinary branches, failed compact calls, label clears and native compaction stay distinct', () => {
    const entries = compactFixture();
    entries[5].message.isError = true;
    entries.push(entry('clear', 'label', 9, { parentId: 'c', targetId: 'a' }));
    entries.push(entry('manual-label', 'label', 10, { parentId: 'clear', targetId: 'a', label: 'manual' }));
    entries.push(entry('native', 'compaction', 11, { parentId: 'c', usage: { input: 3, output: 2 },
        retainedTail: [{ usage: { input: 9999 } }] }));
    const data = analyzeSessionSnapshot(snapshot(entries));
    assert.deepEqual(data.events.map(value => value.kind), ['branch-summary', 'native-compaction']);
    assert.equal(data.events[1].after, null);
    assert.deepEqual(data.checkpoints.map(value => value.kind), ['checkpoint', 'backup', 'label']);
    assert.equal(data.metadata.cumulativeTokens, 308);
    assert.match(data.warnings[0], /unattributed/);
});

test('stale compaction calls cannot classify a later unrelated branch summary', () => {
    const entries = compactFixture();
    entries[6] = assistant('aborted', 'result', 6, { input: 160, output: 2 });
    const data = analyzeSessionSnapshot(snapshot(entries));
    assert.equal(data.events[0].kind, 'branch-summary');
});

test('auxiliary work and output-only records count toward cumulative tokens, not input observations', () => {
    const entries = [entry('s', 'session', 0), assistant('a', 's', 1, { input: 10, output: 2 }),
        entry('tool', 'message', 2, { message: { role: 'toolResult', usage: { input: 5, cacheWrite: 3, output: 1 } } }),
        assistant('empty', 'tool', 3, undefined), assistant('output', 'empty', 4, { output: 3 }),
        entry('summary', 'compaction', 5, { usage: { input: 8, output: 2 } })];
    const data = analyzeSessionSnapshot(snapshot(entries));
    assert.equal(data.metadata.cumulativeTokens, 34);
    assert.equal(data.points.length, 1);
    assert.equal(data.usageRows.length, 4);
    assert.equal(data.metadata.missingAssistantUsage, 1);
    assert.equal(data.metadata.excludedZeroContext, 1);
});

test('invalid or unknown usage is reported rather than plotted as a false zero', () => {
    const data = analyzeSessionSnapshot(snapshot([
        assistant('a', null, 1, { input: -1 }), assistant('b', 'a', 2, { totalTokens: 123 }),
        assistant('c', 'b', 3, { input: 4, totalTokens: 100 }),
    ]));
    assert.equal(data.points.length, 1);
    assert.equal(data.metadata.cumulativeTokens, 4);
    assert.equal(data.warnings.length, 4);
    assert.throws(() => analyzeSessionSnapshot(snapshot([entry('s', 'session', 2), entry('x', 'label', 1)])), /out of order/);
    assert.throws(() => analyzeSessionSnapshot(snapshot([{ type: 'session' }])), /timestamp invalid/);
});

test('threshold simulation neutralizes confirmed drops, preserves other deltas and threshold overflow', () => {
    const points = [40, 80, 20, 100, 400, 350].map((context, index) => ({ context, line: index + 1, time: index }));
    const events = [{ kind: 'pi-context', before: 80, after: 20, afterLine: 3 }];
    const result = simulateSessionThreshold(points, events, { window: 100, threshold: 0.9, reset: 30 });
    assert.deepEqual(result.samples.map(point => point.value), [40, 80, 80, 40, 40, 0]);
    assert.equal(result.resets.length, 7);
    assert.deepEqual(result.neutralizedLines, [3]);
    assert.ok(result.samples.every(point => point.value >= 0 && point.value < result.limit));
    const ordinary = simulateSessionThreshold(points.slice(0, 3), [{ ...events[0], kind: 'branch-summary' }], { window: 100, threshold: 0.9, reset: 30 });
    assert.equal(ordinary.samples[2].value, 20);
    const boundary = simulateSessionThreshold([{ context: 90, line: 1, time: 0 }], [], { window: 100, threshold: 0.9, reset: 30 });
    assert.equal(boundary.samples[0].value, 30);
    assert.equal(boundary.resets.length, 1);
    assert.deepEqual(simulateSessionThreshold([], []).trace, []);
    assert.throws(() => simulateSessionThreshold([], [], { reset: 244800 }), /requires/);
    assert.throws(() => simulateSessionThreshold([], [], { threshold: NaN }), /requires/);
});

test('chart time axis removes idle intervals, preserves active elapsed time and restores real labels', async () => {
    const template = await readFile(new URL('../tools/session-analysis/session-chart.html', import.meta.url), 'utf8');
    const script = template.match(/<script id="session-time-axis">(.*?)<\/script>/s)[1];
    const createAxis = runInNewContext(`${script}\ncreateSessionTimeAxis`);
    const minute = 60000;
    const axis = createAxis([0, minute, 61 * minute, 63 * minute, 123 * minute, 124 * minute]);
    assert.equal(axis.gaps.length, 2);
    assert.equal(axis.toPlotTime(61 * minute), minute);
    assert.equal(axis.toPlotTime(123 * minute), 3 * minute);
    assert.equal(axis.toPlotTime(124 * minute), 4 * minute);
    assert.equal(axis.toPlotTime(30 * minute), minute);
    assert.equal(axis.fromPlotTime(minute), 61 * minute);
    assert.equal(axis.fromPlotTime(2 * minute), 62 * minute);
    assert.equal(axis.fromPlotTime(4 * minute), 124 * minute);
    assert.equal(createAxis([0, 30 * minute]).gaps.length, 0);
    assert.equal(createAxis([123]).toPlotTime(123), 123);
    assert.equal(createAxis([]).fromPlotTime(0), 0);
});

test('CLI writes offline safe HTML/CSV and rejects overwrite and bad options', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-session-analysis-'));
    try {
        const input = join(directory, 'session.jsonl'), output = join(directory, 'report');
        const entries = compactFixture();
        const hostileLabel = '=HYPERLINK("</script><script>alert(1)</script>")';
        entries[1].message.content[0] = { ...checkpointCall, arguments: { name: hostileLabel } };
        entries[2].label = hostileLabel;
        await writeFile(input, entries.map(value => JSON.stringify(value)).join('\n') + '\n');
        const cli = 'tools/session-analysis/session-analysis-cli.mjs';
        const args = [cli, input, '--out', output, '--window', '1000', '--reset', '30', '--timezone', 'UTC'];
        const printed = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
        assert.equal(printed.validRequests, 3);
        const html = await readFile(join(output, 'session-token-chart.html'), 'utf8');
        assert.ok(!html.includes(hostileLabel));
        assert.ok(!html.includes('__SESSION_DATA__'));
        assert.ok(!html.includes('src="http'));
        const embedded = JSON.parse(html.match(/<script id="session-data" type="application\/json">(.*?)<\/script>/s)[1]);
        assert.equal(embedded.checkpoints[0].name, hostileLabel);
        assert.equal(embedded.simulation.window, 1000);
        const csv = await readFile(join(output, 'session-checkpoints.csv'), 'utf8');
        assert.ok(csv.includes('"\'=HYPERLINK'));
        assert.equal(spawnSync(process.execPath, args).status, 1);
        assert.equal(spawnSync(process.execPath, [cli, input, '--unknown']).status, 1);
        assert.equal(spawnSync(process.execPath, [cli, input, '--timezone', 'Not/AZone']).status, 1);
        assert.equal(spawnSync(process.execPath, [cli, input, '--max-lines', '0']).status, 1);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
