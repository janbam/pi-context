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
        assert.match(text, /\[Context Dashboard\]/);
        assert.match(text, /Context Usage:/);
        assert.ok(text.includes(`Segment Size:     ${checkpoint ? 1 : 2} steps since last checkpoint '${checkpoint ?? "None"}'`));
        assert.match(text, /aaaaaaaa.*ROOT.*Review the patch/);
        assert.match(text, /bbbbbbbb.*HEAD.*Tests passed/);
        assert.doesNotMatch(text, /compact/i);
        assert.equal(text.split("\n").filter((line) => line.startsWith("• ")).length, 3);
    });
}
