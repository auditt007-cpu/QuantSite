# -*- coding: utf-8 -*-
"""Provision VPS same-origin static hosting for live_feed.json + site.

- Installs nginx
- Syncs repo static files to /var/www/html
- Deploys updated tg_engine.py (5s webroot publish)
- Removes GitHub feed-push cron (no Actions relay)
- Attempts Let's Encrypt if DNS already points at this host
"""
import io
import os
import tarfile
import time

import paramiko

HOST = os.environ.get("SSH_HOST", "154.21.206.234")
PORT = int(os.environ.get("SSH_PORT", "1063"))
USER = os.environ.get("SSH_USER", "root")
PASSWORD = os.environ["SSH_PASS"]
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WEB_ROOT = "/var/www/html"

NGINX_CONF = r"""
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name quantalpha.space www.quantalpha.space _;

    root /var/www/html;
    index index.html;

    location = /live_feed.json {
        default_type application/json;
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
        add_header Access-Control-Allow-Origin "*" always;
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ $uri.html =404;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|mp3|json)$ {
        expires 5m;
        add_header Cache-Control "public";
        try_files $uri =404;
    }
}
"""

INCLUDE_PREFIXES = (
    "index.html",
    "live.html",
    "terminal.html",
    "member.html",
    "about.html",
    "affiliate.html",
    "ai-backtest.html",
    "admin.html",
    "styles.css",
    "app.js",
    "affiliate.js",
    "i18n.js",
    "live_feed.json",
    "leaderboard.json",
    "apple-touch-icon.png",
    "favicon-16x16.png",
    "favicon-32x32.png",
    "css/",
    "js/",
    "audio/",
    "data/",
)


def should_include(rel):
    rel = rel.replace("\\", "/")
    if rel.startswith(".") or "/." in rel:
        return False
    if rel.startswith("deploy/") or rel.startswith("scripts/") or rel.startswith(".github/"):
        return False
    for p in INCLUDE_PREFIXES:
        if rel == p.rstrip("/") or rel.startswith(p):
            return True
    return False


def build_tarball():
    buf = io.BytesIO()
    count = 0
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for root, dirs, files in os.walk(REPO):
            dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__", ".cursor")]
            for name in files:
                full = os.path.join(root, name)
                rel = os.path.relpath(full, REPO).replace("\\", "/")
                if not should_include(rel):
                    continue
                tar.add(full, arcname=rel)
                count += 1
    buf.seek(0)
    return buf, count


def run(ssh, cmd, timeout=300):
    print(">>", cmd[:180], flush=True)
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err.strip():
        print(err, end="" if err.endswith("\n") else "\n")
    print("exit", code, flush=True)
    return code, out, err


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=30, allow_agent=False, look_for_keys=False)

    run(ssh, "export DEBIAN_FRONTEND=noninteractive; apt-get update -y && apt-get install -y nginx", timeout=600)
    run(ssh, "mkdir -p {0} /etc/nginx/sites-available /etc/nginx/sites-enabled".format(WEB_ROOT))

    # nginx site
    sftp = ssh.open_sftp()
    with sftp.file("/etc/nginx/sites-available/quantalpha", "w") as f:
        f.write(NGINX_CONF)
    sftp.close()
    run(ssh, "ln -sfn /etc/nginx/sites-available/quantalpha /etc/nginx/sites-enabled/quantalpha")
    run(ssh, "rm -f /etc/nginx/sites-enabled/default")
    # ensure nginx.conf includes sites-enabled
    run(
        ssh,
        "grep -q sites-enabled /etc/nginx/nginx.conf || "
        "sed -i 's@http {@http {\\n\\tinclude /etc/nginx/sites-enabled/*;@' /etc/nginx/nginx.conf",
    )

    # upload static site
    buf, count = build_tarball()
    print("tarball files:", count, "bytes:", buf.getbuffer().nbytes)
    sftp = ssh.open_sftp()
    with sftp.file("/tmp/quantsite_www.tgz", "wb") as f:
        f.write(buf.read())
    # engine
    local_engine = os.path.join(REPO, "deploy", "quantsite", "tg_engine.py")
    sftp.put(local_engine, "/root/quantsite/tg_engine.py")
    sftp.close()

    run(ssh, "tar -xzf /tmp/quantsite_www.tgz -C {0} && chown -R www-data:www-data {0} && ls -la {0} | head".format(WEB_ROOT))
    # seed feed immediately
    run(ssh, "cp -f /root/quantsite/live_feed.json {0}/live_feed.json && ls -la {0}/live_feed.json".format(WEB_ROOT))

    # remove GitHub Actions relay cron
    run(
        ssh,
        "(crontab -l 2>/dev/null | grep -Fv push_live_feed.py | grep -Fv feed_push) | crontab - ; crontab -l || true",
    )
    run(ssh, "rm -f /root/quantsite/push_live_feed.py")

    run(ssh, "nginx -t && systemctl enable nginx && systemctl restart nginx")
    run(ssh, "systemctl restart tg-bot && sleep 2 && systemctl is-active tg-bot")
    run(ssh, "curl -sS -o /dev/null -w '%{http_code} %{content_type}\\n' http://127.0.0.1/live_feed.json")
    run(ssh, "curl -sS http://127.0.0.1/live_feed.json | python3 -c \"import sys,json;d=json.load(sys.stdin);print(d.get('updated_at'), d.get('poll_sec'), len(d.get('exec_log') or []))\"")

    # certbot only if DNS already resolves here
    run(
        ssh,
        "python3 - <<'PY'\n"
        "import socket\n"
        "ip=socket.gethostbyname('quantalpha.space')\n"
        "print('dns', ip)\n"
        "open('/tmp/qa_dns_ip','w').write(ip)\n"
        "PY",
    )
    code, out, _ = run(ssh, "cat /tmp/qa_dns_ip")
    dns_ip = (out or "").strip()
    if dns_ip == HOST or dns_ip == "154.21.206.234":
        run(ssh, "export DEBIAN_FRONTEND=noninteractive; apt-get install -y certbot python3-certbot-nginx", timeout=300)
        run(
            ssh,
            "certbot --nginx -d quantalpha.space -d www.quantalpha.space "
            "--non-interactive --agree-tos -m admin@quantalpha.space --redirect || true",
            timeout=300,
        )
    else:
        print(
            "SKIP certbot: quantalpha.space resolves to {0}, not this VPS ({1}). "
            "Point DNS A/AAAA to the VPS, then re-run certbot.".format(dns_ip, HOST)
        )

    run(ssh, "ss -lntp | grep -E ':80|:443' || true")
    run(ssh, "journalctl -u tg-bot -n 15 --no-pager || true")
    ssh.close()
    print("DONE")


if __name__ == "__main__":
    main()
