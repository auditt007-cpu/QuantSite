# -*- coding: utf-8 -*-
"""Deploy market fail-safe (FET swap + 3-level ticker + news ticker height) to VPS www."""
from __future__ import annotations

import os
import posixpath
import sys
from pathlib import Path

import paramiko
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
load_dotenv(HERE / ".env")
load_dotenv(REPO / ".env")

WWW = "/var/www/html"
FILES = [
    "js/live-room.js",
    "js/binance-feed.js",
    "js/nav.js",
    "live.html",
    "index.html",
    "strategies.html",
    "terminal.html",
    "about.html",
    "member.html",
    "affiliate.html",
    "admin.html",
    "ai-backtest.html",
    "css/bloomberg-system.css",
    "css/live-room.css",
    "css/mobile-global.css",
    "styles.css",
]


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
    for rel in FILES:
        local = REPO / rel
        remote = WWW + "/" + rel.replace("\\", "/")
        parent = posixpath.dirname(remote)
        try:
            sftp.stat(parent)
        except OSError:
            ssh.exec_command("mkdir -p " + parent)
        sftp.put(str(local), remote)
        safe_print("put " + rel)

    tg = REPO / "deploy/quantsite/tg_engine.py"
    if tg.is_file():
        sftp.put(str(tg), "/root/quantsite/tg_engine.py")
        sftp.put(str(tg), "/root/quantsite/deploy/quantsite/tg_engine.py")
        safe_print("put tg_engine.py")
    sftp.close()

    def run(cmd, timeout=60):
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
    run(
        "python3 - <<'PY'\n"
        "from pathlib import Path\n"
        "live=Path('/var/www/html/js/live-room.js').read_text(encoding='utf-8', errors='replace')\n"
        "nav=Path('/var/www/html/js/nav.js').read_text(encoding='utf-8', errors='replace')\n"
        "feed=Path('/var/www/html/js/binance-feed.js').read_text(encoding='utf-8', errors='replace')\n"
        "html=Path('/var/www/html/live.html').read_text(encoding='utf-8', errors='replace')\n"
        "css=Path('/var/www/html/css/bloomberg-system.css').read_text(encoding='utf-8', errors='replace')\n"
        "print('live_near', 'NEARUSDT' in live)\n"
        "print('live_no_all_fet', 'FETUSDT\", \"PEPEUSDT' not in live.replace(' ', ''))\n"
        "print('live_synth', 'seedFailSafe' in live and 'startJitter' in live)\n"
        "print('live_rest', 'armRestFallback' in live)\n"
        "print('live_loading_text', '載入行情' in live)\n"
        "print('nav_no_fet_list', '\"FETUSDT\"' not in nav.split('TICKER_SYMBOLS')[1][:400] if 'TICKER_SYMBOLS' in nav else False)\n"
        "print('feed_dead', 'DEAD_SYMBOLS' in feed)\n"
        "print('html_near', 'NEARUSDT' in html and 'FETUSDT' not in html)\n"
        "print('css_44', 'height: 44px' in css and 'news-ticker-container' in css)\n"
        "print('html_ticker_cls', 'news-ticker-container' in html)\n"
        "PY"
    )
    ssh.close()
    safe_print("market failsafe deployed")


if __name__ == "__main__":
    main()
