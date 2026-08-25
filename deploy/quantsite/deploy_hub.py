# -*- coding: utf-8 -*-
"""Push hub + pipeline to the existing VPS (/root/quantsite + /var/www/html)."""
from __future__ import annotations

import os
import posixpath
import sys
from pathlib import Path

import paramiko
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
load_dotenv(HERE / ".env")
load_dotenv(REPO / ".env")

HOST = os.environ["SSH_HOST"]
PORT = int(os.environ.get("SSH_PORT", "22"))
USER = os.environ.get("SSH_USER", "root")
PASSWORD = os.environ["SSH_PASS"]
REMOTE_APP = "/root/quantsite"
REMOTE_WWW = "/var/www/html"


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


def run(ssh, cmd, timeout=120):
    print(">>", cmd, flush=True)
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        print(err, end="" if err.endswith("\n") else "\n")
    if code != 0:
        raise SystemExit("remote failed (%s): %s" % (code, cmd))
    return out


def sftp_mkdirs(sftp, path):
    parts = []
    cur = path
    while cur not in ("/", ""):
        parts.append(cur)
        cur = posixpath.dirname(cur)
    for p in reversed(parts):
        try:
            sftp.stat(p)
        except OSError:
            sftp.mkdir(p)


def sftp_put(sftp, local: Path, remote: str):
    sftp_mkdirs(sftp, posixpath.dirname(remote))
    sftp.put(str(local), remote)
    print("put", local.relative_to(REPO), "->", remote, flush=True)


def merge_env_remote(ssh, sftp):
    tmp = posixpath.join(REMOTE_APP, ".env.hubnew")
    sftp_put(sftp, REPO / ".env", tmp)
    helper = REPO / "deploy" / "quantsite" / "_merge_env.py"
    remote_helper = posixpath.join(REMOTE_APP, "deploy/quantsite/_merge_env.py")
    sftp_put(sftp, helper, remote_helper)
    run(ssh, "python3 {0} {1}/.env {2}".format(remote_helper, REMOTE_APP, tmp))
    run(ssh, "chmod 600 {0}/.env".format(REMOTE_APP))


def patch_nginx(ssh):
    sftp_put_via = posixpath.join(REMOTE_APP, "deploy/quantsite/nginx-hub.conf")
    run(ssh, "install -m 0644 {0} /etc/nginx/snippets/quant-hub.conf".format(sftp_put_via))
    run(
        ssh,
        "python3 - <<'PY'\n"
        "from pathlib import Path\n"
        "needle = 'include snippets/quant-hub.conf;'\n"
        "cands = list(Path('/etc/nginx/sites-enabled').glob('*')) + list(Path('/etc/nginx/conf.d').glob('*.conf'))\n"
        "cands = [p for p in cands if p.is_file()]\n"
        "patched = False\n"
        "for p in cands:\n"
        "    t = p.read_text(encoding='utf-8', errors='replace')\n"
        "    if 'server_name' not in t and 'listen' not in t:\n"
        "        continue\n"
        "    if needle in t:\n"
        "        print('nginx_already', str(p))\n"
        "        patched = True\n"
        "        break\n"
        "    idx = t.rfind('}')\n"
        "    if idx < 0:\n"
        "        continue\n"
        "    t = t[:idx] + '    ' + needle + '\\n' + t[idx:]\n"
        "    p.write_text(t, encoding='utf-8')\n"
        "    print('nginx_patched', str(p))\n"
        "    patched = True\n"
        "    break\n"
        "if not patched:\n"
        "    raise SystemExit('no nginx server block found')\n"
        "PY",
    )
    run(ssh, "nginx -t && systemctl reload nginx")


