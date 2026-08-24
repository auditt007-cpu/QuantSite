#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Push live_feed.json to GitHub when it changes (deploy-key mirror clone).

Installed on VPS as /root/quantsite/push_live_feed.py and run via cron each minute.
Requires:
  - SSH deploy key at /root/.ssh/quantsite_deploy (write access to the repo)
  - Shallow mirror clone at /root/quantsite_gh_mirror
"""
import os
import subprocess
import hashlib
import json
from datetime import datetime, timezone

SRC = "/root/quantsite/live_feed.json"
MIRROR = "/root/quantsite_gh_mirror"
MARKER = "/root/quantsite/.live_feed_push_hash"
LOG = "/root/quantsite/feed_push.log"
KEY = "/root/.ssh/quantsite_deploy"


def log(msg):
    line = "[{0}] {1}".format(datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"), msg)
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def sh(cmd, cwd=None, check=True):
    env = os.environ.copy()
    env["GIT_SSH_COMMAND"] = "ssh -i {0} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new".format(KEY)
    p = subprocess.run(cmd, cwd=cwd, env=env, shell=True, capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError("cmd failed ({0}): {1}\n{2}\n{3}".format(p.returncode, cmd, p.stdout, p.stderr))
    return p


def file_hash(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    if not os.path.isfile(SRC):
        log("missing " + SRC)
        return 1
    digest = file_hash(SRC)
    prev = ""
    if os.path.isfile(MARKER):
        prev = open(MARKER, "r", encoding="utf-8").read().strip()
    if digest == prev:
        return 0

    if not os.path.isdir(os.path.join(MIRROR, ".git")):
        log("mirror missing, skip")
        return 1

    sh("git fetch origin main", cwd=MIRROR)
    sh("git checkout -B main origin/main", cwd=MIRROR)
    dest = os.path.join(MIRROR, "live_feed.json")
    with open(SRC, "rb") as s, open(dest, "wb") as d:
        d.write(s.read())

    st = sh("git status --porcelain live_feed.json", cwd=MIRROR, check=False)
    if not st.stdout.strip():
        open(MARKER, "w", encoding="utf-8").write(digest)
        log("no git diff after copy")
        return 0

    try:
        meta = json.load(open(SRC, encoding="utf-8"))
        upd = meta.get("updated_at") or "unknown"
    except Exception:
        upd = "unknown"

    sh("git add live_feed.json", cwd=MIRROR)
    # Do not use [skip ci] — GitHub Pages must rebuild so live.html sees fresh feed.
    sh(
        'git -c user.email="bot@quantalpha.space" -c user.name="QuantAlpha Live Feed Bot" '
        'commit -m "chore: sync live_feed.json from VPS"',
        cwd=MIRROR,
    )
    sh("git push origin main", cwd=MIRROR)
    open(MARKER, "w", encoding="utf-8").write(digest)
    log("pushed live_feed.json updated_at=" + str(upd))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log("ERROR: " + str(exc))
        raise SystemExit(1)
