import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { wrapSystemNotification } from "./utils.js";

/** Durable session-global state owned by pi-context. */
export type AcmSessionState = {
    enabled: boolean;
    notificationPending?: boolean;
};

/** User configuration that initializes ACM for new sessions. */
export interface AcmConfig {
    autoEnable: boolean;
}

/** Supported state transitions accepted by the `/acm` command. */
export type AcmAction = "enable" | "disable";

/** Session-global namespace key for pi-context's effective ACM state. */
export const AcmSessionStateKey = "pi-context.acm";

/** Custom message type used for the model-only effective-state projection. */
export const AcmContextMessageType = "pi-context-acm-state";

/** Backward-compatible behavior when no pi-context config exists. */
const DefaultAcmConfig: AcmConfig = { autoEnable: false };

/** A durable conversation message proves that ambiguous CLI startup resumed history. */
const ConversationEntryType: SessionEntry["type"] = "message";

/** Resolve the pi-context config path, honoring pi's agent-directory override. */
export function getAcmConfigPath(): string {
    const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
    return join(agentDir, "pi-context.toml");
}

/** Parse pi-context's intentionally small TOML configuration surface. */
export function parseAcmConfig(source: string, path = "pi-context.toml"): AcmConfig {
    let autoEnable: boolean | undefined;

    // Accept only the documented boolean field so misspellings fail visibly.
    for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
        const line = rawLine.replace(/#.*$/, "").trim();
        if (!line) continue;

        const match = /^auto_enable\s*=\s*(true|false)$/.exec(line);
        if (!match) {
            throw new Error(`${path}:${index + 1}: expected 'auto_enable = true' or 'auto_enable = false'`);
        }
        if (autoEnable !== undefined) {
            throw new Error(`${path}:${index + 1}: duplicate auto_enable field`);
        }
        autoEnable = match[1] === "true";
    }

    return { autoEnable: autoEnable ?? DefaultAcmConfig.autoEnable };
}

/** Load pi-context configuration, defaulting to manual enablement when absent. */
export function loadAcmConfig(path = getAcmConfigPath()): AcmConfig {
    try {
        return parseAcmConfig(readFileSync(path, "utf8"), path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return { ...DefaultAcmConfig };
        }
        throw error;
    }
}

/** Map command arguments to an explicit transition; an empty command toggles. */
export function resolveAcmAction(args: string, enabled: boolean): AcmAction | undefined {
    const action = args.trim().toLowerCase();
    if (!action) return enabled ? "disable" : "enable";
    if (action === "enable" || action === "disable") return action;
    return undefined;
}

/** Detect a new-session lifecycle without treating resumed conversations as new. */
export function isNewSessionStart(reason: string, entries: readonly SessionEntry[]): boolean {
    if (reason === "new") return true;
    if (reason !== "startup") return false;

    // Initial CLI startup does not distinguish create from resume; conversation
    // records are the durable evidence that an uninitialized session was resumed.
    return !entries.some((entry) => entry.type === ConversationEntryType);
}

/** Validate persisted state before it controls extension behavior. */
export function readAcmEnabled(state: AcmSessionState | undefined): boolean | undefined {
    if (state === undefined) return undefined;
    if (typeof state.enabled !== "boolean") {
        throw new Error(`Invalid ${AcmSessionStateKey} session state: enabled must be boolean`);
    }
    return state.enabled;
}

/** Read whether a state transition still needs its one-shot model notification. */
export function readAcmNotificationPending(state: AcmSessionState | undefined): boolean {
    if (state?.notificationPending === undefined) return false;
    if (typeof state.notificationPending !== "boolean") {
        throw new Error(`Invalid ${AcmSessionStateKey} session state: notificationPending must be boolean`);
    }
    return state.notificationPending;
}

/** Build the wrapped ACM state notification shown after an effective transition. */
export function createAcmContextMessage(enabled: boolean, manuallySet = false) {
    const state = enabled ? "enabled" : "disabled";
    const policy = enabled
        ? "Use context_checkpoint, context_timeline, and context_compact according to the context-management skill."
        : "Do not call context_checkpoint, context_timeline, or context_compact unless the user enables it with /acm.";
    const source = manuallySet ? `The user manually ${state} it with /acm. ` : "";

    return {
        role: "custom" as const,
        customType: AcmContextMessageType,
        content: wrapSystemNotification(
            `Agentic context management is ${state} for this session. ${source}${policy}`,
        ),
        display: false,
        timestamp: Date.now(),
    };
}
