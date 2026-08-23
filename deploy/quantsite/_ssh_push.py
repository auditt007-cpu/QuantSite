# -*- coding: utf-8 -*-
"""One-shot SCP/SSH helper. Host/password come from env, never from git."""
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
CRON_LINE = "0 0 * * * /usr/bin/python3 /root/quantsite/calc_rankings.py --days 60 --full >> /root/quantsite/cron_calc.log 2>&1"


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


def run(ssh, cmd):
    print(">>", cmd, flush=True)
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=900)
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


def main():
    ssh = client()
    sftp = ssh.open_sftp()
    run(ssh, "mkdir -p /root/quantsite")
    sftp.put(os.path.join(HERE, "tg_engine.py"), "/root/quantsite/tg_engine.py")
    sftp.put(os.path.join(HERE, "calc_rankings.py"), "/root/quantsite/calc_rankings.py")
    sftp.put(os.path.join(HERE, ".env"), "/root/quantsite/.env")
    sftp.put(os.path.join(HERE, "tg-bot.service"), "/etc/systemd/system/tg-bot.service")
    run(ssh, "chmod 755 /root/quantsite/tg_engine.py /root/quantsite/calc_rankings.py")
    run(ssh, "chmod 600 /root/quantsite/.env")
    run(ssh, "command -v python3")
    run(ssh, "python3 -m py_compile /root/quantsite/tg_engine.py /root/quantsite/calc_rankings.py")
    setup_cron(ssh)
    run(ssh, "python3 /root/quantsite/calc_rankings.py --days 60 --full")
    run(ssh, "test -s /root/quantsite/leaderboard.json && head -c 400 /root/quantsite/leaderboard.json || echo 'leaderboard missing'")
    run(ssh, "systemctl daemon-reload")
    run(ssh, "systemctl enable tg-bot")
    run(ssh, "systemctl restart tg-bot")
    run(ssh, "sleep 2")
    run(ssh, "systemctl is-active tg-bot")
    run(ssh, "journalctl -u tg-bot -n 20 --no-pager")
    try:
        sftp.get("/root/quantsite/leaderboard.json", os.path.join(REPO_ROOT, "leaderboard.json"))
        print("fetched leaderboard.json -> repo root")
    except Exception as exc:
        print("leaderboard fetch skip:", exc)
    sftp.close()
    ssh.close()
    print("deploy ok")


if __name__ == "__main__":
    sys.exit(main())
