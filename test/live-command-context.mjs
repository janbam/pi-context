import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// Opt-in live test: invokes a real model, uses existing Pi auth, and costs tokens.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = await mkdtemp(resolve(tmpdir(), "pi-context-live-"));
const model = process.env.PI_CONTEXT_TEST_MODEL || "openai-codex/gpt-5.6-luna";
console.log(JSON.stringify({ artifacts, model }));

function startPi(name, sessionFile, guard = false) {
    const events = [];
    const pending = new Map();
    let sequence = 0;
    let stderr = "";
    let buffer = "";
    const child = spawn(process.execPath, [
        resolve(root, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
        "--offline", "--mode", "rpc", "--model", model, "--thinking", "low",
        "--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates",
        "--no-builtin-tools", "-e", resolve(root, "test/live-command-context-extension.ts"),
        "--system-prompt", "Execute the requested integration test exactly. Keep output minimal. After compaction obey the summary's next step; never repeat completed tool calls.",
        ...(sessionFile ? ["--session", sessionFile] : ["--session-dir", artifacts]),
    ], {
        cwd: artifacts, stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PI_CONTEXT_TEST_ADVANCE: guard ? "1" : "" },
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newline).replace(/\r$/, "");
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            const event = JSON.parse(line);
            events.push(event);
            if (event.type === "response" && pending.has(event.id)) {
                const { resolve, reject } = pending.get(event.id);
                pending.delete(event.id);
                if (event.success) resolve(event.data);
                else reject(new Error(event.error));
            }
            if (event.type === "tool_execution_end") console.log(name, event.toolName, JSON.stringify(event.result));
            if (event.type === "extension_error") console.error(name, JSON.stringify(event));
        }
    });
    const exited = once(child, "exit");
    child.on("exit", (code, signal) => {
        for (const { reject } of pending.values()) reject(new Error(`Pi exited: ${code}/${signal}; ${stderr}`));
        pending.clear();
    });
    return {
        events,
        async request(type, fields = {}) {
            assert.equal(child.exitCode, null, stderr);
            const id = String(++sequence);
            let timeout;
            try {
                return await new Promise((resolve, reject) => {
                    pending.set(id, { resolve, reject });
                    timeout = setTimeout(() => {
                        pending.delete(id);
                        reject(new Error(`RPC ${type} timed out; ${stderr}`));
                    }, 30000);
                    child.stdin.write(JSON.stringify({ type, id, ...fields }) + "\n");
                });
            } finally { clearTimeout(timeout); }
        },
        async close() {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
            const killTimeout = setTimeout(() => child.kill("SIGKILL"), 5000);
            try { await exited; } finally { clearTimeout(killTimeout); }
            await writeFile(resolve(artifacts, `${name}.events.jsonl`), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
            await writeFile(resolve(artifacts, `${name}.stderr.log`), stderr);
        },
    };
}

function text(message) {
    return typeof message.content === "string" ? message.content :
        (message.content || []).filter((block) => block.type === "text").map((block) => block.text).join("");
}

