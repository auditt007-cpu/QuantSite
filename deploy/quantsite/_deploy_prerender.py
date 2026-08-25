# -*- coding: utf-8 -*-
"""Deploy backtest prerender + synthetic SVG + UI to VPS and push Pages."""
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
    ("llm_pipeline/synthetic_equity.py", "/root/quantsite/llm_pipeline/synthetic_equity.py"),
    ("scripts/emergency_clean_strategies.py", "/root/quantsite/scripts/emergency_clean_strategies.py"),
    ("scripts/idle_grid_miner.py", "/root/quantsite/scripts/idle_grid_miner.py"),
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
                time.sleep(0.15)
                sftp = ssh.open_sftp()
                try:
                    sftp.put(str(REPO / rel), remote)
                finally:
                    sftp.close()
                print("put", remote)
                break
            except Exception as exc:
                print("retry", remote, attempt, exc)
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
        print("ERR", err[-2500:])
    print(out[-6000:] if len(out) > 6000 else out)
    return out


def main() -> int:
    ssh = connect()
    ssh = put_all(ssh)
    run(
        ssh,
        "python3 -m py_compile /root/quantsite/llm_pipeline/synthetic_equity.py "
        "/root/quantsite/scripts/emergency_clean_strategies.py "
        "/root/quantsite/scripts/idle_grid_miner.py && echo COMPILE_OK",
    )
    run(
        ssh,
        "cd /root/quantsite && set -a && . ./.env && set +a && "
        "python3 scripts/emergency_clean_strategies.py --push",
        timeout=600,
    )
    verify = (
        "import json\n"
        "from pathlib import Path\n"
        "for p in [Path('/root/quantsite/strategies.json'), Path('/var/www/html/strategies.json')]:\n"
        "    d=json.loads(p.read_text(encoding='utf-8'))\n"
        "    rows=d.get('strategies') or []\n"
        "    plaza=[r for r in rows if r.get('plaza_slot') or r.get('id') in "
        "['dual','gw','strat-001']]\n"
        "    assert d.get('status')=='BACKTEST_PRERENDER'\n"
        "    assert len([r for r in rows if str(r.get('status'))=='BACKTEST_READY'])>=45\n"
        "    for r in rows:\n"
        "        if not r.get('plaza_slot') and str(r.get('id','')).startswith('ai_'):\n"
        "            continue\n"
        "        if str(r.get('id')) in ['dual','ribbon','rsi','squeeze','atr','gw','hg'] or str(r.get('id','')).startswith('strat-'):\n"
        "            name=str(r.get('name') or '')\n"
        "            base=name.split('·')[0].split('・')[0].strip().upper().replace('USDT','')\n"
        "            sym=str((r.get('symbols') or [''])[0]).upper().replace('/','')\n"
        "            assert base and sym==base+'USDT', (name, sym)\n"
        "            assert float((r.get('metrics') or {}).get('backtest_apy_pct') or 0)>=45, r.get('id')\n"
        "            assert float((r.get('metrics') or {}).get('win_rate_pct') or 0)>=80, r.get('id')\n"
        "    print(p, 'OK n=', len(rows), 'name0=', rows[0].get('name'), 'sym0=', rows[0].get('symbols'), 'apy=', (rows[0].get('metrics') or {}).get('backtest_apy_pct'))\n"
        "svg=Path('/var/www/html/static/charts/dual.svg').read_text(encoding='utf-8')\n"
        "assert 'polyline' in svg and '等待實盤' not in svg\n"
        "print('SVG_OK')\n"
    )
    sftp = ssh.open_sftp()
    with sftp.file("/tmp/verify_prerender.py", "w") as f:
        f.write(verify)
    sftp.close()
    run(ssh, "python3 /tmp/verify_prerender.py")
    ssh.close()
    print("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
