import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerContext from "../src/index.js";

/** Record real command-context acquisitions without replacing command context or compaction. */
export default function registerLiveCommandContextProbe(pi: ExtensionAPI) {
    const probe = new Proxy(pi, {
        get(target, property, receiver) {
            if (property !== "registerCommand") return Reflect.get(target, property, receiver);
            return (name: string, options: Parameters<ExtensionAPI["registerCommand"]>[1]) => {
                target.registerCommand(name, {
                    ...options,
                    handler: async (args, ctx) => {
                        if (name === "pi-context-acquire-command-context") {
                            target.appendEntry("live-command-context-acquired", { args });
                        }
                        return options.handler(args, ctx);
                    },
                });
            };
        },
    });
    registerContext(probe);

    // Flush real contextual content after turn_end, before agent_end. The old
    // guard took its snapshot too late and silently discarded this message.
    if (process.env.PI_CONTEXT_TEST_ADVANCE === "1") {
        let injected = false;
        pi.on("turn_end", (event) => {
            if (injected || !event.message.content.some((block) =>
                block.type === "toolCall" && block.name === "context_compact")) return;
            injected = true;
            pi.sendMessage({
                customType: "live-guard-canary",
                content: "New information arrived after the compact request. Do not retry compact. Next step: reply exactly LIVE_GUARD_OK without tools.",
                display: false,
            }, { triggerTurn: false });
        });
    }
}
