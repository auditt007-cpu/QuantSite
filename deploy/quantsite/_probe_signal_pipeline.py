# -*- coding: utf-8 -*-
"""Probe VPS signal pipeline: systemd, logs, feed mtime, klines, JSON health."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
load_dotenv(HERE / ".env")
load_dotenv(REPO / ".env")


def safe_print(s: str) -> None:
    sys.stdout.buffer.write((s or "").encode("ascii", "replace") + b"\n")
    sys.stdout.buffer.flush()


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(
        os.environ["SSH_HOST"],
        port=int(os.environ.get("SSH_PORT", "22")),
        username=os.environ.get("SSH_USER", "root"),
        password=os.environ["SSH_PASS"],
        timeout=30,
        allow_agent=False,
        look_for_keys=False,
    )

    def run(cmd, timeout=40):
        safe_print(">> " + cmd[:200])
        _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        if out:
            safe_print(out)
        if err:
            safe_print("ERR " + err)
        safe_print("exit " + str(code))
        return out, err, code

    run("systemctl is-active tg-bot; systemctl is-active quant-hub; date -u; uptime")
    run("ps aux | grep -E 'tg_engine|python3' | grep -v grep | head -20")
    run("journalctl -u tg-bot -n 80 --no-pager")
    run(
        "python3 - <<'PY'\n"
        "import os, json, time\n"
        "from datetime import datetime, timezone\n"
        "now=time.time()\n"
        "paths=[\n"
        " '/root/quantsite/live_feed.json',\n"
        " '/var/www/html/live_feed.json',\n"
        " '/root/quantsite/live_exec_log.json',\n"
        " '/root/quantsite/live_position_state.json',\n"
        "]\n"
        "for p in paths:\n"
        "    st=os.path.exists(p)\n"
        "    if not st:\n"
        "        print('MISSING', p); continue\n"
        "    m=os.path.getmtime(p); sz=os.path.getsize(p)\n"
        "    print('file', p, 'bytes', sz, 'age_sec', int(now-m), 'mtime', datetime.fromtimestamp(m, tz=timezone.utc).isoformat())\n"
        "for p in ['/root/quantsite/live_feed.json','/var/www/html/live_feed.json']:\n"
        "    if not os.path.isfile(p): continue\n"
        "    d=json.load(open(p,encoding='utf-8'))\n"
        "    rows=d.get('exec_log') or []\n"
        "    print('json', p, 'updated_at', d.get('updated_at'), 'signal_count', d.get('signal_count'), 'exec_n', len(rows), 'raw', d.get('exec_log_raw_count'), 'poll', d.get('poll_sec'))\n"
        "    if rows:\n"
        "        top=rows[0]\n"
        "        print('top_kind', top.get('kind'), 'logged', top.get('logged_at'), 'bar', top.get('bar_ts'), 'name', top.get('name_zh'), 'syms', [s.get('symbol') for s in (top.get('symbols') or [])][:6])\n"
        "PY"
    )
    run("crontab -l 2>/dev/null | head -40")
    run(
        "python3 - <<'PY'\n"
        "import json,urllib.request,ssl\n"
        "ctx=ssl._create_unverified_context()\n"
        "urls=[\n"
        " 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=5',\n"
        " 'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=5',\n"
        "]\n"
        "for u in urls:\n"
        "    try:\n"
        "        req=urllib.request.Request(u, headers={'User-Agent':'qa-probe'})\n"
        "        r=urllib.request.urlopen(req, timeout=12, context=ctx)\n"
        "        rows=json.loads(r.read().decode())\n"
        "        print('ok', u.split('/')[2], 'n', len(rows), 'last_close', rows[-1][4] if rows else None)\n"
        "    except Exception as e:\n"
        "        print('fail', u.split('/')[2], type(e).__name__, e)\n"
        "PY"
    )
    run(
        "python3 - <<'PY'\n"
        "import json,urllib.request\n"
        "u='https://api.quantalpha.space/live_feed.json?t=1'\n"
        "try:\n"
        "    d=json.loads(urllib.request.urlopen(u, timeout=15).read().decode())\n"
        "    print('api_updated', d.get('updated_at'), 'exec', len(d.get('exec_log') or []), 'signals', d.get('signal_count'))\n"
        "except Exception as e:\n"
        "    print('api_fail', type(e).__name__, e)\n"
        "PY"
    )
    ssh.close()
    safe_print("probe done")


if __name__ == "__main__":
    main()
