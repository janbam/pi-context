import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import registerPiContext from "../dist/index.js";
import {
    AcmContextMessageType,
    AcmSessionStateKey,
    createAcmContextMessage,
    isNewSessionStart,
    parseAcmConfig,
    readAcmEnabled,
    readAcmNotificationPending,
    resolveAcmAction,
} from "../dist/acm.js";
import { wrapSystemNotification } from "../dist/utils.js";

function createHarness({ persistedState, entries = [], sessionManager: providedSessionManager } = {}) {
    const commands = new Map();
    const handlers = new Map();
    const tools = new Map();
    const state = new Map();
    const writes = [];
    const sentUserMessages = [];
    const sentMessages = [];
    const notifications = [];

    if (persistedState !== undefined) state.set(AcmSessionStateKey, persistedState);

    const sessionManager = providedSessionManager ?? {
        getSessionState: (key) => structuredClone(state.get(key)),
        setSessionState: (key, value) => {
            if (value === undefined) state.delete(key);
            else state.set(key, structuredClone(value));
        },
        getEntries: () => entries,
        getLeafId: () => "deadbeef",
    };
    const commandContext = {
        sessionManager,
        ui: {
            notify: (message, level) => notifications.push({ message, level }),
        },
    };

    const pi = {
        getSessionState: (key) => sessionManager.getSessionState(key),
        setSessionState: (key, value) => {
            writes.push({ key, value: structuredClone(value) });
            sessionManager.setSessionState(key, value);
        },
        registerCommand: (name, command) => commands.set(name, command),
        registerTool: (tool) => tools.set(tool.name, tool),
        on: (event, handler) => {
            const eventHandlers = handlers.get(event) ?? [];
            eventHandlers.push(handler);
            handlers.set(event, eventHandlers);
        },
        sendUserMessage: (message, options) => {
            sentUserMessages.push({ message, options });
            const [, name, args = ""] = /^\/([^ ]+)(?: (.*))?$/.exec(message) ?? [];
            const command = commands.get(name);
            if (command) void command.handler(args, commandContext);
        },
        sendMessage: (message, options) => sentMessages.push({ message, options }),
        setLabel: () => {},
    };

    registerPiContext(pi);

    return {
        commands,
        handlers,
        tools,
        state,
        writes,
        sentUserMessages,
        sentMessages,
        notifications,
        sessionManager,
        commandContext,
        async emit(event, payload, ctx = commandContext) {
            let result;
            for (const handler of handlers.get(event) ?? []) {
                result = await handler(payload, ctx);
            }
            return result;
        },
    };
}

