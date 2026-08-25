# LLM / HF Grid Engine at 02:00, 08:00, 14:00, 20:00 (fee-rebate grids)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -d /root/quantsite ]]; then
  ROOT=/root/quantsite
fi
cd "$ROOT"
export PYTHONUNBUFFERED=1
/usr/bin/python3 "$ROOT/pipeline.py"
