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
  # 60d 主榜 + 多周期 hero（3..180d）择优 → hero_highlight / hero_by_period
  /usr/bin/python3 "$ROOT/calc_rankings.py" --days 60 --full --hero-scan
  /usr/bin/python3 "$ROOT/scripts/plaza_hygiene.py"
} >>"$LOG" 2>&1
