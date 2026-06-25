# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-25

## OVERVIEW
Project: **pi-context**
Stack: Node.js, TypeScript (ES2022 / Node16), `@earendil-works/pi-coding-agent` API, `@earendil-works/pi-ai` Type/type schemas.

Description: An Agentic Context Management extension for the `pi` coding agent. It allows AI agents to proactively structure, inspect, and clean up conversation history using explicit checkpoints, timeline inspection, and checkpoint-based compaction.

## STRUCTURE
*   `src/`: TypeScript source code for the extension.
    *   `index.ts`: Tool and command registrations (`acm`, `context_checkpoint`, `context_timeline`, `context_compact`).
    *   `context.ts`: CLI command registrations (e.g., `/context` for TUI visualization).
    *   `utils.ts`: Shared utility functions and type definitions.
*   `skills/`: Pi skills documentation, containing `context-management/SKILL.md` which instructs the LLM on how to use the context tools.
*   `test/`: Markdown test scenarios.

## COMMANDS
| Action | Command |
|--------|---------|
| Install| `npm install` |
| Typecheck | `npm run typecheck` |
| Test   | See `test/test.md` |
| Run    | The extension is loaded natively by `pi`. In a `pi` environment, run `pi -e ./src/index.ts -e ./src/context.ts --skill ./skills` to test locally. |

## CODING STANDARDS
*   **Language**: TypeScript with ESM (`"type": "module"`).
*   **Style**: Standard TypeScript. Interfaces and functions are exported as ES modules. Tool parameter schemas use `Type` from `@earendil-works/pi-ai`.
*   **Rules**: Strict mode is enabled (`"strict": true`). Missing SDK types may be defined locally near their usage (e.g., `SessionTreeNode` in `src/index.ts`).

## WHERE TO LOOK
*   **Source**: `src/`
*   **Tests**: `test/`
*   **Skill Docs**: `skills/context-management/SKILL.md` (Crucial for understanding the agent workflow, checkpointing strategy, timeline review, and checkpoint-based compaction).
*   **Scenario References**: `skills/context-management/references/` contains focused guidance for research, development/debugging, planning, repeated-item work, task switching, and retry/pivot workflows.

## NOTES
*   **Architecture**: `pi-context` hooks directly into the `SessionManager` from the `pi-coding-agent` SDK, leveraging its underlying tree structure to implement lossless time travel and conversation-history compaction without deleting nodes from disk.
*   **Runtime**: The package is source-first. Pi loads the TypeScript extension files declared in `pi.extensions` (`src/index.ts`, `src/context.ts`); no `dist/` build artifact is required for publishing.
*   **ACM Enablement**: `/acm` stores an `ExtensionCommandContext` required for `context_compact` navigation. `context_checkpoint` can label history directly, but `context_compact` needs command-context navigation support.
*   **Compact Semantics**: `context_compact` intentionally interrupts the current agent loop, creates a summarized branch via `SessionManager.branchWithSummary`, navigates to it, then triggers a fresh continuation. Treat compact as a phase-boundary operation, not mid-thought cleanup. Because returning to a backup checkpoint is possible but costly, compact summaries must preserve the compressed working set for the next phase: result, evidence/source anchors, decisions, important changes, open questions, recovery pointer, and next step when relevant.
*   **Skill Authoring**: Keep skill examples generic and reusable. Do not embed task-specific business data, private session details, concrete IDs, or one-off customer/project examples in `skills/context-management/**`.
*   **Prompting Principle**: The desired agent behavior is checkpoint before noisy work, timeline when orientation matters, then compact only when a stable result/lesson exists and another phase or task will benefit from a clean summary. Preserve proportionality: checkpoint-only for mild/start states, timeline-first for disorientation, compact for compactable completed phases. Avoid encouraging automatic compact after final answers.
*   **Test Script Issues**: `test/test.md` outlines the testing steps.
