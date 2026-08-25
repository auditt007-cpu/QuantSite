# -*- coding: utf-8 -*-
from __future__ import annotations
import os
from pathlib import Path
import paramiko
from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[2]
load_dotenv(REPO / "deploy/quantsite/.env")
load_dotenv(REPO / ".env")

puts = [
    "bots.html",
    "strategies.html",
    "index.html",
    "live.html",
    "member.html",
    "about.html",
    "affiliate.html",
    "ai-backtest.html",
    "i18n.js",
    "strategies.json",
    "css/bots.css",
    "css/bloomberg-dark.css",
    "css/bloomberg-system.css",
    "css/plaza-cards.css",
    "css/mobile-subpages.css",
    "js/grid-backtest.js",
    "js/terminal.js",
    "js/plaza-ai.js",
    "js/compliance.js",
]

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(
    os.environ["SSH_HOST"],
    port=int(os.environ.get("SSH_PORT", "22")),
    username=os.environ.get("SSH_USER", "root"),
    password=os.environ["SSH_PASS"],
    timeout=45,
    allow_agent=False,
    look_for_keys=False,
)
sftp = ssh.open_sftp()
for rel in puts:
    local = REPO / rel
    if not local.exists():
        print("skip missing", rel)
        continue
    for root in ("/var/www/html", "/root/quantsite"):
        remote = root + "/" + rel.replace("\\", "/")
        ssh.exec_command("mkdir -p " + str(Path(remote).parent).replace("\\", "/"))
        sftp.put(str(local), remote)
        print("put", remote)
sftp.close()
ssh.close()
print("DONE")
