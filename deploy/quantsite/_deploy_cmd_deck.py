# -*- coding: utf-8 -*-
"""Deploy command-deck live room to VPS www + restart engine TTS settings."""
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
        (REPO / "live.html", "/var/www/html/live.html"),
        (REPO / "js/live-room.js", "/var/www/html/js/live-room.js"),
        (REPO / "css/live-room.css", "/var/www/html/css/live-room.css"),
        (REPO / "i18n.js", "/var/www/html/i18n.js"),
        (REPO / "deploy/quantsite/tg_engine.py", "/root/quantsite/tg_engine.py"),
        (REPO / "deploy/quantsite/tg_engine.py", "/root/quantsite/deploy/quantsite/tg_engine.py"),
    ]
    for local, remote in puts:
        sftp.put(str(local), remote)
        safe_print("put " + remote)
    sftp.close()

    def run(cmd, timeout=60):
        safe_print(">> " + cmd[:160])
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
    run("systemctl restart tg-bot; sleep 2; systemctl is-active tg-bot")
    run(
        "python3 - <<'PY'\n"
        "import json,urllib.request\n"
        "u='https://api.quantalpha.space/live_feed.json?t=1'\n"
        "d=json.loads(urllib.request.urlopen(u, timeout=15).read().decode())\n"
        "print('exec_mode', d.get('exec_mode'), d.get('scan_tf'))\n"
        "print('exec_n', len(d.get('exec_log') or []))\n"
        "PY"
    )
    ssh.close()
    safe_print("command deck deployed")


if __name__ == "__main__":
    main()
