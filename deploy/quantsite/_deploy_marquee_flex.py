# -*- coding: utf-8 -*-
"""Deploy static site to VPS www. Unifies HTML ?v= to git+UTC stamp."""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path

import paramiko
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
load_dotenv(HERE / ".env")
load_dotenv(REPO / ".env")

STAMP_FILE = REPO / "asset-query"
REMOTE_WWW = "/var/www/html"
REMOTE_APP = "/root/quantsite"

HUB_PUTS = [
    "bot_server.py",
    "hub/tts.py",
    "requirements.txt",
]

HTML_NAMES = [
    "index.html",
    "live.html",
    "strategies.html",
    "terminal.html",
    "about.html",
    "member.html",
    "affiliate.html",
    "admin.html",
    "ai-backtest.html",
    "backtest.html",
    "marketplace.html",
    "bots.html",
]

PUTS = [
    "css/mobile-global.css",
    "css/bloomberg-system.css",
    "css/bloomberg-dark.css",
    "css/live-room.css",
    "css/plaza-cards.css",
    "css/home-boards.css",
    "css/mobile-subpages.css",
    "css/bots.css",
    "css/bbg-terminal.css",
    "css/mark-q.svg",
    "styles.css",
    "favicon.svg",
    "favicon-16x16.png",
    "favicon-32x32.png",
    "favicon-192.png",
    "apple-touch-icon.png",
    "js/flash-marquee.js",
    "js/nav.js",
    "js/binance-feed.js",
    "js/plaza-ai.js",
    "js/grid-backtest.js",
    "js/offline-klines.js",
    "js/live-room.js",
    "js/voice-templates.js",
    "js/edge-speak.js",
    "audio/promo_zh_cn.mp3",
    "audio/promo_en_us.mp3",
    "audio/promo_zh_tw.mp3",
    "js/terminal.js",
    "js/i18n-boot.js",
    "js/lead-bind.js",
    "js/home-boards.js",
    "js/identity.js",
    "js/compliance.js",
    "js/meta-events.js",
    "js/clipboard.js",
    "js/money.js",
    "js/member.js",
    "js/backtest.js",
    "js/mobile-ux.js",
    "app.js",
    "config.js",
    "i18n.js",
] + HTML_NAMES

DEAD_REMOTE = [
    "js/news.js",
    "css/marquee-ticker.css",
]

LOCAL_ASSET = re.compile(
    r"""(?P<pre>(?:href|src)\s*=\s*["'])(?P<path>\./(?:(?:css|js)/)?[^"'?]+?\.(?:css|js))(?P<q>\?v=[^"'&\s]*)?(?P<post>["'])""",
    re.I,
)


def safe_print(s: str) -> None:
    sys.stdout.buffer.write((s or "").encode("ascii", "replace") + b"\n")
    sys.stdout.buffer.flush()


def git_short() -> str:
    try:
        return (
            subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=str(REPO),
                stderr=subprocess.DEVNULL,
            )
            .decode("ascii", "replace")
            .strip()
        )
    except (OSError, subprocess.CalledProcessError):
        return "nogit"


def make_stamp() -> str:
    env = (os.environ.get("QA_ASSET_STAMP") or "").strip()
    if env:
        return re.sub(r"[^A-Za-z0-9._-]", "", env)[:40]
    restamp = (os.environ.get("QA_RESTAMP") or "").strip() in ("1", "true", "yes")
    if STAMP_FILE.is_file() and not restamp:
        existing = re.sub(r"[^A-Za-z0-9._-]", "", STAMP_FILE.read_text(encoding="utf-8").strip())[:40]
        if existing:
            return existing
    utc = time.strftime("%Y%m%d%H%M", time.gmtime())
    return "{0}-{1}".format(utc, git_short())


def stamp_html_text(text: str, stamp: str) -> str:
    def _sub(m: re.Match) -> str:
        return "{0}{1}?v={2}{3}".format(m.group("pre"), m.group("path"), stamp, m.group("post"))

    return LOCAL_ASSET.sub(_sub, text)


def stamp_repo_html(stamp: str) -> None:
    STAMP_FILE.write_text(stamp + "\n", encoding="utf-8")
    for name in HTML_NAMES:
        path = REPO / name
        if not path.is_file():
            continue
        raw = path.read_text(encoding="utf-8")
        out = stamp_html_text(raw, stamp)
        if out != raw:
            path.write_text(out, encoding="utf-8")
            safe_print("stamp " + name + " " + stamp)


