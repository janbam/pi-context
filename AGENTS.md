# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-20

## OVERVIEW
Project: **pi-context** (v2.2.0)
Stack: TypeScript (ES2022 / Node16, strict, ESM), `@earendil-works/pi-coding-agent` from the linked pi-mono fork (session-global state APIs; see Fork-only development), `@earendil-works/pi-ai` Type schemas, `@earendil-works/pi-tui` for the dashboard. Plain Node 20+ `.mjs` for dev tooling and tests (no extra deps).

An Agentic Context Management extension for the `pi` coding agent. It lets agents structure, inspect, and clean up conversation history via named checkpoints, a structural timeline view, and checkpoint-based compaction — lossless time travel over Pi's session tree.

## STRUCTURE
*   `src/index.ts`: Extension entry. Registers the `/acm` command and the three agent tools (`context_checkpoint`, `context_timeline`, `context_compact`), plus the deferred compaction flow on `turn_end`/`agent_end` events. The timeline renders parsed checkpoint phases and folded intervals. Exports `didConversationAdvance` for tests.
*   `src/acm.ts`: Durable ACM state — `pi-context.toml` config parsing, session-state validation, `/acm` argument mapping, new-session detection, and the model-facing state notice.
*   `src/context.ts`: `/context` command — TUI overlay dashboard showing token usage per category (rough `ceil(len/4)` estimates scaled to actual usage).
*   `src/utils.ts`: Shared helpers — `formatTokens`, `isContextTool`, `formatContextUsage`, `parseCheckpointPhase`, `estimateHistoryTokens`, `describeHistoryInterval`.
*   `skills/context-management/`: The agent-facing skill. `SKILL.md` teaches the checkpoint → timeline → compact rhythm, the `<scope>-<phase>` naming convention, and the compact gate; `references/` holds per-scenario guidance.
*   `tools/session-analysis/`: Repo-local offline analyzer for saved session JSONL snapshots (library `analyze-session.mjs`, CLI `session-analysis-cli.mjs`, report template `session-chart.html`). Emits interactive HTML + JSON/CSV. Not published.
*   `test/`: `node --test` unit tests (`*.test.mjs`), live-model test (`live-command-context.mjs`), test fixtures (`*.ts` extensions), and manual scenarios (`test.md`).
*   `evals/`: Python skill-behavior eval harness (`run_context_eval.py`, `run_context_multi_turn_eval.py`), eval set definitions + notes, and historical `run-*` outputs (gitignored).

## COMMANDS
| Action | Command |
|--------|---------|
| Install | `pnpm install` |
| Typecheck | `pnpm typecheck` |
| Test | `pnpm test` = typecheck + `tsc` emit to `dist/` + `node --test test/*.test.mjs` |
| Live test | `pnpm test:live` (opt-in: real model, uses Pi auth, costs tokens) |
| Analyze session | `pnpm analyze:session <session.jsonl> [--out dir]` (repo checkout only; default output `.pi/session-analysis/` is gitignored) |
| Run locally | `pi --no-skills --no-extensions -e ./src/index.ts -e ./src/context.ts --skill ./skills` |
| Skill evals | `python evals/run_context_eval.py <set\|all>`; `python evals/run_context_multi_turn_eval.py <with-skill\|both>` |

## CODING STANDARDS
*   **Language**: TypeScript ESM (`"type": "module"`); Node16 resolution means local imports carry `.js` extensions (`./utils.js`).
*   **Style**: Extension modules are `export default function (pi: ExtensionAPI)`. Tool schemas use `Type.Object` from `pi-ai`. Iterative DFS (not recursion) for session-tree walks.
*   **Rules**: `strict: true`. SDK types not exported from the main entry (e.g. `SessionTreeNode`) are defined locally near usage. No linter/formatter config — match existing style.
*   **Tests**: `.mjs` files using `node:test` + `node:assert`; they import the **compiled** `dist/` output, so run `pnpm test` (which recompiles) rather than `node --test` on a stale `dist`.

