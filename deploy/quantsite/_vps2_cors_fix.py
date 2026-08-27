# -*- coding: utf-8 -*-
"""Fix CORS/OPTIONS on api.quantalpha.space nginx site.

Root cause of live.html voice outage on quantalpha.space (GitHub Pages):
- OPTIONS preflight for static JSON/audio hit nginx try_files -> 405
- nginx added 'Access-Control-Allow-Origin: *' on /api/ while FastAPI
  CORSMiddleware also adds an origin-specific header -> multi-value header,
  rejected by browsers.

Fix: handle OPTIONS at nginx edge (204 + CORS), drop nginx-side ACAO for
/api/ (FastAPI owns it), keep single-value CORS on static JSON/audio.
"""
import os
import sys
import textwrap

import paramiko

HOST = os.environ.get("VPS2_HOST", "192.255.152.136")
PORT = int(os.environ.get("VPS2_PORT", "22"))
USER = os.environ.get("VPS2_USER", "root")
PASSWORD = os.environ.get("VPS2_PASS", "oZOaWG2d72b430qXUk")
DOMAIN = "api.quantalpha.space"
APP = "/var/www/quantsite"

NGINX_CONF = textwrap.dedent(
    """
    map $http_origin $cors_origin {
        default '*';
        ~^https?://([a-z0-9-]+\\.)*quantalpha\\.space$ $http_origin;
    }

    # HTTP: permanent redirect to HTTPS
    server {
        listen 80;
        listen [::]:80;
        server_name %(domain)s;
        return 301 https://$host$request_uri;
    }

    # HTTPS main site
    server {
        listen 443 ssl http2;
        listen [::]:443 ssl http2;
        server_name %(domain)s;

        root %(app)s;
        index index.html;

        access_log /var/log/nginx/quantapi.access.log;
        error_log  /var/log/nginx/quantapi.error.log;

        client_max_body_size 8m;
        error_page 418 = @cors_preflight;

        # --- Let's Encrypt (certbot --nginx) ---
        ssl_certificate /etc/letsencrypt/live/%(domain)s/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/%(domain)s/privkey.pem;
        include /etc/letsencrypt/options-ssl-nginx.conf;
        ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

        # quant-hardening: never serve secrets/dirs
        location ~ /\\.(env|git|venv) { deny all; return 404; }
        location ^~ /.venv/ { deny all; return 404; }

        # --- cross-origin preflight, answered at the edge ---
        location @cors_preflight {
            add_header Access-Control-Allow-Origin $cors_origin always;
            add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Webhook-Secret, X-Requested-With, Cache-Control, Pragma, Accept" always;
            add_header Access-Control-Max-Age 3600 always;
            add_header Content-Length 0;
            add_header Content-Type text/plain;
            return 204;
        }
        location / {
            if ($request_method = OPTIONS) {
                return 418;
            }
            try_files $uri $uri/ =404;
        }

        # --- quant-hub (FastAPI 127.0.0.1:8088); FastAPI owns CORS here ---
        location /api/ {
            proxy_pass http://127.0.0.1:8088/api/;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header User-Agent $http_user_agent;
        }

        location = /health {
            proxy_pass http://127.0.0.1:8088/health;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
        }

        location /tg/webhook {
            proxy_pass http://127.0.0.1:8088/tg/webhook;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # --- live data: never cache, cross-origin readable ---
        location ~ ^/(live_feed|leaderboard|strategies|plaza_live_registry)\\.json$ {
            if ($request_method = OPTIONS) {
                return 418;
            }
            add_header Cache-Control "no-cache, no-store, must-revalidate" always;
            add_header Access-Control-Allow-Origin $cors_origin always;
            default_type application/json;
        }

        location /data/ {
            if ($request_method = OPTIONS) {
                return 418;
            }
            add_header Access-Control-Allow-Origin $cors_origin always;
            add_header Cache-Control "no-cache" always;
        }

        location /static/charts/ {
            add_header Cache-Control "no-cache, no-store, must-revalidate" always;
        }

        location /audio/ {
            if ($request_method = OPTIONS) {
                return 418;
            }
            add_header Cache-Control "public, max-age=86400" always;
            add_header Accept-Ranges bytes;
            add_header Access-Control-Allow-Origin $cors_origin always;
        }
    }
    """
).lstrip() % {"domain": DOMAIN, "app": APP}

VERIFY = r"""
set -e
echo "--- OPTIONS preflight live_feed.json (with cache-control req header)"
curl -sSI -X OPTIONS https://api.quantalpha.space/live_feed.json \
  -H 'Origin: https://quantalpha.space' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: cache-control' | grep -iE 'HTTP|access-control' | head -8
echo "--- GET live_feed.json with Origin"
curl -sSI https://api.quantalpha.space/live_feed.json -H 'Origin: https://quantalpha.space' | grep -iE 'HTTP|access-control' | head -6
echo "--- POST capi/event headers (single ACAO?)"
curl -sSI -X POST https://api.quantalpha.space/api/capi/event -H 'Origin: https://quantalpha.space' -H 'Content-Type: application/json' -d '{}' | grep -ciE '^access-control-allow-origin' || true
echo "--- audio promo CORS"
curl -sSI https://api.quantalpha.space/audio/promo_zh_tw.mp3 -H 'Origin: https://quantalpha.space' | grep -iE 'HTTP|access-control|content-type' | head -5
echo "--- health still ok"
curl -sS https://api.quantalpha.space/health
echo
echo VERIFY_DONE
"""


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD,
                timeout=90, banner_timeout=120, auth_timeout=120,
                allow_agent=False, look_for_keys=False)

    def run(cmd, timeout=120, check=True):
        print(">>", cmd[:140], flush=True)
        _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        if out:
            print(out[-3000:])
        if err:
            print("[stderr]", err[-1500:])
        if code != 0 and check:
            raise SystemExit("remote failed (%d): %s" % (code, cmd[:200]))
        return out

    sftp = ssh.open_sftp()
    with sftp.open("/etc/nginx/sites-available/quantapi.conf", "w") as f:
        f.write(NGINX_CONF)
    print("nginx config rewritten")
    run("nginx -t && systemctl reload nginx")
    with sftp.open("/tmp/_verify_cors.sh", "w") as f:
        f.write(VERIFY)
    run("bash /tmp/_verify_cors.sh", timeout=120)
    sftp.close()
    ssh.close()
    print("CORS_FIX_OK")


if __name__ == "__main__":
    sys.exit(main())
