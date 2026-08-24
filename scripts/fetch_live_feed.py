# -*- coding: utf-8 -*-
"""Pull the VPS-generated live_feed.json into the repo root.

Used by the sync_live_feed GitHub Action so the static site (GitHub Pages)
reflects the tg-bot engine's execution tape without a manual deploy. Host
credentials come from repo secrets (SSH_HOST/PORT/USER/PASS), never from git.
"""
import os
import sys

import paramiko

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, ".."))
REMOTE_PATH = "/root/quantsite/live_feed.json"
LOCAL_PATH = os.path.join(REPO_ROOT, "live_feed.json")


def main():
    host = os.environ["SSH_HOST"]
    port = int(os.environ.get("SSH_PORT", "22"))
    user = os.environ.get("SSH_USER", "root")
    password = os.environ["SSH_PASS"]

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(
        host,
        port=port,
        username=user,
        password=password,
        timeout=30,
        allow_agent=False,
        look_for_keys=False,
    )
    sftp = ssh.open_sftp()
    sftp.get(REMOTE_PATH, LOCAL_PATH)
    sftp.close()
    ssh.close()
    print("fetched {0} -> {1}".format(REMOTE_PATH, LOCAL_PATH))


if __name__ == "__main__":
    sys.exit(main())
