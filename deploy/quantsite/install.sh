#!/bin/bash
set -euo pipefail
# Run ON the VPS as root. Does not bind any inbound port.
ROOT_DIR=/root/quantsite
UNIT=/etc/systemd/system/tg-bot.service
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$ROOT_DIR"
install -m 0755 "$SRC_DIR/tg_engine.py" "$ROOT_DIR/tg_engine.py"
install -m 0644 "$SRC_DIR/tg-bot.service" "$UNIT"
if [[ ! -f "$ROOT_DIR/.env" ]]; then
  if [[ -f "$SRC_DIR/.env" ]]; then
    install -m 0600 "$SRC_DIR/.env" "$ROOT_DIR/.env"
  else
    install -m 0600 "$SRC_DIR/.env.example" "$ROOT_DIR/.env"
    echo "Edit $ROOT_DIR/.env and set TG_BOT_TOKEN" >&2
  fi
fi
if ! grep -q '^TG_BOT_TOKEN=.\+' "$ROOT_DIR/.env"; then
  echo "TG_BOT_TOKEN is empty in $ROOT_DIR/.env" >&2
  exit 1
fi
systemctl daemon-reload
systemctl enable tg-bot
systemctl restart tg-bot
journalctl -u tg-bot -n 10 --no-pager
