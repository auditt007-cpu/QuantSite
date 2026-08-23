# -*- coding: utf-8 -*-
"""One-shot SCP/SSH helper. Host/password come from env, never from git.

Default deploy is FAST: sftp files, compile-check, cron setup, restart the
tg-bot service, wait briefly for one poll cycle, verify + fetch live_feed.json
(and any welcome/signal MP3s generated so far). It intentionally does NOT run
the full multi-day leaderboard backtest or the multi-window hero scan.

To also refresh leaderboard.json (slow — 20 symbols x 45 strategies x 60 days),
pass --full-backtest explicitly:

    python _ssh_push.py --full-backtest

To run the heavier multi-window (3..180d) champion scan and merge
hero_highlight into leaderboard.json, pass --hero-scan explicitly:

    python _ssh_push.py --hero-scan

The daily cron job already chains both steps (see CRON_LINE) so this is only
needed to force an out-of-band refresh.
"""
import argparse
import os
import posixpath
import sys

import paramiko

HOST = os.environ["SSH_HOST"]
PORT = int(os.environ.get("SSH_PORT", "22"))
USER = os.environ.get("SSH_USER", "root")
PASSWORD = os.environ["SSH_PASS"]
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CRON_LINE = (
    "0 0 * * * /usr/bin/python3 /root/quantsite/calc_rankings.py --days 60 --full "
    "--hero-scan >> /root/quantsite/cron_calc.log 2>&1"
)


def client():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(
        HOST,
        port=PORT,
        username=USER,
        password=PASSWORD,
        timeout=30,
        allow_agent=False,
        look_for_keys=False,
    )
    return ssh


def run(ssh, cmd, timeout=60):
    print(">>", cmd, flush=True)
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        print(err, end="" if err.endswith("\n") else "\n")
    if code != 0:
        raise SystemExit("remote command failed (%s): %s" % (code, cmd))
    return out


def setup_cron(ssh):
    run(
        ssh,
        "(crontab -l 2>/dev/null | grep -Fv calc_rankings.py; echo '{0}') | crontab -".format(CRON_LINE),
    )
    run(ssh, "crontab -l | grep calc_rankings.py || true")


def fetch_audio_files(ssh, sftp):
    """Best-effort pull of every generated MP3 under /root/quantsite/audio/
    back into <repo>/audio/ so `git push` makes them reachable at
    https://quantalpha.space/audio/*.mp3 (GitHub Pages serves the repo root)."""
    local_dir = os.path.join(REPO_ROOT, "audio")
    os.makedirs(local_dir, exist_ok=True)
    try:
        names = sftp.listdir("/root/quantsite/audio")
    except Exception as exc:
        print("audio dir listing skip:", exc)
        return 0
    fetched = 0
    for name in names:
        if not name.endswith(".mp3"):
            continue
        try:
            sftp.get(
                posixpath.join("/root/quantsite/audio", name),
                os.path.join(local_dir, name),
            )
            fetched += 1
        except Exception as exc:
            print("audio fetch skip {0}: {1}".format(name, exc))
    print("fetched {0} audio file(s) -> {1}".format(fetched, local_dir))
    return fetched


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--full-backtest",
        action="store_true",
        help="Also run calc_rankings.py --days 60 --full to refresh leaderboard.json (slow, 20-40+ min). Off by default.",
    )
    parser.add_argument(
        "--hero-scan",
        action="store_true",
        help=(
            "Also run calc_rankings.py --hero-scan --hero-only (multi-window "
            "3..180d champion scan, merges hero_highlight into leaderboard.json). "
            "Off by default; generous timeout, does not block the fast deploy."
        ),
    )
    args = parser.parse_args()

    ssh = client()
    sftp = ssh.open_sftp()
    run(ssh, "mkdir -p /root/quantsite /root/quantsite/audio")
    sftp.put(os.path.join(HERE, "tg_engine.py"), "/root/quantsite/tg_engine.py")
    sftp.put(os.path.join(HERE, "calc_rankings.py"), "/root/quantsite/calc_rankings.py")
    sftp.put(os.path.join(HERE, ".env"), "/root/quantsite/.env")
    sftp.put(os.path.join(HERE, "tg-bot.service"), "/etc/systemd/system/tg-bot.service")
    run(ssh, "chmod 755 /root/quantsite/tg_engine.py /root/quantsite/calc_rankings.py")
    run(ssh, "chmod 600 /root/quantsite/.env")
    run(ssh, "command -v python3")
    run(
        ssh,
        "python3 -c 'import edge_tts' 2>/dev/null && echo 'edge-tts already installed' || "
        "(pip3 install --break-system-packages edge-tts 2>&1 || pip3 install edge-tts 2>&1)",
        timeout=180,
    )
    run(ssh, "python3 -c 'import edge_tts; print(\"edge_tts import ok\")'")
    run(ssh, "python3 -m py_compile /root/quantsite/tg_engine.py /root/quantsite/calc_rankings.py")
    setup_cron(ssh)

    run(ssh, "systemctl daemon-reload")
    run(ssh, "systemctl enable tg-bot")
    run(ssh, "systemctl restart tg-bot")
    run(ssh, "sleep 20")  # one lightweight live-feed pass + welcome-audio kickoff
    run(ssh, "systemctl is-active tg-bot")
    run(ssh, "journalctl -u tg-bot -n 40 --no-pager")
    run(
        ssh,
        "test -s /root/quantsite/live_feed.json && head -c 400 /root/quantsite/live_feed.json || echo 'live_feed missing'",
    )
    try:
        sftp.get("/root/quantsite/live_feed.json", os.path.join(REPO_ROOT, "live_feed.json"))
        print("fetched live_feed.json -> repo root")
    except Exception as exc:
        print("live_feed fetch skip:", exc)

    run(ssh, "ls -la /root/quantsite/audio/ 2>/dev/null || echo 'audio dir empty/missing'")
    fetch_audio_files(ssh, sftp)

    if args.full_backtest:
        # Opt-in only: 20-symbol x 45-strategy x 60-day backtest is slow.
        run(ssh, "python3 /root/quantsite/calc_rankings.py --days 60 --full", timeout=2700)
        run(
            ssh,
            "test -s /root/quantsite/leaderboard.json && head -c 400 /root/quantsite/leaderboard.json || echo 'leaderboard missing'",
        )
        try:
            sftp.get("/root/quantsite/leaderboard.json", os.path.join(REPO_ROOT, "leaderboard.json"))
            print("fetched leaderboard.json -> repo root")
        except Exception as exc:
            print("leaderboard fetch skip:", exc)
    else:
        print("skipped full leaderboard backtest (pass --full-backtest to run it)")

    if args.hero_scan:
        # Opt-in only: multi-window (3..180d) champion scan, heavier than a
        # single-period run but bounded (single 1h-only deep fetch, see
        # calc_rankings.py HERO_MAX_BARS). Generous timeout, run deliberately.
        run(ssh, "python3 /root/quantsite/calc_rankings.py --hero-scan --hero-only", timeout=1800)
        run(
            ssh,
            "python3 -c \"import json; d=json.load(open('/root/quantsite/leaderboard.json')); print(d.get('hero_highlight'))\"",
        )
        try:
            sftp.get("/root/quantsite/leaderboard.json", os.path.join(REPO_ROOT, "leaderboard.json"))
            print("fetched leaderboard.json (with hero_highlight) -> repo root")
        except Exception as exc:
            print("leaderboard fetch skip:", exc)
    else:
        print("skipped hero scan (pass --hero-scan to run it)")

    sftp.close()
    ssh.close()
    print("deploy ok")


if __name__ == "__main__":
    sys.exit(main())
