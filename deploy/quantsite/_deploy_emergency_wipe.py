# -*- coding: utf-8 -*-
"""Deploy emergency plaza wipe + UI fixes to VPS and run clean + Pages push."""
from __future__ import annotations

import os
import time
from pathlib import Path

import paramiko
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
load_dotenv(HERE / ".env")
load_dotenv(REPO / ".env")

puts = [
    ("scripts/emergency_clean_strategies.py", "/root/quantsite/scripts/emergency_clean_strategies.py"),
    ("scripts/plaza_hygiene.py", "/root/quantsite/scripts/plaza_hygiene.py"),
    ("scripts/idle_grid_miner.py", "/root/quantsite/scripts/idle_grid_miner.py"),
    ("llm_pipeline/__init__.py", "/root/quantsite/llm_pipeline/__init__.py"),
    ("pipeline.py", "/root/quantsite/pipeline.py"),
    ("js/terminal.js", "/root/quantsite/js/terminal.js"),
    ("js/plaza-ai.js", "/root/quantsite/js/plaza-ai.js"),
    ("js/terminal.js", "/var/www/html/js/terminal.js"),
    ("js/plaza-ai.js", "/var/www/html/js/plaza-ai.js"),
    ("strategies.html", "/var/www/html/strategies.html"),
    ("strategies.html", "/root/quantsite/strategies.html"),
]


def connect():
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
        banner_timeout=60,
    )
    return ssh


def put_all(ssh):
    for rel, remote in puts:
        for attempt in range(3):
            try:
                remote_dir = str(Path(remote).parent).replace("\\", "/")
                ssh.exec_command("mkdir -p " + remote_dir)
                time.sleep(0.2)
                sftp = ssh.open_sftp()
                try:
                    sftp.put(str(REPO / rel), remote)
                finally:
                    sftp.close()
                print("put", remote)
                break
            except Exception as exc:
                print("retry put", remote, attempt, exc)
                time.sleep(2)
                try:
                    ssh.close()
                except Exception:
                    pass
                ssh = connect()
        else:
            raise RuntimeError("failed put " + remote)
    return ssh


def run(ssh, cmd: str, timeout: int = 300) -> str:
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    if err.strip():
        print("ERR", err[-2000:])
    print(out[-5000:] if len(out) > 5000 else out)
    return out


def main() -> int:
    ssh = connect()
    ssh = put_all(ssh)
    run(ssh, "python3 -m py_compile /root/quantsite/scripts/emergency_clean_strategies.py /root/quantsite/llm_pipeline/__init__.py && echo COMPILE_OK")
    run(
        ssh,
        "cd /root/quantsite && set -a && . ./.env && set +a && python3 scripts/emergency_clean_strategies.py --push",
        timeout=600,
    )
    verify = (
        "python3 -c \""
        "import json; from pathlib import Path; "
        "ps=[Path('/root/quantsite/strategies.json'), Path('/var/www/html/strategies.json')]; "
        "[("
        "d:=json.loads(p.read_text(encoding='utf-8')), "
        "rows:=d.get('strategies') or [], "
        "plaza:=[r for r in rows if str(r.get('status','')).upper()=='INITIALIZING'], "
        "print(p, 'n=', len(rows), 'init=', len(plaza), 'name0=', (plaza[0].get('name') if plaza else None)), "
        "assert len(plaza)>=45, "
        "assert all(r.get('name') and r['name']!=r.get('id') for r in plaza)"
        ") for p in ps]; print('VERIFY_OK')\""
    )
    # Avoid walrus for older python — use simple script file instead
    remote_py = (
        "import json\n"
        "from pathlib import Path\n"
        "for p in [Path('/root/quantsite/strategies.json'), Path('/var/www/html/strategies.json')]:\n"
        "    d=json.loads(p.read_text(encoding='utf-8'))\n"
        "    rows=d.get('strategies') or []\n"
        "    plaza=[r for r in rows if str(r.get('status','')).upper()=='INITIALIZING']\n"
        "    print(p, 'n=', len(rows), 'init=', len(plaza), 'name0=', plaza[0].get('name') if plaza else None)\n"
        "    assert len(plaza)>=45\n"
        "    assert all(r.get('name') and r['name']!=r.get('id') for r in plaza)\n"
        "print('VERIFY_OK')\n"
    )
    sftp = ssh.open_sftp()
    with sftp.file("/tmp/verify_wipe.py", "w") as f:
        f.write(remote_py)
    sftp.close()
    run(ssh, "python3 /tmp/verify_wipe.py")
    ssh.close()
    print("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
