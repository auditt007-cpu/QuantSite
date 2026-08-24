# -*- coding: utf-8 -*-
"""Deploy tape heartbeat + inWatch fix to VPS www + restart tg-bot."""
from __future__ import annotations

import os
import sys
import time
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
        (REPO / "deploy/quantsite/nginx-hub.conf", "/root/quantsite/deploy/quantsite/nginx-hub.conf"),
        (REPO / "js/live-room.js", "/var/www/html/js/live-room.js"),
        (REPO / "live.html", "/var/www/html/live.html"),
    ]
    for local, remote in puts:
        sftp.put(str(local), remote)
        safe_print("put " + remote)
    sftp.close()

    def run(cmd, timeout=90):
        safe_print(">> " + cmd[:180])
        _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        if out:
            safe_print(out)
        if err:
            safe_print("ERR " + err)
        if code != 0:
            raise SystemExit("fail %s" % code)
        return out

    run("python3 -m py_compile /root/quantsite/tg_engine.py")
    run("install -m 0644 /root/quantsite/deploy/quantsite/nginx-hub.conf /etc/nginx/snippets/quant-hub.conf")
    run(
        "python3 - <<'PY'\n"
        "from pathlib import Path\n"
        "needle = 'location = /live_feed.json'\n"
        "cands = list(Path('/etc/nginx/sites-enabled').glob('*')) + list(Path('/etc/nginx/conf.d').glob('*.conf')) + list(Path('/etc/nginx/snippets').glob('*.conf'))\n"
        "patched = 0\n"
        "for p in cands:\n"
        "    if not p.is_file(): continue\n"
        "    t = p.read_text(encoding='utf-8', errors='replace')\n"
        "    if needle not in t: continue\n"
        "    block_at = t.find(needle)\n"
        "    chunk = t[block_at:block_at+400]\n"
        "    if 'Access-Control-Allow-Origin' in chunk:\n"
        "        print('cors_ok', str(p)); continue\n"
        "    t = t.replace(\n"
        "        'location = /live_feed.json {',\n"
        "        'location = /live_feed.json {\\n        add_header Access-Control-Allow-Origin \\\"*\\\" always;\\n        add_header Cache-Control \\\"no-store, no-cache, must-revalidate\\\" always;',\n"
        "        1,\n"
        "    )\n"
        "    p.write_text(t, encoding='utf-8')\n"
        "    print('cors_patched', str(p))\n"
        "    patched += 1\n"
        "print('patched', patched)\n"
        "PY"
    )
    run("nginx -t && systemctl reload nginx")
    run("systemctl restart tg-bot; sleep 2; systemctl is-active tg-bot")
    safe_print("waiting one poll cycle...")
    time.sleep(22)
    run("journalctl -u tg-bot -n 35 --no-pager")
    run(
        "python3 - <<'PY'\n"
        "import os, json, time\n"
        "from datetime import datetime, timezone\n"
        "now=time.time()\n"
        "p='/root/quantsite/live_feed.json'\n"
        "d=json.load(open(p,encoding='utf-8'))\n"
        "rows=d.get('exec_log') or []\n"
        "print('updated', d.get('updated_at'), 'age', int(now-os.path.getmtime(p)))\n"
        "print('exec_n', len(rows), 'raw', d.get('exec_log_raw_count'))\n"
        "if rows:\n"
        "    top=rows[0]\n"
        "    logged=int(top.get('logged_at') or 0)\n"
        "    print('top_name', top.get('name_zh'), 'logged', logged, 'age', int(now-logged) if logged else None)\n"
        "    print('top_syms', [s.get('symbol') for s in (top.get('symbols') or [])][:8])\n"
        "    print('top_tf', top.get('interval'))\n"
        "live=open('/var/www/html/js/live-room.js',encoding='utf-8').read()\n"
        "print('js_inwatch', 'function inWatch' in live)\n"
        "print('js_norm', 'function normSym' in live)\n"
        "PY"
    )
    run(
        "curl -sSI -H 'Origin: https://quantalpha.space' "
        "'https://api.quantalpha.space/live_feed.json?t=1' | tr -d '\\r' | grep -iE 'HTTP/|access-control|cache-control'"
    )
    ssh.close()
    safe_print("tape heartbeat deployed")


if __name__ == "__main__":
    main()
