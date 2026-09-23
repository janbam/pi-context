import assert from "node:assert/strict";
import test from "node:test";

import registerContextDashboard from "../dist/context.js";

/** Render `/context` for a session projection and return the overlay's plain-text lines. */
async function renderDashboard(messages, tokens) {
    const commands = new Map();
    registerContextDashboard({ registerCommand: (name, command) => commands.set(name, command) });
    let lines = [];
    await commands.get("context").handler("", {
        // Only the projection is a valid source; live prompt getters must not be consulted.
        sessionManager: { buildSessionProjection: () => ({ messages }) },
        getContextUsage: () => ({ tokens, contextWindow: 10_000, percent: tokens / 100 }),
        ui: {
            notify: (message) => assert.fail(message),
            custom: async (factory) => {
                const theme = { fg: (_color, text) => text, bold: (text) => text };
                lines = factory({}, theme, {}, () => {}).render(120);
            },
        },
    });
    return lines.join("\n");
}

test("/context counts prompt, tools, and messages from the model's session projection", async () => {
    const tool = { name: "read", description: "x".repeat(380), parameters: {} };
    const messages = [
        { role: "system", content: "", sections: { preamble: "p".repeat(400) }, toolsAdded: [tool], timestamp: 0 },
        { role: "user", content: "u".repeat(400), timestamp: 1 },
        { role: "assistant", content: [
            { type: "text", text: "a".repeat(400) },
            { type: "toolCall", id: "c", name: "read", arguments: { path: "f".repeat(385) } }, // "read" + {"path":"…"} = 400 chars
        ], timestamp: 2 },
        { role: "toolResult", toolCallId: "c", toolName: "read", content: [{ type: "text", text: "r".repeat(400) }], timestamp: 3 },
    ];
    const toolTokens = Math.ceil(JSON.stringify([tool]).length / 4);
    // Usage equals the raw estimate, so the scaling ratio is 1 and categories show raw counts.
    const text = await renderDashboard(messages, 100 + toolTokens + 200 + 200);

    assert.match(text, /System Prompt\s+100 /);
    assert.match(text, new RegExp(`System Tools\\s+${toolTokens} `));
    // Tool call arguments and tool results together; assistant text and user text as messages.
    assert.match(text, /Tool Call\s+200 /);
    assert.match(text, /Messages\s+200 /);
});

test("/context counts the replayed prompt once, not every system delta", async () => {
    const tool = { name: "read", description: "x".repeat(380), parameters: {} };
    const messages = [
        { role: "system", content: "", sections: { preamble: "p".repeat(800) }, toolsAdded: [tool], timestamp: 0 },
        { role: "user", content: "u".repeat(400), timestamp: 1 },
        // A later delta replaces the section and removes the only tool.
        { role: "system", content: "", sections: { preamble: "q".repeat(400) }, toolsRemoved: [tool], timestamp: 2 },
    ];
    const text = await renderDashboard(messages, 200);

    assert.match(text, /System Prompt\s+100 /);
    assert.match(text, /System Tools\s+0 /);
    assert.match(text, /Messages\s+100 /);
});
