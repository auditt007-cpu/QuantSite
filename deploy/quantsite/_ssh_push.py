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
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=120)
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


def main():
    ssh = client()
    sftp = ssh.open_sftp()
    run(ssh, "mkdir -p /root/quantsite")
    sftp.put(os.path.join(HERE, "tg_engine.py"), "/root/quantsite/tg_engine.py")
    sftp.put(os.path.join(HERE, ".env"), "/root/quantsite/.env")
    sftp.put(os.path.join(HERE, "tg-bot.service"), "/etc/systemd/system/tg-bot.service")
    run(ssh, "chmod 755 /root/quantsite/tg_engine.py")
    run(ssh, "chmod 600 /root/quantsite/.env")
    run(ssh, "command -v python3")
    run(ssh, "python3 -m py_compile /root/quantsite/tg_engine.py")
    run(ssh, "systemctl daemon-reload")
    run(ssh, "systemctl enable tg-bot")
    run(ssh, "systemctl restart tg-bot")
    run(ssh, "sleep 2")
    run(ssh, "systemctl is-active tg-bot")
    run(ssh, "journalctl -u tg-bot -n 25 --no-pager")
    run(ssh, "ss -lntp 2>/dev/null | grep -E 'python|tg-bot' || echo 'no python/tg-bot listen sockets'")
    sftp.close()
    ssh.close()
    print("deploy ok")


if __name__ == "__main__":
    sys.exit(main())