test("parses the one-field TOML configuration", () => {
    assert.deepEqual(parseAcmConfig("auto_enable = true\n"), { autoEnable: true });
    assert.deepEqual(parseAcmConfig("# comment\nauto_enable=false # comment\n"), { autoEnable: false });
    assert.deepEqual(parseAcmConfig(""), { autoEnable: false });
    assert.throws(() => parseAcmConfig("auto_enable = yes"), /expected 'auto_enable/);
    assert.throws(() => parseAcmConfig("auto_enable = true\nauto_enable = false"), /duplicate/);
    assert.throws(() => parseAcmConfig("other = true"), /expected 'auto_enable/);
});

test("maps /acm arguments to explicit state transitions", () => {
    assert.equal(resolveAcmAction("", false), "enable");
    assert.equal(resolveAcmAction("", true), "disable");
    assert.equal(resolveAcmAction(" ENABLE ", false), "enable");
    assert.equal(resolveAcmAction("disable", true), "disable");
    assert.equal(resolveAcmAction("status", true), undefined);
});

test("distinguishes new lifecycle starts from resumed conversations", () => {
    assert.equal(isNewSessionStart("new", [{ type: "message" }]), true);
    assert.equal(isNewSessionStart("startup", []), true);
    assert.equal(isNewSessionStart("startup", [{ type: "session_info" }]), true);
    assert.equal(isNewSessionStart("startup", [{ type: "custom_message" }]), true);
    assert.equal(isNewSessionStart("startup", [{ type: "message" }]), false);
    assert.equal(isNewSessionStart("resume", []), false);
    assert.equal(isNewSessionStart("fork", []), false);
});

test("validates persisted ACM state and wraps model-only projections", () => {
    assert.equal(readAcmEnabled(undefined), undefined);
    assert.equal(readAcmEnabled({ enabled: true }), true);
    assert.throws(() => readAcmEnabled({ enabled: "yes" }), /enabled must be boolean/);
    assert.equal(readAcmNotificationPending(undefined), false);
    assert.equal(readAcmNotificationPending({ enabled: true }), false);
    assert.equal(readAcmNotificationPending({ enabled: true, notificationPending: true }), true);
    assert.throws(
        () => readAcmNotificationPending({ enabled: true, notificationPending: "yes" }),
        /notificationPending must be boolean/,
    );
    assert.equal(
        wrapSystemNotification("state"),
        "<system-notification>\nstate\n</system-notification>",
    );

    const message = createAcmContextMessage(false);
    assert.equal(message.role, "custom");
    assert.equal(message.customType, AcmContextMessageType);
    assert.match(message.content, /^<system-notification>\n/);
    assert.match(message.content, /disabled/);
    assert.doesNotMatch(message.content, /manually/);
    assert.match(createAcmContextMessage(true, true).content, /manually enabled/);
    assert.match(message.content, /\n<\/system-notification>$/);
    assert.equal(message.display, false);
});

test("auto-enables only a new session without dispatching commands at startup", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "pi-context-config-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    writeFileSync(join(configDir, "pi-context.toml"), "auto_enable = true\n");
    process.env.PI_CODING_AGENT_DIR = configDir;

    try {
        const harness = createHarness();
        await harness.emit("session_start", { reason: "startup" });

        assert.deepEqual(harness.writes, [{ key: AcmSessionStateKey, value: { enabled: true } }]);
        // The command context is acquired lazily by context_compact, never at startup.
        assert.deepEqual(harness.sentUserMessages, []);
        const context = await harness.emit("context", { messages: [] });
        assert.deepEqual(context.messages, []);
    } finally {
        if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
        rmSync(configDir, { recursive: true, force: true });
    }
});

test("uses pi-core session-global state without creating conversation entries", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "pi-context-core-config-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    writeFileSync(join(configDir, "pi-context.toml"), "auto_enable = true\n");
    process.env.PI_CODING_AGENT_DIR = configDir;

    try {
        const sessionManager = SessionManager.inMemory("/tmp/pi-context-core-integration");
        const harness = createHarness({ sessionManager });
        await harness.emit("session_start", { reason: "new" });

        assert.deepEqual(sessionManager.getSessionState(AcmSessionStateKey), { enabled: true });
        assert.equal(sessionManager.getEntries().some((entry) => entry.type === "session_state"), false);
        assert.equal(JSON.stringify(sessionManager.getTree()).includes("session_state"), false);

        await harness.commands.get("acm").handler("disable", harness.commandContext);
        assert.deepEqual(sessionManager.getSessionState(AcmSessionStateKey), {
            enabled: false,
            notificationPending: true,
        });
    } finally {
        if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
        rmSync(configDir, { recursive: true, force: true });
    }
});

test("restores enabled and disabled sessions without applying auto-enable again", async () => {
    const enabled = createHarness({ persistedState: { enabled: true }, entries: [{ type: "message" }] });
    await enabled.emit("session_start", { reason: "resume" });
    assert.equal(enabled.writes.length, 0);
    assert.equal(enabled.sentUserMessages.length, 0);
    const resumedUserMessage = { role: "user", content: "continue", timestamp: 1 };
    const resumedContext = await enabled.emit("context", { messages: [resumedUserMessage] });
    assert.deepEqual(resumedContext.messages, [resumedUserMessage]);

    const disabled = createHarness({ persistedState: { enabled: false }, entries: [{ type: "message" }] });
    await disabled.emit("session_start", { reason: "resume" });
    assert.equal(disabled.writes.length, 0);
    assert.equal(disabled.sentUserMessages.length, 0);

    for (const name of ["context_checkpoint", "context_timeline", "context_compact"]) {
        const result = await disabled.tools.get(name).execute("tool-call", {}, undefined, undefined, {});
        assert.match(result.content[0].text, /disabled/);
    }
});