def main():
    ssh = client()
    sftp = ssh.open_sftp()
    print("== remote preflight ==", flush=True)
    run(ssh, "python3 --version")
    run(
        ssh,
        "python3 - <<'PY'\n"
        "import socket\n"
        "s=socket.socket(); s.settimeout(1)\n"
        "try:\n"
        "    s.bind(('127.0.0.1', 8088)); print('port_8088 free'); s.close()\n"
        "except OSError:\n"
        "    print('port_8088 in_use')\n"
        "PY",
    )
    run(
        ssh,
        "mkdir -p {0}/data {0}/static/charts {0}/hub {0}/llm_pipeline {0}/scripts {0}/deploy/quantsite "
        "{1}/static/charts {1}/js && "
        "touch {0}/data/.w {0}/static/charts/.w {1}/static/charts/.w && rm -f {0}/data/.w {0}/static/charts/.w {1}/static/charts/.w && "
        "echo dirs_ok".format(REMOTE_APP, REMOTE_WWW),
    )

    py_files = [
        "bot_server.py",
        "pipeline.py",
        "requirements.txt",
        "hub/__init__.py",
        "hub/settings.py",
        "hub/db.py",
        "hub/capi.py",
        "hub/notify.py",
        "hub/handlers.py",
        "llm_pipeline/__init__.py",
        "llm_pipeline/sandbox.py",
        "llm_pipeline/market.py",
        "llm_pipeline/backtest.py",
        "llm_pipeline/charts.py",
        "llm_pipeline/publish.py",
        "scripts/run_pipeline_cron.sh",
        "scripts/install_hub.sh",
        "scripts/ops_watch.py",
        "scripts/plaza_hygiene.py",
        "scripts/daily_desk.sh",
        "utils/__init__.py",
        "utils/git_sync.py",
        "deploy/quantsite/quant-hub.service",
        "deploy/quantsite/nginx-hub.conf",
        "deploy/quantsite/tg_engine.py",
        "deploy/quantsite/calc_rankings.py",
    ]
    web_files = [
        "js/lead-bind.js",
        "js/plaza-ai.js",
        "js/terminal.js",
        "js/home-boards.js",
        "config.js",
        "index.html",
        "live.html",
        "terminal.html",
        "strategies.html",
        "member.html",
        "affiliate.html",
    ]
    for rel in py_files:
        sftp_put(sftp, REPO / rel, posixpath.join(REMOTE_APP, rel.replace("\\", "/")))
    sftp_put(sftp, REPO / "deploy/quantsite/tg_engine.py", posixpath.join(REMOTE_APP, "tg_engine.py"))
    sftp_put(sftp, REPO / "deploy/quantsite/calc_rankings.py", posixpath.join(REMOTE_APP, "calc_rankings.py"))
    for rel in web_files:
        sftp_put(sftp, REPO / rel, posixpath.join(REMOTE_WWW, rel.replace("\\", "/")))

    merge_env_remote(ssh, sftp)
    run(
        ssh,
        "chmod +x {0}/scripts/run_pipeline_cron.sh {0}/scripts/install_hub.sh "
        "{0}/scripts/daily_desk.sh {0}/scripts/ops_watch.py {0}/scripts/plaza_hygiene.py".format(REMOTE_APP),
    )
    run(
        ssh,
        "python3 -m pip install -q -r {0}/requirements.txt".format(REMOTE_APP),
        timeout=300,
    )
    run(ssh, "python3 -m py_compile {0}/bot_server.py {0}/pipeline.py {0}/hub/db.py {0}/hub/handlers.py".format(REMOTE_APP))
    run(ssh, "install -m 0644 {0}/deploy/quantsite/quant-hub.service /etc/systemd/system/quant-hub.service".format(REMOTE_APP))
    patch_nginx(ssh)
    run(
        ssh,
        "(crontab -l 2>/dev/null | grep -v run_pipeline_cron.sh | grep -v calc_rankings.py | grep -v ops_watch.py | grep -v daily_desk.sh; "
        "echo '0 2,8,14,20 * * * {0}/scripts/run_pipeline_cron.sh >> /var/log/quant-pipeline.log 2>&1'; "
        "echo '0 0 * * * {0}/scripts/daily_desk.sh'; "
        "echo '0 * * * * /usr/bin/python3 {0}/scripts/ops_watch.py >> /var/log/quant-ops-watch.log 2>&1') | crontab -".format(REMOTE_APP),
    )
    run(ssh, "crontab -l | grep -E 'pipeline|daily_desk|ops_watch' || true")
    run(ssh, "systemctl daemon-reload && systemctl enable quant-hub && systemctl restart quant-hub")
    run(ssh, "sleep 2 && systemctl is-active quant-hub && curl -sS http://127.0.0.1:8088/health")
    run(
        ssh,
        "cd {0} && python3 - <<'PY'\n"
        "from hub import db\n"
        "from hub.handlers import extract_token, welcome_text\n"
        "db.init_db()\n"
        "row = db.upsert_lead('VIP8921', 'fbclid_smoke_test')\n"
        "print('sqlite_token', row['token'])\n"
        "print('sqlite_status', row['status'])\n"
        "print('sqlite_fbclid', bool(row.get('fbclid')))\n"
        "got = db.get_by_token('VIP8921')\n"
        "print('sqlite_roundtrip', got['token'] == 'VIP8921')\n"
        "print('token_bind', extract_token('bind') == '')\n"
        "print('token_start', extract_token('start') == '')\n"
        "print('token_empty', extract_token('') == '')\n"
        "print('token_vip', extract_token('VIP8921') == 'VIP8921')\n"
        "print('token_digits', extract_token('4821') == '')\n"
        "from hub.handlers import classify_entry\n"
        "print('lane_bind', classify_entry('bind') == 'web_otp')\n"
        "print('lane_start_bind', classify_entry('/start bind') == 'web_otp')\n"
        "print('lane_digits', classify_entry('4821') == 'web_otp')\n"
        "print('lane_vip', classify_entry('VIP8921') == 'meta_vip')\n"
        "print('lane_start_vip', classify_entry('/start VIP8921') == 'meta_vip')\n"
        "print('lane_empty_start', classify_entry('/start') == 'none')\n"
        "print('welcome_zh', '歡迎' in welcome_text())\n"
        "PY".format(REMOTE_APP),
    )
    run(ssh, "sed -i 's/\\r$//' {0}/scripts/run_pipeline_cron.sh {0}/scripts/daily_desk.sh && chmod +x {0}/scripts/run_pipeline_cron.sh {0}/scripts/daily_desk.sh {0}/tg_engine.py {0}/calc_rankings.py".format(REMOTE_APP))
    run(ssh, "python3 -m py_compile {0}/tg_engine.py".format(REMOTE_APP))
    run(ssh, "systemctl restart tg-bot; sleep 1; systemctl is-active tg-bot || systemctl is-active tg-bot.service || true")
    run(
        ssh,
        "python3 - <<'PY'\n"
        "import json\n"
        "from pathlib import Path\n"
        "p=Path('/var/www/html/strategies.json')\n"
        "print('www_json', p.is_file())\n"
        "if p.is_file():\n"
        "    d=json.loads(p.read_text(encoding='utf-8'))\n"
        "    rows=d.get('strategies') or []\n"
        "    print('count', len(rows))\n"
        "    print('top_name', (rows[0].get('title') or rows[0].get('name')) if rows else None)\n"
        "PY",
    )
    sftp.close()
    ssh.close()
    print("deploy ok")


if __name__ == "__main__":
    sys.exit(main())
