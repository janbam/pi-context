import assert from "node:assert/strict";
import test from "node:test";

import registerContext from "../dist/index.js";

for (const checkpoint of [undefined, "review-start"]) {
    test(`timeline reports structure without compact advice (${checkpoint ?? "no checkpoint"})`, async () => {
        const tools = new Map();
        registerContext({
            registerTool: (tool) => tools.set(tool.name, tool),
            registerCommand: () => {},
            on: () => {},
        });
        const entries = [
            { id: "aaaaaaaa", type: "message", message: { role: "user", content: "Review the patch" } },
            { id: "bbbbbbbb", type: "message", message: { role: "assistant", content: [{ type: "text", text: "Tests passed" }] } },
        ];
        const result = await tools.get("context_timeline").execute("timeline", {}, undefined, undefined, {
            sessionManager: {
                getBranch: () => entries,
                getLeafId: () => "bbbbbbbb",
                getChildren: () => [],
                getLabel: (id) => id === "aaaaaaaa" ? checkpoint : undefined,
            },
            getContextUsage: () => undefined,
        });
        const text = result.content[0].text;
        assert.match(text, /^Context: Unknown$/m);
        assert.match(text, /aaaaaaaa.*ROOT.*Review the patch/);
        assert.match(text, /bbbbbbbb.*HEAD.*Tests passed/);
        if (checkpoint) assert.match(text, /aaaaaaaa.*checkpoint: review-start.*phase: start/);
        assert.doesNotMatch(text, /compact/i);
    });
}
