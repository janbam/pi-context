# Orca Pi Launch (Enable ACM)

Use when spawning pi through Orca, or when a live Orca pi session still needs `/acm` before compact.

`/acm` is a pi slash command. Orca does not enable ACM. Compact needs it; checkpoint and timeline do not. Prefix **submitted** text only. If it already starts with `/acm`, do not prefix again.

```text
/acm <task>
```

Pi runs `/acm`, then starts `<task>` as the first user turn.

## Submit

```text
orca worktree create --name <task-name> --agent pi --prompt "/acm <task>" --json
orca terminal send --terminal <handle> --text "/acm <task>" --enter --json
orca automations create --name <name> --trigger <schedule> --provider pi --prompt "/acm <task>" --json
```

Same rule for custom argv (`pi '/acm <task>'`) and orchestration dispatch text. `worker-start` has no `--prompt`; prefix the later task text.

A fresh `terminal create --command pi` has no prompt yet. Wait for idle, then send `/acm <task>`.

## Do not prefix

- UI draft / `ORCA_PI_PREFILL` — editor only; ACM stays off until Enter
- resume — `CommandCtx` is in-memory; send `/acm` again in the new process

Already-running pi that never got `/acm`:

```text
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 90000 --json
orca terminal send --terminal <handle> --text "/acm" --enter --json
```

Parent spawners do not load this skill. Point them at this file. The child pi still needs `pi-context` installed.
