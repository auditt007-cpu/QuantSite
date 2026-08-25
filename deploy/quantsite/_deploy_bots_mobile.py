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
    ("bots.html", "/var/www/html/bots.html"),
    ("bots.html", "/root/quantsite/bots.html"),
    ("css/bots.css", "/var/www/html/css/bots.css"),
    ("css/bots.css", "/root/quantsite/css/bots.css"),
    ("i18n.js", "/var/www/html/i18n.js"),
    ("i18n.js", "/root/quantsite/i18n.js"),
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
for rel, remote in puts:
    ssh.exec_command("mkdir -p " + str(Path(remote).parent).replace("\\", "/"))
    sftp.put(str(REPO / rel), remote)
    print("put", remote)
sftp.close()
ssh.close()
print("DONE")