def patch_terminal_redirect(ssh) -> None:
    cmd = (
        "python3 - <<'PY'\n"
        "from pathlib import Path\n"
        "needle = 'location = /terminal.html'\n"
        "block = '''    location = /terminal.html {\\n"
        "        return 301 /strategies.html$is_args$args;\\n"
        "    }\\n'''\n"
        "cands = list(Path('/etc/nginx/sites-enabled').glob('*')) + list(Path('/etc/nginx/conf.d').glob('*.conf'))\n"
        "for p in cands:\n"
        "    if not p.is_file():\n"
        "        continue\n"
        "    t = p.read_text(encoding='utf-8', errors='replace')\n"
        "    if 'root' not in t or 'www/html' not in t:\n"
        "        continue\n"
        "    if needle in t:\n"
        "        print('redirect_already', str(p))\n"
        "        break\n"
        "    idx = t.rfind('}')\n"
        "    if idx < 0:\n"
        "        continue\n"
        "    p.write_text(t[:idx] + block + t[idx:], encoding='utf-8')\n"
        "    print('redirect_patched', str(p))\n"
        "    break\n"
        "else:\n"
        "    print('redirect_skip_no_www_server')\n"
        "PY"
    )
    _, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    safe_print(stdout.read().decode("utf-8", "replace"))
    err = stderr.read().decode("utf-8", "replace")
    if err:
        safe_print("ERR " + err)
    ssh.exec_command("nginx -t && systemctl reload nginx", timeout=30)


def deploy_hub_tts(ssh) -> None:
    sftp = ssh.open_sftp()
    for rel in HUB_PUTS:
        local = REPO / rel
        if not local.is_file():
            safe_print("hub skip missing " + rel)
            continue
        remote = REMOTE_APP + "/" + rel.replace("\\", "/")
        parts = rel.split("/")
        if len(parts) > 1:
            cur = REMOTE_APP
            for part in parts[:-1]:
                cur = cur + "/" + part
                try:
                    sftp.stat(cur)
                except OSError:
                    sftp.mkdir(cur)
        sftp.put(str(local), remote)
        safe_print("hub put " + rel)
    sftp.close()
    cmd = (
        "pip3 install --break-system-packages 'edge-tts>=6.1.0' 2>/dev/null || "
        "pip3 install 'edge-tts>=6.1.0' 2>/dev/null || true; "
        "python3 -m py_compile {0}/bot_server.py {0}/hub/tts.py && "
        "systemctl restart quant-hub 2>/dev/null || systemctl restart tg-bot 2>/dev/null || true; "
        "sleep 2; curl -sS http://127.0.0.1:8088/health; "
        "curl -sS -o /dev/null -w 'tts=%{{http_code}}\\n' -X POST http://127.0.0.1:8088/api/tts/speak "
        "-H 'Content-Type: application/json' -d '{{\"text\":\"ok\",\"lang\":\"en\"}}'"
    ).format(REMOTE_APP)
    _, stdout, stderr = ssh.exec_command(cmd, timeout=120)
    safe_print(stdout.read().decode("utf-8", "replace"))
    err = stderr.read().decode("utf-8", "replace")
    if err:
        safe_print("hub ERR " + err)


def main():
    stamp = make_stamp()
    stamp_repo_html(stamp)
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
    for rel in PUTS:
        local = REPO / rel
        if not local.is_file():
            safe_print("skip missing " + rel)
            continue
        remote = REMOTE_WWW + "/" + rel.replace("\\", "/")
        if "/" in rel:
            try:
                sftp.stat(REMOTE_WWW + "/" + rel.split("/")[0])
            except OSError:
                sftp.mkdir(REMOTE_WWW + "/" + rel.split("/")[0])
        sftp.put(str(local), remote)
        safe_print("put " + rel)
    for rel in DEAD_REMOTE:
        remote = REMOTE_WWW + "/" + rel
        try:
            sftp.remove(remote)
            safe_print("rm " + rel)
        except OSError:
            safe_print("rm_miss " + rel)
    sftp.close()
    patch_terminal_redirect(ssh)
    deploy_hub_tts(ssh)
    _, stdout, stderr = ssh.exec_command(
        "python3 - <<'PY'\n"
        "from pathlib import Path\n"
        "html=Path('/var/www/html/index.html').read_text(encoding='utf-8')\n"
        "term=Path('/var/www/html/terminal.html').read_text(encoding='utf-8')\n"
        "print('no_fab', 'tgFab' not in html and 'tg-fab' not in html)\n"
        "print('term_redirect', 'strategies.html' in term and 'location.replace' in term)\n"
        "print('no_news_js', not Path('/var/www/html/js/news.js').exists())\n"
        "print('no_mq_css', not Path('/var/www/html/css/marquee-ticker.css').exists())\n"
        "print('has_stamp', '?v=' in html)\n"
        "print('lead_bind', Path('/var/www/html/js/lead-bind.js').exists())\n"
        "PY",
        timeout=30,
    )
    safe_print(stdout.read().decode("utf-8", "replace"))
    err = stderr.read().decode("utf-8", "replace")
    if err:
        safe_print("ERR " + err)
    ssh.close()
    safe_print("www deployed stamp=" + stamp)


if __name__ == "__main__":
    if "--stamp-only" in sys.argv:
        stamp = make_stamp()
        stamp_repo_html(stamp)
        safe_print("stamped " + stamp)
    else:
        main()
