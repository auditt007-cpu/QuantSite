#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -d /root/quantsite ]]; then
  ROOT=/root/quantsite
fi
cd "$ROOT"
export PYTHONUNBUFFERED=1
LOG=/var/log/quant-daily-desk.log
{
  echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) daily desk ===="
  /usr/bin/python3 "$ROOT/calc_rankings.py" --days 60 --full
  /usr/bin/python3 "$ROOT/scripts/plaza_hygiene.py"
} >>"$LOG" 2>&1
