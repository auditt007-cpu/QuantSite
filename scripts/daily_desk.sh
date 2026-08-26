#!/bin/bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -d /root/quantsite ]]; then
  ROOT=/root/quantsite
fi
cd "$ROOT"
export PYTHONUNBUFFERED=1
LOG=/var/log/quant-daily-desk.log
{
  echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) daily desk ===="
  # Rankings may fail; never skip plaza hygiene (method dedupe + BTC lock).
  /usr/bin/python3 "$ROOT/calc_rankings.py" --days 60 --full --hero-scan || echo "calc_rankings failed (continuing)"
  /usr/bin/python3 "$ROOT/scripts/plaza_hygiene.py" || echo "plaza_hygiene failed"
} >>"$LOG" 2>&1
