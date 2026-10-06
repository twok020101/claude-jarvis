#!/usr/bin/env bash
# Installs the J.A.R.V.I.S. mod (and optional status line) on this machine.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

claude plugin marketplace add twok020101/claude-jarvis
claude plugin install jarvis@twok-mods

if [ "${1:-}" = "--statusline" ]; then
  cp "$here/extras/statusline-command.sh" ~/.claude/statusline-command.sh
  settings=~/.claude/settings.json
  [ -f "$settings" ] || echo '{}' > "$settings"
  tmp=$(mktemp)
  jq '.statusLine = {"type":"command","command":"bash ~/.claude/statusline-command.sh"}' "$settings" > "$tmp" && mv "$tmp" "$settings"
  echo "Status line installed."
fi
echo "Done. Restart Claude Code, then run /jarvis."
