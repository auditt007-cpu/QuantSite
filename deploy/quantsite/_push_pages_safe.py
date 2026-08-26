# -*- coding: utf-8 -*-
"""Upload changed files from local repo to QuantSite-pages and git push (safe, no rsync --delete)."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import paramiko
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
load_dotenv(HERE / ".env")
load_dotenv(REPO / ".env")

PAGES = "/root/QuantSite-pages"
COMMIT_MSG = "feat: plain-language copy site-wide (人话版)"
# If empty, upload files from the latest commit.
COMMITS: tuple[str, ...] = ()


def safe_print(s: str) -> None:
    sys.stdout.buffer.write((s or "").encode("utf-8", "replace") + b"\n")
    sys.stdout.buffer.flush()


def changed_files() -> list[str]:
    if COMMITS:
        names: list[str] = []
        for commit in COMMITS:
            proc = subprocess.run(
                ["git", "diff-tree", "--no-commit-id", "--name-only", "-r", commit],
                cwd=REPO,
                capture_output=True,
                text=True,
                check=True,
            )
            for line in proc.stdout.splitlines():
                line = line.strip()
                if line and line not in names:
                    names.append(line)
        return names
    proc = subprocess.run(
        ["git", "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    )
    return [line.strip() for line in proc.stdout.splitlines() if line.strip()]


def sftp_mkdirs(sftp: paramiko.SFTPClient, remote_path: str) -> None:
    parts = remote_path.replace("\\", "/").split("/")
    cur = ""
    for part in parts:
        if not part:
            continue
        cur = cur + "/" + part if cur else part
        if cur == "/root" or cur == "/root/QuantSite-pages":
            continue
        try:
            sftp.stat(cur)
        except OSError:
            try:
                sftp.mkdir(cur)
            except OSError:
                pass


def main() -> None:
    files = changed_files()
    safe_print("upload %d file(s)" % len(files))

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

    for rel in files:
        local = REPO / rel
        if not local.is_file():
            safe_print("skip missing " + rel)
            continue
        remote = PAGES + "/" + rel.replace("\\", "/")
        sftp_mkdirs(sftp, os.path.dirname(remote))
        sftp.put(str(local), remote)
        safe_print("put " + rel)
    sftp.close()

    cmd = (
        "cd %s && rm -f .git/index.lock && git add -A && git status --short | head -40 && "
        "git diff --cached --quiet || (git commit -m %s && git push origin main)"
        % (PAGES, repr(COMMIT_MSG))
    )
    safe_print(">> " + cmd[:180])
    _, stdout, stderr = ssh.exec_command(cmd, timeout=180)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if out:
        safe_print(out)
    if err:
        safe_print(err)
    if code != 0:
        raise SystemExit("remote failed (%s)" % code)
    ssh.close()
    safe_print("github push ok")


if __name__ == "__main__":
    main()
