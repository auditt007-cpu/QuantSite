# -*- coding: utf-8 -*-
"""Deploy TG-style event tape (exec_log from scan_events) to VPS + static www."""
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
    sftp = ssh.open_sftp()
    puts = [
        (REPO / "deploy/quantsite/tg_engine.py", "/root/quantsite/tg_engine.py"),
        (REPO / "deploy/quantsite/tg_engine.py", "/root/quantsite/deploy/quantsite/tg_engine.py"),
        (REPO / "js/live-room.js", "/var/www/html/js/live-room.js"),
        (REPO / "css/live-room.css", "/var/www/html/css/live-room.css"),
        (REPO / "live.html", "/var/www/html/live.html"),
        (REPO / "i18n.js", "/var/www/html/i18n.js"),
    ]
    for local, remote in puts:
        sftp.put(str(local), remote)
        safe_print("put " + remote)
    sftp.close()

    def run(cmd, timeout=180):
        safe_print(">> " + cmd[:180])
        _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        if out:
            safe_print(out)
        if err:
            safe_print(err)
        if code != 0:
            raise SystemExit("fail %s" % code)
        return out

    run("python3 -m py_compile /root/quantsite/tg_engine.py")
    # Drop legacy hourly dump so the rail only shows TG-style side-change batches.
    run(
        "python3 - <<'PY'\n"
        "import json, os, time\n"
        "p='/root/quantsite/live_exec_log.json'\n"
        "if os.path.isfile(p):\n"
        "  os.replace(p, p + '.pre_event.bak')\n"
        "  print('rotated', p)\n"
        "open(p,'w',encoding='utf-8').write('[]\\n')\n"
        "print('cleared', p)\n"
        "PY"
    )
    run("systemctl restart tg-bot; sleep 3; systemctl is-active tg-bot")
    run(
        "cd /root/quantsite && set -a && . ./.env && set +a && python3 - <<'PY'\n"
        "import tg_engine as t\n"
        "feed = t.build_live_feed_matrix()\n"
        "t.write_live_feed(feed)\n"
        "rows = feed.get('exec_log') or []\n"
        "print('exec_mode', feed.get('exec_mode'))\n"
        "print('scan_tf', feed.get('scan_tf'))\n"
        "print('raw_count', feed.get('exec_log_raw_count'))\n"
        "print('display_count', len(rows))\n"
        "print('kinds', sorted({(r or {}).get('kind') for r in rows}))\n"
        "PY",
        timeout=180,
    )
    run(
        "python3 - <<'PY'\n"
        "import json,urllib.request\n"
        "u='https://api.quantalpha.space/live_feed.json?t=1'\n"
        "d=json.loads(urllib.request.urlopen(u, timeout=15).read().decode())\n"
        "rows=d.get('exec_log') or []\n"
        "print('api_mode', d.get('exec_mode'), d.get('scan_tf'))\n"
        "print('api_display', len(rows))\n"
        "print('api_kinds', sorted({(r or {}).get('kind') for r in rows}))\n"
        "PY"
    )
    run("journalctl -u tg-bot -n 12 --no-pager | tr -cd '\\11\\12\\15\\40-\\176'")
    ssh.close()
    safe_print("tg-style tape deployed")


if __name__ == "__main__":
    main()