## WHERE TO LOOK
*   **Source**: `src/`
*   **Tests**: `test/` (unit: `*.test.mjs`; manual/live scenarios: `test.md`)
*   **Skill**: `skills/context-management/SKILL.md` — the contract for when agents checkpoint, inspect, and compact. `references/` for scenario-specific guidance.
*   **Session analysis**: `tools/session-analysis/README.md` — report views, CLI options, measurement/simulation limits, privacy rules. Read it before changing analyzer behavior or interpreting output.
*   **Evals**: `evals/README.md` — eval set purposes, run matrix, scoring dimensions.

## NOTES
*   **Fork-only development**: `pnpm-workspace.yaml` links `@earendil-works/pi-coding-agent` to the sibling `../../pi-mono/packages/coding-agent` fork because ACM state depends on APIs not yet published to npm. The package remains private until those APIs ship and `peerDependencies` can declare the minimum compatible Pi version. Upstream (`ttttmr/pi-context`) uses npm; this fork uses pnpm and syncs upstream with merge commits.
*   **Architecture**: The extension operates on `SessionManager`'s entry tree: `pi.setLabel` for checkpoints, `branchWithSummary` + `navigateTree` for compaction. Nothing is deleted from disk; all history stays recoverable.
*   **Checkpoint Naming**: The skill documents `<scope>-<phase>` suffixes (`start/done/pivot/pause/resume`) as an agent-facing convention; the extension only parses the suffix for timeline display and does not track phase state. Timeline interval estimates use Pi's token heuristic over historical content (excluding internal context-management traffic), describe what was folded, and are not reclaimable tokens; never recommend the nearest checkpoint as a compact target.
*   **Native Compaction**: Leave Pi's manual, threshold, and overflow compaction untouched — no `session_before_compact` interception or replacement prompts.
*   **Compact flow**: `context_compact` returns `"compact start"` immediately → `turn_end` aborts the agent loop → `agent_end` defers (via `setTimeout` + `waitForIdle`, because `agent_end` fires before the agent is truly idle) → `didConversationAdvance` cancels if real entries arrived after the request → `branchWithSummary(tid)` creates the summary branch → leaf reset to `tid` so `navigateTree(nid)` rebuilds state → fire-and-forget continuation message. Treat compact as a phase-boundary operation, not mid-thought cleanup.
*   **ACM state**: `/acm` toggles durable session-global ACM state; `/acm enable` and `/acm disable` set it explicitly. `~/.pi/agent/pi-context.toml` may auto-enable only newly created sessions. Context tools return a disabled result while ACM is off.
*   **Command context**: `context_compact` acquires `ExtensionCommandContext` lazily by dispatching the private `/pi-context-acquire-command-context` command with `expandPromptTemplates: true` (Pi >= 0.84.2); its handler resolves the pending promise. `/acm` is not used for acquisition because it toggles state. Runtime handles (`commandCtx`, `compactRequest`) are cleared on `session_start` and `session_shutdown`.
*   **Advancement gate**: After the compact request, only passive entries (`label`, `custom`, `session_info`, `model_change`, `thinking_level_change`), the tool's own result, and empty abort-boundary assistant messages are safe; anything else cancels compaction with a warning instead of silently compacting a moved-on conversation.
*   **Publishing**: `files` = `src`, `skills`, `README.md`. Source-first: Pi loads the `.ts` extensions directly; `dist/` is only for unit tests. `tools/`, `test/`, `evals/` are development-only.
*   **Skill authoring**: Keep `skills/**` examples generic — no task-specific data, private session details, or one-off IDs. The skill's prompting principle is proportionality: checkpoint before noisy work, timeline when orientation matters, compact only when a known continuation benefits after recovery cost. Never encourage compact after final answers.
*   **Evals side effect**: The Python eval runners temporarily remove installed `pi-context` from `~/.pi/agent/settings.json` while running — don't run them concurrently with real Pi sessions you care about.
*   **Privacy**: The session analyzer exports no message/command/result bodies, but filenames, checkpoint names, and timestamps may still be sensitive; default output goes to gitignored `.pi/`.
