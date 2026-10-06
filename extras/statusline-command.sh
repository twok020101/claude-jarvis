#!/usr/bin/env bash

input=$(cat)

cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
model=$(echo "$input" | jq -r '.model.display_name // ""')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

# Shorten home directory to ~
home="$HOME"
short_cwd="${cwd/#$home/\~}"

# Git branch (skip optional locks to avoid contention)
git_branch=""
if git -C "$cwd" rev-parse --git-dir > /dev/null 2>&1; then
  git_branch=$(git -C "$cwd" -c core.fsmonitor=false symbolic-ref --short HEAD 2>/dev/null \
    || git -C "$cwd" -c core.fsmonitor=false rev-parse --short HEAD 2>/dev/null)
fi

# Context usage indicator
ctx_str=""
if [ -n "$used_pct" ]; then
  used_int=${used_pct%.*}
  ctx_str=" | ctx:${used_int}%"
fi

# Git branch segment
branch_str=""
if [ -n "$git_branch" ]; then
  branch_str=" | ${git_branch}"
fi

printf "\033[2m[%s%s] %s%s\033[0m" \
  "$short_cwd" \
  "$branch_str" \
  "$model" \
  "$ctx_str"
