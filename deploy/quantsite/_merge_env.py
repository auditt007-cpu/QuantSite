# -*- coding: utf-8 -*-
import sys
from pathlib import Path


def parse(p: Path):
    d = {}
    if not p.is_file():
        return d
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        d[k.strip()] = v
    return d


def main():
    main_path = Path(sys.argv[1])
    extra_path = Path(sys.argv[2])
    a, b = parse(main_path), parse(extra_path)
    for k, v in b.items():
        if k.startswith("SSH_"):
            continue
        a[k] = v
    lines = ["%s=%s" % (k, a[k]) for k in a]
    main_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if extra_path.is_file():
        extra_path.unlink()
    need = ["TG_BOT_TOKEN", "ADMIN_CHAT_ID", "META_CAPI_TOKEN", "META_PIXEL_ID", "DEEPSEEK_API_KEY"]
    print("env_keys", len(a))
    print("env_ready", all(bool(a.get(k)) for k in need))


if __name__ == "__main__":
    main()
