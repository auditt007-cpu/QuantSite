# -*- coding: utf-8 -*-
from __future__ import annotations
import os
from pathlib import Path
import paramiko
from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[2]
load_dotenv(REPO / "deploy/quantsite/.env")
load_dotenv(REPO / ".env")

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
local = REPO / "static" / "charts"
for dest in ("/var/www/html/static/charts", "/root/quantsite/static/charts"):
    ssh.exec_command("mkdir -p " + dest)
    for p in sorted(local.glob("*.svg")):
        remote = dest + "/" + p.name
        sftp.put(str(p), remote)
        print("put", remote)
sftp.put(str(REPO / "llm_pipeline" / "synthetic_equity.py"), "/root/quantsite/llm_pipeline/synthetic_equity.py")
print("put synthetic_equity.py")
sftp.close()
ssh.close()
print("DONE")
