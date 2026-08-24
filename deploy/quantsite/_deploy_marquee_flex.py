# -*- coding: utf-8 -*-
"""Deploy flex marquee isolation fix to VPS www."""
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
        "css/marquee-ticker.css",
        "css/mobile-global.css",
        "css/bloomberg-system.css",
        "css/bloomberg-dark.css",
        "css/live-room.css",
        "css/plaza-cards.css",
        "css/home-boards.css",
        "styles.css",
        "js/news.js",
        "js/flash-marquee.js",
        "js/nav.js",
        "js/plaza-ai.js",
        "js/live-room.js",
        "js/terminal.js",
        "js/i18n-boot.js",
        "i18n.js",
        "index.html",
        "live.html",
        "strategies.html",
        "terminal.html",
        "about.html",
        "member.html",
        "affiliate.html",
    ]
    for rel in puts:
        local = REPO / rel
        remote = "/var/www/html/" + rel.replace("\\", "/")
        # ensure remote css dir
        if "/" in rel:
            try:
                sftp.stat("/var/www/html/" + rel.split("/")[0])
            except OSError:
                sftp.mkdir("/var/www/html/" + rel.split("/")[0])
        sftp.put(str(local), remote)
        safe_print("put " + rel)
    sftp.close()

    _, stdout, stderr = ssh.exec_command(
        "python3 - <<'PY'\n"
        "from pathlib import Path\n"
        "html=Path('/var/www/html/index.html').read_text(encoding='utf-8')\n"
        "print('dark_css', Path('/var/www/html/css/bloomberg-dark.css').exists())\n"
        "print('plaza_css', Path('/var/www/html/css/plaza-cards.css').exists())\n"
        "print('plaza_js', Path('/var/www/html/js/plaza-ai.js').exists())\n"
        "print('no_flash', 'qaFlashMarquee' not in html)\n"
        "print('has_ticker', 'tickerBar' in html)\n"
        "print('member_no_flash', 'qaFlashMarquee' not in Path('/var/www/html/member.html').read_text(encoding='utf-8'))\n"
        "PY",
        timeout=30,
    )
    safe_print(stdout.read().decode("utf-8", "replace"))
    err = stderr.read().decode("utf-8", "replace")
    if err:
        safe_print("ERR " + err)
    ssh.close()
    safe_print("marquee flex deployed")


if __name__ == "__main__":
    main()
