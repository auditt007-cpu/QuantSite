# -*- coding: utf-8 -*-
"""Deploy VPS news_feed.json scraper + nginx location for api.quantalpha.space."""

import os
import textwrap

import paramiko

HOST = os.environ.get("SSH_HOST", "154.21.206.234")
PORT = int(os.environ.get("SSH_PORT", "1063"))
USER = os.environ.get("SSH_USER", "root")
PASSWORD = os.environ["SSH_PASS"]
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REMOTE_ENGINE = "/root/quantsite"
WEB_ROOT = "/var/www/html"

SERVICE = textwrap.dedent(
    """
    [Unit]
    Description=QuantAlpha news RSS scraper
    After=network.target

    [Service]
    Type=simple
    WorkingDirectory={engine}
    Environment=WEB_NEWS_PATH={web}/news_feed.json
    Environment=NEWS_POLL_SEC=600
    ExecStart=/usr/bin/python3 {engine}/news_scraper.py
    Restart=always
    RestartSec=20

    [Install]
    WantedBy=multi-user.target
    """
).format(engine=REMOTE_ENGINE, web=WEB_ROOT)


def run():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=30)
    sftp = client.open_sftp()
    local = os.path.join(REPO, "deploy", "quantsite", "news_scraper.py")
    sftp.put(local, REMOTE_ENGINE + "/news_scraper.py")
    sftp.close()

    cmds = [
        "mkdir -p " + WEB_ROOT,
        "cat > /etc/systemd/system/qa-news-scraper.service <<'EOF'\n" + SERVICE + "\nEOF",
        "systemctl daemon-reload",
        "systemctl enable qa-news-scraper.service",
        "systemctl restart qa-news-scraper.service",
        "systemctl is-active qa-news-scraper.service",
    ]
    for cmd in cmds:
        stdin, stdout, stderr = client.exec_command(cmd)
        stdout.channel.recv_exit_status()
        out = stdout.read().decode("utf-8", "ignore")
        err = stderr.read().decode("utf-8", "ignore")
        if out.strip():
            print(out.strip())
        if err.strip():
            print(err.strip())
    client.close()
    print("news scraper deployed — verify: curl -s https://api.quantalpha.space/news_feed.json | head")


if __name__ == "__main__":
    if not os.environ.get("SSH_PASS"):
        raise SystemExit("Set SSH_PASS env var")
    run()