test("preserves an unconsumed state notification across reload", async () => {
    const source = createHarness({ persistedState: { enabled: false }, entries: [{ type: "message" }] });
    await source.emit("session_start", { reason: "resume" });
    await source.commands.get("acm").handler("enable", source.commandContext);

    const reloaded = createHarness({
        persistedState: source.state.get(AcmSessionStateKey),
        entries: [{ type: "message" }],
    });
    await reloaded.emit("session_start", { reason: "reload" });
    const userMessage = { role: "user", content: "continue", timestamp: 1 };
    const firstCall = await reloaded.emit("context", { messages: [userMessage] });

    assert.equal(firstCall.messages[0].customType, AcmContextMessageType);
    assert.match(firstCall.messages[0].content, /manually enabled/);
    assert.deepEqual(firstCall.messages[1], userMessage);
    assert.deepEqual(reloaded.state.get(AcmSessionStateKey), { enabled: true });

    const secondCall = await reloaded.emit("context", { messages: [userMessage] });
    assert.deepEqual(secondCall.messages, [userMessage]);
});

test("initializes a legacy resumed session as disabled rather than applying config", async () => {
    const harness = createHarness({ entries: [{ type: "message" }] });
    await harness.emit("session_start", { reason: "startup" });

    assert.deepEqual(harness.writes, [{ key: AcmSessionStateKey, value: { enabled: false } }]);
    assert.equal(harness.sentUserMessages.length, 0);
});

test("/acm toggles or sets state without redundant durable writes", async () => {
    const harness = createHarness({ persistedState: { enabled: false }, entries: [{ type: "message" }] });
    await harness.emit("session_start", { reason: "resume" });
    const acm = harness.commands.get("acm");

    await acm.handler("", harness.commandContext);
    await acm.handler("enable", harness.commandContext);
    await acm.handler("", harness.commandContext);
    await acm.handler("disable", harness.commandContext);
    await acm.handler("invalid", harness.commandContext);

    assert.deepEqual(harness.writes, [
        { key: AcmSessionStateKey, value: { enabled: true, notificationPending: true } },
        { key: AcmSessionStateKey, value: { enabled: false, notificationPending: true } },
    ]);
    assert.match(harness.notifications.at(-1).message, /Usage/);
});

test("reports an effective state change once before the latest user message", async () => {
    const harness = createHarness({ persistedState: { enabled: false }, entries: [{ type: "message" }] });
    await harness.emit("session_start", { reason: "resume" });
    const acm = harness.commands.get("acm");
    const olderUserMessage = { role: "user", content: "earlier", timestamp: 1 };
    const assistantMessage = { role: "assistant", content: [], timestamp: 2 };
    const currentUserMessage = { role: "user", content: "continue", timestamp: 3 };
    const ordinaryMessages = [olderUserMessage, assistantMessage, currentUserMessage];

    await acm.handler("enable", harness.commandContext);
    const changed = await harness.emit("context", { messages: ordinaryMessages });
    assert.deepEqual(changed.messages.slice(0, 2), [olderUserMessage, assistantMessage]);
    assert.equal(changed.messages[2].customType, AcmContextMessageType);
    assert.match(changed.messages[2].content, /manually enabled/);
    assert.match(changed.messages[2].content, /^<system-notification>\n/);
    assert.deepEqual(changed.messages[3], currentUserMessage);

    // Consuming the pending transition prevents repeats within the same agent run.
    const laterModelCall = await harness.emit("context", { messages: ordinaryMessages });
    assert.deepEqual(laterModelCall.messages, ordinaryMessages);

    // An idempotent command does not create another notification.
    await acm.handler("enable", harness.commandContext);
    const redundantCommand = await harness.emit("context", { messages: ordinaryMessages });
    assert.deepEqual(redundantCommand.messages, ordinaryMessages);
});

test("model context contains only the final effective ACM state", async () => {
    const harness = createHarness({ persistedState: { enabled: false }, entries: [{ type: "message" }] });
    await harness.emit("session_start", { reason: "resume" });
    const acm = harness.commands.get("acm");

    await acm.handler("enable", harness.commandContext);
    await acm.handler("disable", harness.commandContext);
    await acm.handler("enable", harness.commandContext);

    const priorProjection = createAcmContextMessage(false);
    const ordinaryMessage = { role: "user", content: "continue", timestamp: 1 };
    const result = await harness.emit("context", { messages: [priorProjection, ordinaryMessage] });
    const projections = result.messages.filter(
        (message) => message.role === "custom" && message.customType === AcmContextMessageType,
    );

    assert.equal(projections.length, 1);
    assert.match(projections[0].content, /manually enabled/);
    assert.deepEqual(result.messages, [projections[0], ordinaryMessage]);

    // The projection is consumed by the first model call, even before agent_end.
    const nextResult = await harness.emit("context", { messages: [ordinaryMessage] });
    assert.deepEqual(nextResult.messages, [ordinaryMessage]);
});
