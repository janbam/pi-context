```bash
pi --no-skills --no-extensions --skill ./skills -e ./src/index.ts -e ./src/context.ts
```

```md
Context Tool Test Task
Strictly follow the steps below.
1. Create a checkpoint for the starting point from here.
2. Generate a random number, write it to the file /tmp/pi-context-random, and display it using cat.
3. Compact to the start. The compact summary must not include the value of the random number but must state what the next step is.
4. Find a way to guess the value of the random number without reading the file.
5. Read the file to compare and see if the guess was correct.
6. Output "Success" if the guess is correct; otherwise, output "Failure".
```

## Timeline validation

`pnpm test` covers checkpoint phase-suffix parsing, timeline structure without compact advice, and interval token estimates (which exclude internal context-management traffic).

## Live command-context validation

Run the opt-in real-model test (uses existing Pi authentication and consumes tokens):

```bash
pnpm test:live
# Optional model override:
PI_CONTEXT_TEST_MODEL=openai-codex/gpt-5.6-luna pnpm test:live
```

The default is `openai-codex/gpt-5.6-luna` with low thinking. The runner launches isolated Pi RPC processes using the locally installed Pi package and current source extension; it disables other extensions, skills, context files, and built-in tools. It does not change global configuration.

Fresh sessions run `/acm enable` first, which also captures the command context, so they record no acquisition. Four phases check compaction after enablement, reuse in the same process, lazy acquisition after restarting with the saved session, and cancellation when a contextual message is flushed after `turn_end` but before `agent_end`. A passive test probe records actual `/pi-context-acquire-command-context` handler invocations without replacing command context or navigation. Assertions check summary ancestry, exact model continuation, dispatch counts, absence of orphan tool results, and absence of internal commands in user history or editor mutations. The cancellation phase must create no summary branch and retain the late contextual message on the active path. Advancement is measured from the assistant message containing the compact call; passive entries, that call's successful tool result, and an empty abort boundary do not cancel compaction.

Session files, raw RPC events, stderr, and per-phase verified results are saved under the temporary artifact directory printed at startup. The existing deliberate abort boundary may appear as an empty Codex `This operation was aborted` error before continuation; errors after continuation remain failures. This exercises real RPC and model behavior, not TUI rendering. It is excluded from `pnpm test`.

## Compaction advancement regression

Launch Pi with the passive-entry fixture:

```bash
pi --no-skills --no-extensions -e ./src/index.ts -e ./src/context.ts -e ./test/passive-custom-extension.ts
```

1. With `auto_enable = true` and without running `/acm`, ask the agent to checkpoint, inspect the timeline, and call `context_compact`. Confirm automatic command-context acquisition succeeds without changing the editor or injecting `/acm` into model history.
2. Confirm that label, session-info, and non-contextual custom entries appended while `waitForIdle()` settles do not cancel compaction.
3. Repeat while submitting a real user steering message before compaction settles; confirm that any message entry cancels compaction exactly once and creates no summary branch.
4. Confirm that the next model request contains no orphaned tool result.
5. Resume the session in a new process or run `/reload`, then compact again without any manual command; confirm the command context is reacquired automatically.

## ACM session-state regression

1. Start a new named session with `auto_enable = true`; confirm ACM is enabled without typing `/acm` and the session JSONL contains a `type: "session"` record with a nested `sessionState` field outside the conversation tree.
2. Run `/acm disable`, exit, and resume with `pi -c`; confirm ACM stays disabled even though auto-enable remains configured.
3. Run `/acm enable`, exit, and resume again; confirm ACM is enabled and `context_compact` still navigates.
4. Change ACM state several times before sending a prompt; confirm the next request carries the final state only: enabled means the three context tools plus an `<acm>` system prompt section, disabled means neither. Confirm redundant `/acm enable` or `/acm disable` commands and later prompts add no system-message delta.
5. With ACM enabled after an earlier disabled phase, compact to a checkpoint from the disabled phase; confirm the continuation still has the context tools (the `<acm>` section may return only with the next real prompt).
6. Create a new session with `/new`; confirm the configured auto-enable value initializes that new session independently.
