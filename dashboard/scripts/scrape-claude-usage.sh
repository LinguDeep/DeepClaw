#!/bin/bash
# Fast Claude Code /usage scraper using persistent tmux session
WORKSPACE_DIR="${WORKSPACE_DIR:-${DEEPCLAW_WORKSPACE:-$(pwd)}}"
OUTPUT_FILE="${WORKSPACE_DIR}/data/claude-usage.json"
LOCK_FILE="/tmp/claude-usage-scrape.lock"
SESSION="claude-persistent"
mkdir -p "${WORKSPACE_DIR}/data"

# Prevent concurrent runs
if [ -f "$LOCK_FILE" ]; then
  pid=$(cat "$LOCK_FILE")
  if kill -0 "$pid" 2>/dev/null; then
    echo "Already running (pid $pid)"
    exit 0
  fi
fi
echo $$ > "$LOCK_FILE"
trap "rm -f $LOCK_FILE" EXIT

# Check if persistent session exists with Claude running
CLAUDE_READY=false
if tmux has-session -t "$SESSION" 2>/dev/null; then
  PANE_PID=$(tmux display-message -t "$SESSION" -p '#{pane_pid}')
  if pgrep -P "$PANE_PID" -f "claude" >/dev/null 2>&1; then
    CLAUDE_READY=true
  else
    tmux kill-session -t "$SESSION" 2>/dev/null
  fi
fi

if [ "$CLAUDE_READY" = false ]; then
  # Cold start
  tmux kill-session -t "$SESSION" 2>/dev/null
  tmux new-session -d -s "$SESSION" -x 200 -y 60
  tmux send-keys -t "$SESSION" "cd ${WORKSPACE_DIR} && claude" Enter
  # Wait for Claude to be ready
  for i in $(seq 1 15); do
    sleep 1
    PANE=$(tmux capture-pane -t "$SESSION" -p 2>/dev/null)
    if echo "$PANE" | grep -qE "❯|shortcuts"; then
      break
    fi
  done
  sleep 1
fi

# Dismiss any existing menu/state
tmux send-keys -t "$SESSION" Escape
sleep 0.5

# Type /usage and Enter twice (first opens autocomplete, second selects)
tmux send-keys -t "$SESSION" "/usage"
sleep 1
tmux send-keys -t "$SESSION" Enter
sleep 3

# Capture the output
tmux capture-pane -t "$SESSION" -p -S -60 > /tmp/claude-usage-raw.txt

# Dismiss the usage panel
tmux send-keys -t "$SESSION" Escape
sleep 0.5

PARSE_SCRIPT="${WORKSPACE_DIR}/scripts/parse-claude-usage.py"
if [ -f "$PARSE_SCRIPT" ]; then
  python3 "$PARSE_SCRIPT" /tmp/claude-usage-raw.txt "$OUTPUT_FILE"
else
  echo "Error: parse-claude-usage.py not found at $PARSE_SCRIPT"
  exit 1
fi
