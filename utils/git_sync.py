# -*- coding: utf-8 -*-
"""Whitelist-only GitHub Pages sync. Never uses PAT; deploy-key SSH only."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Set

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from hub.settings import CHARTS_DIR, ROOT as APP_ROOT, STRATEGIES_JSON  # noqa: E402

DEFAULT_PAGES_REPO = "/root/QuantSite-pages"
DEFAULT_SSH_KEY = str(Path.home() / ".ssh" / "github_deploy_key")
DEFAULT_REMOTE = "git@github.com-quantsite:auditt007-cpu/QuantSite.git"
BRANCH = "main"

# Explicit public artifact whitelist (no git add -A / git add .).
ALLOWED_EXACT = frozenset(
    {
        "strategies.json",
        "leaderboard.json",
        "live_feed.json",
        "data/signals.json",
        "static/charts/.gitkeep",
    }
)
ALLOWED_GLOB = (
    re.compile(r"^static/charts/ai_[A-Za-z0-9_.-]+\.svg$"),
)


def _enabled() -> bool:
    raw = (os.environ.get("GIT_PAGES_SYNC") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


def pages_repo() -> Path:
    return Path(os.environ.get("GIT_PAGES_REPO") or DEFAULT_PAGES_REPO)


def ssh_key() -> Path:
    return Path(os.environ.get("GIT_SSH_KEY") or DEFAULT_SSH_KEY)


def remote_url() -> str:
    return (os.environ.get("GIT_PAGES_REMOTE") or DEFAULT_REMOTE).strip()


def is_allowed(rel: str) -> bool:
    rel = rel.replace("\\", "/").lstrip("./")
    if rel in ALLOWED_EXACT:
        return True
    return any(p.match(rel) for p in ALLOWED_GLOB)


def _git_env() -> dict:
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_ASKPASS"] = "true"
    env["GCM_INTERACTIVE"] = "never"
    key = ssh_key().as_posix()
    env["GIT_SSH_COMMAND"] = (
        "ssh -i {0} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes "
        "-o BatchMode=yes -o PreferredAuthentications=publickey"
    ).format(key)
    return env


def _run(args: Sequence[str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess:
    print("[pages] {0}".format(" ".join(args)), flush=True)
    if any(a in (".", "-A", "--all") for a in args[1:]):
        raise RuntimeError("refusing broad git add: {0}".format(args))
    proc = subprocess.run(
        list(args),
        cwd=str(cwd),
        env=_git_env(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if proc.stdout:
        sys.stdout.write(proc.stdout if proc.stdout.endswith("\n") else proc.stdout + "\n")
    if proc.stderr:
        sys.stderr.write(proc.stderr if proc.stderr.endswith("\n") else proc.stderr + "\n")
    if check and proc.returncode != 0:
        raise RuntimeError("git failed ({0}): {1}".format(proc.returncode, " ".join(args)))
    return proc


def _ensure_identity(repo: Path) -> None:
    name = _run(["git", "config", "--get", "user.name"], repo, check=False)
    email = _run(["git", "config", "--get", "user.email"], repo, check=False)
    if (name.stdout or "").strip() != "Quant-Auto-Bot":
        _run(["git", "config", "user.name", "Quant-Auto-Bot"], repo)
    if (email.stdout or "").strip() != "bot@quantalpha.space":
        _run(["git", "config", "user.email", "bot@quantalpha.space"], repo)
    _run(["git", "config", "commit.gpgsign", "false"], repo, check=False)


def _normalize_rel(path: Path, repo: Path) -> str:
    try:
        return path.resolve().relative_to(repo.resolve()).as_posix()
    except ValueError:
        return path.as_posix().replace("\\", "/").lstrip("./")


def _seed_default_artifacts(repo: Path) -> List[str]:
    written: List[str] = []
    json_src = STRATEGIES_JSON if STRATEGIES_JSON.is_file() else APP_ROOT / "strategies.json"
    if json_src.is_file():
        dest = repo / "strategies.json"
        shutil.copy2(json_src, dest)
        written.append("strategies.json")
    charts_dest = repo / "static" / "charts"
    charts_dest.mkdir(parents=True, exist_ok=True)
    keep = charts_dest / ".gitkeep"
    if not keep.is_file():
        keep.write_text("", encoding="utf-8")
    seen: Set[str] = set()
    for folder in (CHARTS_DIR, APP_ROOT / "static" / "charts"):
        if not folder.is_dir():
            continue
        for svg in sorted(folder.glob("ai_*.svg")):
            if svg.name in seen:
                continue
            seen.add(svg.name)
            target = charts_dest / svg.name
            shutil.copy2(svg, target)
            written.append("static/charts/{0}".format(svg.name))
    lb = Path("/var/www/html/leaderboard.json")
    if not lb.is_file():
        lb = APP_ROOT / "leaderboard.json"
    if lb.is_file():
        shutil.copy2(lb, repo / "leaderboard.json")
        written.append("leaderboard.json")
    feed = Path("/var/www/html/live_feed.json")
    if not feed.is_file():
        feed = APP_ROOT / "live_feed.json"
    if feed.is_file():
        shutil.copy2(feed, repo / "live_feed.json")
        written.append("live_feed.json")
    sig = Path("/var/www/html/data/signals.json")
    if not sig.is_file():
        sig = APP_ROOT / "data" / "signals.json"
    if sig.is_file():
        (repo / "data").mkdir(parents=True, exist_ok=True)
        shutil.copy2(sig, repo / "data" / "signals.json")
        written.append("data/signals.json")
    return written


def _resolve_push_list(repo: Path, files_to_push: Optional[Iterable[str]]) -> List[str]:
    if files_to_push is None:
        seeded = _seed_default_artifacts(repo)
        files = seeded or ["strategies.json"]
    else:
        # Always refresh default strategies.json + charts from VPS sources first.
        _seed_default_artifacts(repo)
        files = []
        for raw in files_to_push:
            rel = str(raw).replace("\\", "/").lstrip("./")
            src = Path(raw)
            if src.is_file() and src.suffix.lower() in (".json", ".svg"):
                if src.name == "strategies.json":
                    rel = "strategies.json"
                    shutil.copy2(src, repo / rel)
                elif src.suffix.lower() == ".svg":
                    rel = "static/charts/{0}".format(src.name)
                    (repo / "static" / "charts").mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, repo / rel)
                elif src.name == "leaderboard.json":
                    rel = "leaderboard.json"
                    shutil.copy2(src, repo / rel)
                elif src.name == "live_feed.json" or rel == "live_feed.json":
                    rel = "live_feed.json"
                    cand = src if src.is_file() else Path("/var/www/html/live_feed.json")
                    if not cand.is_file():
                        cand = APP_ROOT / "live_feed.json"
                    if cand.is_file():
                        shutil.copy2(cand, repo / rel)
                elif rel == "data/signals.json" or src.name == "signals.json":
                    rel = "data/signals.json"
                    cand = src if src.is_file() else Path("/var/www/html/data/signals.json")
                    if not cand.is_file():
                        cand = APP_ROOT / "data" / "signals.json"
                    if cand.is_file():
                        (repo / "data").mkdir(parents=True, exist_ok=True)
                        shutil.copy2(cand, repo / rel)
            elif rel.startswith("static/charts/") and not (repo / rel).is_file():
                name = Path(rel).name
                for folder in (CHARTS_DIR, APP_ROOT / "static" / "charts", Path("/var/www/html/static/charts")):
                    candidate = folder / name
                    if candidate.is_file():
                        (repo / "static" / "charts").mkdir(parents=True, exist_ok=True)
                        shutil.copy2(candidate, repo / rel)
                        break
            files.append(rel)
    out: List[str] = []
    for rel in files:
        rel = rel.replace("\\", "/").lstrip("./")
        if not is_allowed(rel):
            raise RuntimeError("refusing non-whitelisted path: {0}".format(rel))
        if not (repo / rel).is_file():
            print("[pages] skip missing {0}".format(rel), flush=True)
            continue
        out.append(rel)
    # de-dupe preserve order
    seen: Set[str] = set()
    uniq = []
    for r in out:
        if r not in seen:
            seen.add(r)
            uniq.append(r)
    return uniq


def _prefer_local_snapshots(repo: Path, snapshots: dict) -> None:
    for rel, blob in snapshots.items():
        dest = repo / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(blob)


def sync_to_github(
    files_to_push: Optional[Iterable[str]] = None,
    commit_msg: Optional[str] = None,
    *,
    allow_empty: bool = False,
) -> str:
    """Atomically sync whitelisted public assets to GitHub Pages."""
    if not _enabled():
        print("[pages] skipped GIT_PAGES_SYNC=0", flush=True)
        return "skipped"
    repo = pages_repo()
    if not (repo / ".git").is_dir():
        raise RuntimeError("GitHub Pages clone missing: {0}".format(repo))
    if not ssh_key().is_file():
        raise RuntimeError("deploy key missing: {0}".format(ssh_key()))

    _ensure_identity(repo)
    _run(["git", "remote", "set-url", "origin", remote_url()], repo)
    _run(["git", "fetch", "origin", BRANCH], repo)
    _run(["git", "checkout", BRANCH], repo, check=False)

    paths = _resolve_push_list(repo, files_to_push)
    if not paths and not allow_empty:
        print("[pages] nothing to sync", flush=True)
        return "empty"

    # Snapshot VPS-local bytes before rebase so we can re-apply if needed.
    snapshots = {rel: (repo / rel).read_bytes() for rel in paths if (repo / rel).is_file()}

    pull = _run(
        ["git", "pull", "--rebase", "--autostash", "origin", BRANCH],
        repo,
        check=False,
    )
    pull_text = "{0}\n{1}".format(pull.stdout or "", pull.stderr or "")
    if pull.returncode != 0 or "resulted in conflicts" in pull_text:
        print("[pages] rebase conflict — prefer VPS local assets", flush=True)
        _run(["git", "rebase", "--abort"], repo, check=False)
        _run(["git", "reset", "--hard", "origin/{0}".format(BRANCH)], repo)
        _run(["git", "stash", "drop"], repo, check=False)
        _prefer_local_snapshots(repo, snapshots)
    else:
        # Re-apply VPS artifacts after rebase so Pages always reflects latest mine.
        _prefer_local_snapshots(repo, snapshots)

    # -f: Pages clone gitignores data/, but data/signals.json is a public artifact.
    _run(["git", "add", "-f", "--"] + paths, repo)
    dirty = _run(["git", "diff", "--cached", "--quiet"], repo, check=False)
    if dirty.returncode == 0 and not allow_empty:
        print("[pages] no artifact changes", flush=True)
        _run(["git", "push", "origin", BRANCH], repo)
        return "up-to-date"

    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    msg = commit_msg or "Auto: Update new AI strategies [{0}]".format(stamp)
    commit_args = ["git", "commit", "-m", msg]
    if dirty.returncode == 0 and allow_empty:
        commit_args.insert(2, "--allow-empty")
    _run(commit_args, repo)
    push = _run(["git", "push", "origin", BRANCH], repo, check=False)
    if push.returncode != 0:
        # one more rebase-then-push cycle
        _run(["git", "pull", "--rebase", "origin", BRANCH], repo, check=False)
        for rel, blob in snapshots.items():
            (repo / rel).write_bytes(blob)
        _run(["git", "add", "-f", "--"] + paths, repo)
        if _run(["git", "diff", "--cached", "--quiet"], repo, check=False).returncode != 0:
            _run(["git", "commit", "-m", msg], repo, check=False)
        _run(["git", "push", "origin", BRANCH], repo)
    print("[pages] pushed {0}".format(msg), flush=True)
    return "pushed"


def main() -> int:
    allow_empty = "--verify" in sys.argv
    try:
        status = sync_to_github(allow_empty=allow_empty)
    except Exception as exc:
        print("[pages] ERROR {0}".format(exc), flush=True)
        return 1
    print("[pages] done {0}".format(status), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