async function compactPhase(pi, phase, expectedAcquisitions, expectedSummaries, guard = false) {
    const marker = `LIVE_${phase}_OK`;
    const continuationText = guard ? "context_compact cancelled" : "context_compact complete";
    const offset = pi.events.length;
    await pi.request("prompt", {
        message: `Integration test phase ${phase}. Call context_compact exactly once with target "root" and summary "Phase ${phase} compaction is complete. Next step: reply exactly ${marker} without calling any tools." Do not run slash commands. Do not reply with the marker before compaction. After the tool, follow the injected summary.`,
    });
    const deadline = Date.now() + 120000;
    let complete = false;
    while (Date.now() < deadline) {
        await delay(500);
        const phaseEvents = pi.events.slice(offset);
        // context_compact intentionally aborts the old run. Codex may report
        // that boundary as an empty error message; never ignore continuation errors.
        const compactIndex = phaseEvents.findIndex((event) => event.type === "tool_execution_end" &&
            event.toolName === "context_compact" && !event.isError);
        const continuationIndex = phaseEvents.findIndex((event) => event.type === "message_start" &&
            event.message.role === "custom" && text(event.message).includes(continuationText));
        const failure = phaseEvents.find((event, index) => {
            if (event.type === "extension_error" || (event.type === "tool_execution_end" && event.isError)) return true;
            if (event.type !== "message_end" || event.message.stopReason !== "error") return false;
            const expectedAbort = compactIndex >= 0 && index > compactIndex &&
                (continuationIndex < 0 || index < continuationIndex) &&
                event.message.errorMessage === "This operation was aborted" && event.message.content.length === 0;
            return !expectedAbort;
        });
        assert.equal(failure, undefined, JSON.stringify(failure));
        const answered = phaseEvents.some((event) => event.type === "message_end" &&
            event.message.role === "assistant" && text(event.message).trim() === marker);
        if (answered) {
            const state = await pi.request("get_state");
            if (!state.isStreaming && state.pendingMessageCount === 0) { complete = true; break; }
        }
    }
    assert.ok(complete, `Phase ${phase} did not continue to ${marker}`);
    const { entries, leafId } = await pi.request("get_entries");
    const { messages } = await pi.request("get_messages");
    const acquisitions = entries.filter((entry) => entry.type === "custom" && entry.customType === "live-command-context-acquired");
    assert.equal(acquisitions.length, expectedAcquisitions, "real acquisition dispatch count");
    assert.ok(acquisitions.every((entry) => entry.data.args === ""));
    const summaries = entries.filter((entry) => entry.type === "branch_summary");
    assert.equal(summaries.length, expectedSummaries);
    if (!guard) assert.match(summaries.at(-1).summary, new RegExp(marker));
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const activeIds = [];
    for (let id = leafId; id; id = byId.get(id)?.parentId) activeIds.push(id);
    if (!guard) {
        assert.ok(activeIds.includes(summaries.at(-1).id), "new summary is on the active branch");
        // Compacting to root branches at the prompt head, so the new path leads with the original
        // system message (prompt, `<acm>`, context tools) and the continuation adds no prompt delta.
        const path = activeIds.map((id) => byId.get(id)).reverse();
        const systems = path.filter((entry) => entry.type === "message" && entry.message.role === "system");
        assert.equal(systems.length, 1, "active path keeps exactly one system message");
        assert.equal(path.find((entry) => entry.type === "message"), systems[0], "path leads with the prompt head");
        assert.ok(path.indexOf(systems[0]) < path.indexOf(summaries.at(-1)), "summary follows the prompt head");
        assert.ok(systems[0].message.sections?.preamble && systems[0].message.sections?.acm, `head carries prompt and acm: ${Object.keys(systems[0].message.sections ?? {})}`);
        assert.ok(systems[0].message.toolsAdded?.some((tool) => tool.name === "context_compact"), "head declares the context tools");
    }
    if (guard) {
        const canary = entries.find((entry) => entry.type === "custom_message" && entry.customType === "live-guard-canary");
        assert.ok(canary && activeIds.includes(canary.id), "late contextual message remains on the active branch");
        assert.ok(messages.some((message) => message.role === "custom" && message.customType === "live-guard-canary"));
    }
    assert.ok(messages.some((message) => message.role === "custom" && text(message).includes(continuationText)), "continuation was injected");
    const calls = new Set();
    for (const message of messages) {
        if (message.role === "assistant") {
            for (const block of message.content) if (block.type === "toolCall") calls.add(block.id);
        }
        if (message.role === "toolResult") assert.ok(calls.has(message.toolCallId), "no orphan tool results");
    }
    assert.ok(!entries.some((entry) => entry.type === "message" && entry.message.role === "user" && /^\/(acm|pi-context-)/.test(text(entry.message))), "commands are not model history");
    const phaseEvents = pi.events.slice(offset);
    assert.equal(phaseEvents.filter((event) => event.type === "tool_execution_end" && event.toolName === "context_compact").length, 1);
    assert.ok(!phaseEvents.some((event) => event.type === "extension_ui_request" && event.method === "set_editor_text"));
    const stats = await pi.request("get_session_stats");
    const state = await pi.request("get_state");
    assert.equal(`${state.model.provider}/${state.model.id}`, model);
    await writeFile(resolve(artifacts, `${phase}.verified.json`), JSON.stringify({
        phase, model, marker, acquisitions: acquisitions.length, summaries: summaries.length,
        sessionFile: state.sessionFile, activeIds, stats,
    }, null, 2));
    console.log(`PASS ${phase}: acquisitions=${acquisitions.length}, summaries=${summaries.length}, continuation=${marker}`);
    return state.sessionFile;
}

/** Enable ACM explicitly; `/acm enable` also captures the command context, so no acquisition follows. */
async function enableAcm(pi) {
    await pi.request("set_auto_retry", { enabled: false });
    await pi.request("prompt", { message: "/acm enable" });
}

let pi;
try {
    pi = startPi("initial");
    await enableAcm(pi);
    await compactPhase(pi, "FIRST", 0, 1);
    const sessionFile = await compactPhase(pi, "CACHED", 0, 2);
    await pi.close();
    // Resume keeps durable ACM state, so the fresh runtime must acquire the context lazily.
    pi = startPi("resumed", sessionFile);
    await pi.request("set_auto_retry", { enabled: false });
    await compactPhase(pi, "RESUMED", 1, 3);
    await pi.close();
    pi = startPi("guard", undefined, true);
    await enableAcm(pi);
    await compactPhase(pi, "GUARD", 0, 0, true);
    console.log(`PASS live command-context validation; artifacts: ${artifacts}`);
} finally {
    await pi?.close();
}
