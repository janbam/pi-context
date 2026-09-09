import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import registerContext from "../dist/index.js";

function createHarness({ dispatch = "immediate", idle = async () => {} } = {}) {
    const commands = new Map();
    const tools = new Map();
    const events = new Map();
    const sent = [];
    const notifications = [];
    const operations = [];
    const entries = [{ id: "aaaaaaaa", type: "message", message: {
        role: "assistant", content: [{ type: "toolCall", id: "call", name: "context_compact", arguments: {} }],
    } }];
    let leaf = "aaaaaaaa";
    const ctx = {
        sessionManager: {
            getLeafId: () => leaf,
            getLabel: () => undefined,
            getBranch: () => entries,
            branchWithSummary: (target, summary) => {
                operations.push(["summary", target, summary]);
                leaf = "cccccccc";
                return leaf;
            },
            branch: (target) => { leaf = target; },
        },
        getContextUsage: () => undefined,
        abort: () => operations.push(["abort"]),
        ui: {
            notify: (...args) => notifications.push(args),
            getEditorText: () => assert.fail("must not read editor"),
            setEditorText: () => assert.fail("must not overwrite editor"),
        },
    };
    const commandCtx = {
        ...ctx,
        waitForIdle: async () => {
            operations.push(["idle"]);
            await idle();
        },
        navigateTree: async (target) => { operations.push(["navigate", target]); },
    };
    const pi = {
        registerCommand: (name, definition) => commands.set(name, definition),
        registerTool: (definition) => tools.set(definition.name, definition),
        on: (name, handler) => events.set(name, handler),
        setLabel: () => {},
        sendMessage: (...args) => operations.push(["continue", ...args]),
        sendUserMessage: (content, options) => {
            sent.push({ content, options });
            if (content !== "/acm") return;
            assert.equal(options.expandPromptTemplates, true);
            if (dispatch === "throw") throw new Error("dispatch failed");
            if (dispatch === "immediate") void commands.get("acm").handler("", commandCtx);
            if (dispatch === "async") queueMicrotask(() => commands.get("acm").handler("", commandCtx));
        },
    };
    registerContext(pi);
    return {
        sent, notifications, operations, commandCtx,
        append: (entry) => { entries.push(entry); leaf = entry.id; },
        manual: (args = "") => commands.get("acm").handler(args, commandCtx),
        emit: (name) => events.get(name)?.({}, ctx),
        compact: (signal) => tools.get("context_compact").execute("call", {
            target: "bbbbbbbb", summary: "Stable result; continue with validation.",
        }, signal, undefined, ctx),
    };
}

for (const dispatch of ["immediate", "async"]) {
    test(`automatically acquires command ctx with ${dispatch} dispatch and reuses it`, async () => {
        const h = createHarness({ dispatch });
        assert.equal((await h.compact()).content[0].text, "compact start");
        await h.compact();
        assert.deepEqual(h.sent, [{
            content: "/acm",
            options: { deliverAs: "followUp", expandPromptTemplates: true },
        }]);
        assert.deepEqual(h.operations, []);
        assert.deepEqual(h.notifications, []);
    });
}

test("manual /acm remains compatible and avoids automatic dispatch", async () => {
    const h = createHarness();
    await h.manual("Continue the task");
    await h.compact();
    assert.deepEqual(h.sent, [{ content: "Continue the task", options: { deliverAs: "followUp" } }]);
    assert.equal(h.notifications.length, 1);
});

test("waits for idle before creating a summary and continuing", async () => {
    let releaseIdle;
    const idle = new Promise((resolve) => { releaseIdle = resolve; });
    const h = createHarness({ idle: () => idle });
    await h.compact();
    await h.emit("turn_end");
    await h.emit("agent_end");
    await delay(10);
    assert.deepEqual(h.operations.map(([name]) => name), ["abort", "idle"]);
    releaseIdle();
    await delay(10);
    assert.deepEqual(h.operations.map(([name]) => name), ["abort", "idle", "summary", "navigate", "continue"]);
});

test("dispatch failure does not schedule compaction or alter the editor", async () => {
    const h = createHarness({ dispatch: "throw" });
    await assert.rejects(h.compact(), /dispatch failed/);
    await h.emit("turn_end");
    await h.emit("agent_end");
    assert.deepEqual(h.operations, []);
});

test("missing command callback times out without scheduling compaction and permits retry", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const h = createHarness({ dispatch: "none" });
    const failed = assert.rejects(h.compact(), /command context acquisition timed out/);
    t.mock.timers.tick(5000);
    await failed;
    await h.emit("turn_end");
    assert.deepEqual(h.operations, []);
    await h.manual();
    assert.equal((await h.compact()).content[0].text, "compact start");
});

test("session shutdown rejects pending acquisition and a new instance acquires its own ctx", async () => {
    const h = createHarness({ dispatch: "none" });
    const failed = assert.rejects(h.compact(), /session closed/);
    await h.emit("session_shutdown");
    await failed;
    assert.deepEqual(h.operations, []);
    const next = createHarness();
    await next.compact();
    assert.equal(next.sent.length, 1);
});

test("session shutdown while idle is pending prevents stale navigation", async () => {
    let releaseIdle;
    const idle = new Promise((resolve) => { releaseIdle = resolve; });
    const h = createHarness({ idle: () => idle });
    await h.compact();
    await h.emit("agent_end");
    await delay(10);
    await h.emit("session_shutdown");
    releaseIdle();
    await delay(10);
    assert.deepEqual(h.operations.map(([name]) => name), ["idle"]);
});

for (const entry of [
    { id: "user-after-request", type: "message", message: { role: "user", content: "New instruction" } },
    { id: "sibling-result", type: "message", message: { role: "toolResult", toolCallId: "sibling", toolName: "bash", content: [] } },
    { id: "turn-end-message", type: "custom_message", customType: "other-extension", content: "New context" },
]) {
    test(`cancels when ${entry.id} arrives before agent_end`, async () => {
        const h = createHarness();
        await h.compact();
        h.append(entry);
        await h.emit("turn_end");
        await h.emit("agent_end");
        await delay(10);
        assert.equal(h.operations.some(([name]) => name === "summary"), false);
        assert.ok(h.notifications.some(([message]) => message.includes("cancelled")));
    });
}

test("cancels for contextual entries appended by hooks before compact execute", async () => {
    const h = createHarness();
    h.append({ id: "preflight-message", type: "custom_message", content: "New context" });
    await h.compact();
    await h.emit("agent_end");
    await delay(10);
    assert.equal(h.operations.some(([name]) => name === "summary"), false);
});

test("allows own compact result and the empty abort boundary before agent_end", async () => {
    const h = createHarness();
    await h.compact();
    h.append({ id: "own-result", type: "message", message: {
        role: "toolResult", toolCallId: "call", toolName: "context_compact", content: [], isError: false,
    } });
    h.append({ id: "abort-boundary", type: "message", message: {
        role: "assistant", stopReason: "error", errorMessage: "This operation was aborted", content: [],
    } });
    await h.emit("agent_end");
    await delay(10);
    assert.equal(h.operations.filter(([name]) => name === "summary").length, 1);
});

test("aborted tool does not start compaction after acquiring ctx", async () => {
    const h = createHarness();
    await assert.rejects(h.compact(AbortSignal.abort()), /cancelled before compaction started/);
    await h.emit("turn_end");
    assert.deepEqual(h.operations, []);
});
