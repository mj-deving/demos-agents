#!/usr/bin/env bash
# Remove agent session logs older than 7 days.
# Crontab: 0 5 * * * /home/mj/projects/demos-agents/scripts/rotate-logs.sh

LOG_DIR="$HOME/.demos-agent-logs"

if [ -d "$LOG_DIR" ]; then
  find "$LOG_DIR" -name "*.log" -mtime +7 -delete
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Rotated logs older than 7 days in $LOG_DIR"
fi
