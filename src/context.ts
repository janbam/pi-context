import {
  type ExtensionAPI,
  DynamicBorder,
  estimateTokens,
} from "@earendil-works/pi-coding-agent";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { Container, Text, Spacer } from "@earendil-works/pi-tui";
import { formatTokens } from "./utils.js";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("context", {
    description: "Show context usage visualization",
    handler: async (args, ctx) => {
      const usage = await ctx.getContextUsage();
      if (!usage) {
        ctx.ui.notify("Context usage info not available.", "warning");
        return;
      }

      // Count the session projection, i.e. the messages the model actually receives: it already
      // applies native compaction, context_edit, summaries, and custom messages, and carries the
      // prompt and tool loadout as system messages.
      const messages = ctx.sessionManager.buildSessionProjection().messages;

      // Replay system deltas into the current prompt and tools once: replaced sections and
      // removed tools must not count, and prompt text and tool declarations are separate categories.
      const { toolsAdded: currentTools, ...currentPrompt } = getCurrentSystemMessage(messages) ?? { role: "system", content: "", timestamp: 0 };
      const systemTokensRaw = estimateTokens(currentPrompt);
      const toolDefTokensRaw = currentTools ? Math.ceil(JSON.stringify(currentTools).length / 4) : 0;
      let msgTokensRaw = 0;
      let toolUseTokensRaw = 0;
      let toolResultTokensRaw = 0;

      for (const m of messages) {
        if (m.role === "system") {
          continue;
        } else if (m.role === "assistant") {
          // Tool calls count as tool traffic; text and thinking stay conversation.
          toolUseTokensRaw += estimateTokens({ ...m, content: m.content.filter((p) => p.type === "toolCall") });
          msgTokensRaw += estimateTokens({ ...m, content: m.content.filter((p) => p.type !== "toolCall") });
        } else if (m.role === "toolResult") {
          toolResultTokensRaw += estimateTokens(m);
        } else if (m.role === "bashExecution") {
          toolUseTokensRaw += estimateTokens(m);
        } else {
          msgTokensRaw += estimateTokens(m);
        }
      }
      const totalActual = usage.tokens;
      const limit = usage.contextWindow;
      const usagePercent = usage.percent;

      if (totalActual == null || limit == null || usagePercent == null) {
        ctx.ui.notify("Context usage info not available.", "warning");
        return;
      }

      const totalRaw = systemTokensRaw + toolDefTokensRaw + msgTokensRaw + toolUseTokensRaw + toolResultTokensRaw;
      const ratio = totalRaw > 0 ? (totalActual / totalRaw) : 1;

      const systemTokens = Math.round(systemTokensRaw * ratio);
      const toolDefTokens = Math.round(toolDefTokensRaw * ratio);
      const msgTokens = Math.round(msgTokensRaw * ratio);
      const toolUseTokens = Math.round(toolUseTokensRaw * ratio);
      const toolResultTokens = Math.round(toolResultTokensRaw * ratio);

      await ctx.ui.custom((tui, theme, kb, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
        container.addChild(new Text(theme.fg("accent", theme.bold(" Context Usage")), 1, 0));
        container.addChild(new Spacer(1));

        // Grouped by function and color
        const categories = [
          { label: "System Prompt", value: systemTokens, color: "muted" },
          { label: "System Tools", value: toolDefTokens, color: "dim" },
          { label: "Tool Call", value: toolUseTokens + toolResultTokens, color: "success" },
          { label: "Messages", value: msgTokens, color: "accent" },
        ];

        const otherTokens = Math.max(0, totalActual - (systemTokens + toolDefTokens + msgTokens + toolUseTokens + toolResultTokens));
        if (otherTokens > 10) categories.push({ label: "Other", value: otherTokens, color: "dim" });

        categories.push({ label: "Available", value: Math.max(0, limit - totalActual), color: "borderMuted" });

        const gridWidth = 10;
        const gridHeight = 5;
        const totalBlocks = gridWidth * gridHeight;

        const blocks: { color: string, filled: boolean }[] = [];
        categories.forEach((cat) => {
          if (cat.label === "Available") return;
          let count = Math.round((cat.value / limit) * totalBlocks);
          if (count === 0 && cat.value > 0) count = 1;
          for (let i = 0; i < count && blocks.length < totalBlocks; i++) {
            blocks.push({ color: cat.color, filled: true });
          }
        });

        while (blocks.length < totalBlocks) {
          blocks.push({ color: "borderMuted", filled: false });
        }

        const gridLines: string[] = [];
        for (let r = 0; r < gridHeight; r++) {
          let rowStr = "";
          for (let c = 0; c < gridWidth; c++) {
            const b = blocks[r * gridWidth + c];
            rowStr += theme.fg(b.color as any, b.filled ? "■ " : "□ ");
          }
          gridLines.push(rowStr.trimEnd());
        }

        const totalUsageTitle = `${theme.fg("text", theme.bold("Total Usage".padEnd(16)))} ${theme.fg("text", theme.bold(formatTokens(totalActual).padStart(7)))} ${theme.fg("text", theme.bold(`(${usagePercent.toFixed(1).padStart(5)}%)`))}`;

        const catDetailLines = categories.map(cat => {
          const labelStr = cat.label.padEnd(14);
          const valStr = formatTokens(cat.value).padStart(7);
          const rowPercent = ((cat.value / limit) * 100).toFixed(1).padStart(5);
          const icon = cat.label === "Available" ? "□" : "■";
          return `${theme.fg(cat.color as any, icon)} ${theme.fg("text", labelStr)} ${theme.fg("accent", valStr)} (${rowPercent}%)`;
        });

        const allDetailLines = [totalUsageTitle, "", ...catDetailLines];

        const leftSideWidth = 20;
        const maxH = Math.max(gridLines.length, allDetailLines.length);
        for (let i = 0; i < maxH; i++) {
          const left = (gridLines[i] || "").padEnd(leftSideWidth);
          const right = allDetailLines[i] || "";
          container.addChild(new Text(`    ${left}      ${right}`, 1, 0));
        }

        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("dim", " Press any key to close"), 1, 0));
        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

        return {
          render: (w) => container.render(w),
          invalidate: () => container.invalidate(),
          handleInput: (data) => done(undefined),
        };
      }, { overlay: true });
    }
  });
}
