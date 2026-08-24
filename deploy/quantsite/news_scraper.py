# -*- coding: utf-8 -*-
"""Lightweight RSS flash-news scraper for VPS — writes news_feed.json every 10 min."""

import json
import os
import re
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

POLL_SEC = int(os.environ.get("NEWS_POLL_SEC", "600"))
WEB_NEWS_PATH = os.environ.get("WEB_NEWS_PATH", "/var/www/html/news_feed.json")
LOCAL_NEWS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "news_feed.json")
MAX_ITEMS = 30
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

RSS_FEEDS = [
    ("CoinTelegraph", "https://cointelegraph.com/rss"),
    ("BlockTempo", "https://www.blocktempo.com/feed/"),
    ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss?outputType=xml"),
    ("Decrypt", "https://decrypt.co/feed"),
    ("BitcoinMagazine", "https://bitcoinmagazine.com/.rss/full/"),
]


def log(msg):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print("[{0}] {1}".format(ts, msg), flush=True)


def fetch_bytes(url, timeout=15, hops=6):
    headers = {"User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml, */*"}
    last_err = None
    for _ in range(hops):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            last_err = exc
            loc = exc.headers.get("Location") if exc.headers else None
            if loc and exc.code in (301, 302, 303, 307, 308):
                url = urllib.parse.urljoin(url, loc)
                continue
            raise
    raise last_err or RuntimeError("redirect loop")


def parse_pub_date(raw):
    if not raw:
        return int(time.time())
    try:
        dt = parsedate_to_datetime(str(raw).strip())
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        pass
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return int(time.time())


def strip_html(text):
    return re.sub(r"<[^>]+>", "", str(text or "")).strip()


def parse_rss(xml_bytes, source):
    rows = []
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return rows
    for item in root.findall(".//item"):
        title = strip_html(item.findtext("title"))
        link = (item.findtext("link") or item.findtext("guid") or "").strip()
        pub = item.findtext("pubDate") or item.findtext("{http://www.w3.org/2005/Atom}updated")
        if not title:
            continue
        rows.append(
            {
                "title": title[:240],
                "url": link or "https://www.coindesk.com/",
                "time": parse_pub_date(pub),
                "source": source,
            }
        )
    if rows:
        return rows
    for entry in root.findall(".//{http://www.w3.org/2005/Atom}entry"):
        title = strip_html(entry.findtext("{http://www.w3.org/2005/Atom}title"))
        link_el = entry.find("{http://www.w3.org/2005/Atom}link")
        link = link_el.get("href") if link_el is not None else ""
        pub = entry.findtext("{http://www.w3.org/2005/Atom}updated") or entry.findtext(
            "{http://www.w3.org/2005/Atom}published"
        )
        if not title:
            continue
        rows.append(
            {
                "title": title[:240],
                "url": link or "https://www.coindesk.com/",
                "time": parse_pub_date(pub),
                "source": source,
            }
        )
    return rows


def collect_news():
    merged = []
    seen = set()
    for source, url in RSS_FEEDS:
        try:
            raw = fetch_bytes(url)
            for row in parse_rss(raw, source):
                key = (row["title"], row.get("url"))
                if key in seen:
                    continue
                seen.add(key)
                merged.append(row)
        except Exception as exc:
            log("rss skip {0}: {1}".format(source, exc))
    merged.sort(key=lambda x: x.get("time") or 0, reverse=True)
    return merged[:MAX_ITEMS]


def atomic_write_json(path, payload):
    tmp = path + ".tmp"
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def publish_once():
    items = collect_news()
    payload = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "items": items,
    }
    atomic_write_json(LOCAL_NEWS_PATH, payload)
    if WEB_NEWS_PATH and WEB_NEWS_PATH != LOCAL_NEWS_PATH:
        atomic_write_json(WEB_NEWS_PATH, payload)
    log("news_feed published {0} items".format(len(items)))
    return payload


def main():
    log("news_scraper start poll={0}s out={1}".format(POLL_SEC, WEB_NEWS_PATH))
    while True:
        try:
            publish_once()
        except Exception:
            traceback.print_exc()
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
