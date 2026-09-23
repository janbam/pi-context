#!/usr/bin/env node
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { basename, resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeSessionSnapshot, parseSessionSnapshot, simulateSessionThreshold } from './analyze-session.mjs';

function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    const safe = typeof value === 'string' && /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
}

function sessionCsv(rows, fields) {
    return [fields.map(csvCell).join(','), ...rows.map(row => fields.map(field => csvCell(row[field])).join(','))].join('\n') + '\n';
}

try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
        out: { type: 'string' }, 'max-lines': { type: 'string' }, window: { type: 'string' },
        threshold: { type: 'string' }, reset: { type: 'string' }, timezone: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
    } });
    if (values.help) {
        console.log('Usage: npm run analyze:session -- SESSION.jsonl [--out DIRECTORY] [--max-lines N]\n'
            + '       [--window 272000] [--threshold 0.9] [--reset 39000] [--timezone Asia/Shanghai]\n'
            + 'Writes offline HTML, JSON and CSV. Existing reports are never overwritten.');
    } else {
        if (positionals.length !== 1) throw new Error('Session analysis requires exactly one JSONL path; use --help');
        const source = resolve(positionals[0]);
        const timezone = values.timezone ?? 'Asia/Shanghai';
        new Intl.DateTimeFormat('en', { timeZone: timezone });
        const snapshot = parseSessionSnapshot(await readFile(source), values['max-lines'] === undefined ? Infinity : Number(values['max-lines']));
        const data = analyzeSessionSnapshot(snapshot);
        data.metadata.sourceFile = basename(source);
        data.metadata.timezone = timezone;
        data.simulation = simulateSessionThreshold(data.points, data.events, Object.fromEntries(
            ['window', 'threshold', 'reset'].filter(key => values[key] !== undefined).map(key => [key, Number(values[key])])));
        // Tool behavior remains useful even when no model usage was recorded.
        const directory = resolve(values.out ?? join('.pi/session-analysis', basename(source, '.jsonl')));
        const template = await readFile(new URL('./session-chart.html', import.meta.url), 'utf8');
        const outputs = {
            'session-token-chart.html': template.replace('__SESSION_DATA__', () => JSON.stringify(data).replaceAll('<', '\\u003c')),
            'session-token-data.json': JSON.stringify(data, null, 2) + '\n',
            'session-token-usage.csv': sessionCsv(data.usageRows, ['line', 'entryId', 'timestamp', 'kind', 'model', 'input', 'cacheRead', 'cacheWrite', 'output', 'context', 'total', 'cumulative']),
            'session-compactions.csv': sessionCsv(data.events, ['number', 'line', 'timestamp', 'kind', 'beforeLine', 'afterLine', 'before', 'after', 'reduction', 'percent']),
            'session-checkpoints.csv': sessionCsv(data.checkpoints, ['line', 'timestamp', 'kind', 'name', 'targetId', 'targetTime']),
            'session-simulation.csv': sessionCsv(data.simulation.samples, ['line', 'time', 'value']),
            'session-tool-calls.csv': sessionCsv(data.tools, ['key', 'line', 'entryId', 'callId', 'name', 'family', 'requestLine', 'timestamp', 'resultLine', 'resultTime', 'status', 'resource', 'resourceId', 'readOffset', 'readLimit', 'outputChars', 'truncated']),
            'session-compact-attempts.csv': sessionCsv(data.compactAttempts, ['key', 'line', 'time', 'status', 'resultLine', 'branchLine', 'continuationLine', 'targetId', 'targetLine', 'targetName', 'summaryChars', 'retainedToolCount', 'firstWorkToolKey']),
            'session-rereads.csv': sessionCsv(data.compactAttempts.flatMap(attempt => attempt.rereads.map(read => ({ compactKey: attempt.key, ...read }))), ['compactKey', 'toolKey', 'previousToolKey', 'match', 'removed']),
        };
        for (const name of Object.keys(outputs)) {
            try { await access(join(directory, name)); }
            catch (error) { if (error.code === 'ENOENT') continue; throw error; }
            throw new Error(`Session report already exists: ${join(directory, name)}; choose another --out directory`);
        }
        await mkdir(directory, { recursive: true });
        for (const [name, content] of Object.entries(outputs)) await writeFile(join(directory, name), content, { flag: 'wx' });
        console.log(JSON.stringify({ directory, ...data.metadata,
            piContextCompactions: data.events.filter(event => event.kind === 'pi-context').length,
            checkpoints: data.checkpoints.length, simulatedResets: data.simulation.resets.length,
            warnings: data.warnings }, null, 2));
    }
} catch (error) {
    console.error(`Session analysis failed: ${error.message}`);
    process.exitCode = 1;
}
