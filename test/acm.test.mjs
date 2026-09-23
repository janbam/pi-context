import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import registerPiContext from "../dist/index.js";
import {
    AcmPromptSectionName,
    AcmPromptSectionText,
    AcmSessionStateKey,
    applyAcmToolLoadout,
    isNewSessionStart,
    parseAcmConfig,
    readAcmEnabled,
    resolveAcmAction,
} from "../dist/acm.js";
import { ContextToolNames } from "../dist/utils.js";

/** Pi activates every registered extension tool when it builds a fresh runtime. */
const InitialActiveTools = ["read", "bash", ...ContextToolNames];

/**
 * @param registry Tool names pi's registry holds; like pi, setActiveTools silently drops others
 *   (models --tools/--exclude-tools filtering).
 */
function createHarness({
    persistedState,
    entries = [],
    sessionManager: providedSessionManager,
    registry = InitialActiveTools,
} = {}) {
    const commands = new Map();
    const handlers = new Map();
    const tools = new Map();
    const state = new Map();
    const writes = [];
    const toolWrites = [];
    let activeTools = InitialActiveTools.filter((name) => registry.includes(name));
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
        getActiveTools: () => [...activeTools],
        setActiveTools: (names) => {
            toolWrites.push([...names]);
            activeTools = names.filter((name) => registry.includes(name));
        },
    };

    registerPiContext(pi);

    return {
        commands,
        handlers,
        tools,
        state,
        writes,
        toolWrites,
        get activeTools() { return activeTools; },
        /** Simulate tree navigation restoring an older transcript-recorded loadout. */
        restoreTools(names) { activeTools = [...names]; },
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
        /** Run before_agent_start on fresh base options, as pi does per real prompt. */
        async promptSections() {
            const event = { systemPromptOptions: { sections: {} } };
            await this.emit("before_agent_start", event);
            return event.systemPromptOptions.sections;
        },
    };
}

const hasContextTools = (names) => ContextToolNames.every((name) => names.includes(name));
const hasNoContextTools = (names) => ContextToolNames.every((name) => !names.includes(name));

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

test("validates persisted ACM state", () => {
    assert.equal(readAcmEnabled(undefined), undefined);
    assert.equal(readAcmEnabled({ enabled: true }), true);
    assert.throws(() => readAcmEnabled({ enabled: "yes" }), /enabled must be boolean/);
});

test("tool loadout gains or loses only pi-context tools and keeps other tools in order", () => {
    const withContextMidList = ["read", "context_timeline", "bash"];
    assert.deepEqual(
        applyAcmToolLoadout(withContextMidList, true),
        ["read", "context_timeline", "bash", "context_checkpoint", "context_compact"],
    );
    assert.deepEqual(applyAcmToolLoadout(withContextMidList, false), ["read", "bash"]);
    // Already-matching loadouts come back unchanged, so no setActiveTools write is needed.
    assert.deepEqual(applyAcmToolLoadout(InitialActiveTools, true), InitialActiveTools);
    assert.deepEqual(applyAcmToolLoadout(["read"], false), ["read"]);
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
        // Tools were already active from pi's initial loadout; enabling adds only the section.
        assert.deepEqual(harness.toolWrites, []);
        assert.deepEqual(await harness.promptSections(), { [AcmPromptSectionName]: AcmPromptSectionText });
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
        assert.deepEqual(sessionManager.getSessionState(AcmSessionStateKey), { enabled: false });
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
    assert.deepEqual(enabled.toolWrites, []);
    assert.deepEqual(await enabled.promptSections(), { [AcmPromptSectionName]: AcmPromptSectionText });

    const disabled = createHarness({ persistedState: { enabled: false }, entries: [{ type: "message" }] });
    await disabled.emit("session_start", { reason: "resume" });
    assert.equal(disabled.writes.length, 0);
    assert.equal(disabled.sentUserMessages.length, 0);
    // Disabled sessions expose neither the tools nor the section to the model.
    assert.deepEqual(disabled.activeTools, ["read", "bash"]);
    assert.deepEqual(await disabled.promptSections(), {});
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
        { key: AcmSessionStateKey, value: { enabled: true } },
        { key: AcmSessionStateKey, value: { enabled: false } },
    ]);
    // One loadout write at session start (disable) plus one per effective transition.
    assert.equal(harness.toolWrites.length, 3);
    assert.match(harness.notifications.at(-1).message, /Usage/);
});

test("/acm swaps tools and the prompt section; enabled runs repeat identical section text", async () => {
    const harness = createHarness({ persistedState: { enabled: false }, entries: [{ type: "message" }] });
    await harness.emit("session_start", { reason: "resume" });
    const acm = harness.commands.get("acm");

    await acm.handler("enable", harness.commandContext);
    assert.ok(hasContextTools(harness.activeTools));
    // Byte-identical text on every run means no transcript delta and no cache miss.
    const first = await harness.promptSections();
    const second = await harness.promptSections();
    assert.deepEqual(first, { [AcmPromptSectionName]: AcmPromptSectionText });
    assert.equal(second[AcmPromptSectionName], first[AcmPromptSectionName]);

    await acm.handler("disable", harness.commandContext);
    assert.ok(hasNoContextTools(harness.activeTools));
    assert.deepEqual(await harness.promptSections(), {});
});

test("enabled ACM omits the prompt section when a tool allowlist filtered the context tools out", async () => {
    const harness = createHarness({
        persistedState: { enabled: true },
        entries: [{ type: "message" }],
        registry: ["read", "bash"],
    });
    await harness.emit("session_start", { reason: "resume" });
    // The section must not point the model at tools it cannot call.
    assert.deepEqual(harness.activeTools, ["read", "bash"]);
    assert.deepEqual(await harness.promptSections(), {});
});

test("tree navigation re-adds context tools that an older transcript loadout lacks", async () => {
    const harness = createHarness({ persistedState: { enabled: false }, entries: [{ type: "message" }] });
    await harness.emit("session_start", { reason: "resume" });
    await harness.commands.get("acm").handler("enable", harness.commandContext);

    // Compacting to an anchor recorded before /acm enable restores its tool-less loadout.
    harness.restoreTools(["read", "bash"]);
    await harness.emit("session_tree", {});
    assert.ok(hasContextTools(harness.activeTools));

    // Navigation whose loadout already matches writes nothing.
    const writes = harness.toolWrites.length;
    await harness.emit("session_tree", {});
    assert.equal(harness.toolWrites.length, writes);
});
