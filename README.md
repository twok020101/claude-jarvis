# claude-jarvis

J.A.R.V.I.S. mod for Claude Code: arc-reactor spinner, live telemetry band (context, tok/s, agents by model), subagent uplink animations, input alerts, a `/jarvis` diagnostics pane, and the J.A.R.V.I.S. persona.

This repo is a Claude Code plugin marketplace (`twok-mods`) containing one plugin, `jarvis`.

## Install on a new machine

```bash
claude plugin marketplace add twok020101/claude-jarvis
claude plugin install jarvis@twok-mods
```

Or clone and run `./install.sh` (add `--statusline` to also install the status line script; needs `jq`).

Restart Claude Code afterwards.

## Controls

- `/jarvis on|off`: toggle the mod
- `/jarvis persona on|off`: toggle the persona
- `/jarvis title <word>`: how you're addressed (default `sir`)

## Updating

Edit here, push, then on each machine: `claude plugin marketplace update twok-mods`.

## Layout

- `.claude-plugin/marketplace.json`: marketplace manifest
- `jarvis/`: the plugin (hooks in `jarvis/hooks/`, entry `register.tsx`)
- `extras/`: optional status line script and settings snippet
