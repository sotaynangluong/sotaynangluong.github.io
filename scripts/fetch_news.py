"""Lấy tin ngành điện từ cổng thông tin cơ quan nhà nước, doanh nghiệp ngành điện; ghi data/news.json.

Chạy bằng GitHub Actions (.github/workflows/news.yml). Chỉ lưu tiêu đề, nguồn, ngày, link;
không lưu nội dung bài để tôn trọng bản quyền của các trang nguồn.
"""
import json
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "news.json"
KEEP_DAYS = 45
MAX_ITEMS = 300
UA = "Mozilla/5.0 (so-tay-nang-luong news bot)"


def gnews(q):
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": q + " when:30d", "hl": "vi", "gl": "VN", "ceid": "VN:vi"})


# (tên nhóm nguồn, URL, có cần lọc từ khóa ngành điện hay không)
# Chỉ lấy tin từ cổng thông tin của cơ quan nhà nước và doanh nghiệp ngành điện (không lấy tin báo chí).
FEEDS = [
    ("Bộ Công Thương", gnews("site:moit.gov.vn điện"), True),
    ("Chính phủ", gnews("site:chinhphu.vn điện"), True),
    ("Bộ Tài chính", gnews("site:mof.gov.vn điện"), True),
    ("EVN", gnews("site:evn.com.vn"), False),
    ("NSMO", gnews("site:nsmo.vn"), False),
    ("EVNNPT", gnews("site:npt.com.vn"), False),
]
ALLOWED_GROUPS = {g for g, _, _ in FEEDS}

POWER_KW = ["điện", "năng lượng", "evn", "nsmo", "bess", "dppa", "lưới", "tuabin", "tua-bin", "kwh", "mw"]

TOPICS = [
    ("Giá điện", ["giá điện", "khung giá", "biểu giá", "giá bán lẻ", "giá phát điện", "giá bán điện"]),
    ("Chính sách", ["nghị định", "thông tư", "quyết định", "luật", "quy hoạch", "dự thảo", "cơ chế", "chính sách"]),
    ("Dự án", ["dự án", "đấu nối", "khởi công", "đóng điện", "vận hành thương mại", "cod", "nhà đầu tư", "đấu thầu", "nhà máy"]),
    ("Dự án", ["chấp thuận đầu tư", "rót", "tỷ đồng", "tỷ usd", "triệu usd", "đầu tư"]),
    ("Vận hành", ["vận hành", "phụ tải", "cung ứng điện", "điều độ", "hệ thống điện", "tiết kiệm điện", "sản lượng", "mất điện", "cắt điện", "lưới điện"]),
    ("NLTT – Lưu trữ", ["điện gió", "điện mặt trời", "tái tạo", "pin lưu trữ", "bess", "hydrogen", "hydro xanh", "điện hạt nhân", "điện khí", "lng"]),
]


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def parse_date(s):
    try:
        d = parsedate_to_datetime(s)
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def topic_of(title):
    t = title.lower()
    for name, kws in TOPICS:
        if any(k in t for k in kws):
            return name
    return "Khác"


def clean_title(title, source):
    title = re.sub(r"\s+", " ", title).strip()
    if source and title.endswith(" - " + source):
        title = title[: -len(source) - 3]
    return title


ENRICH_DAYS = 3        # chỉ giải mã link gốc cho tin trong 3 ngày gần nhất
ENRICH_MAX = 90        # giới hạn số bài xử lý mỗi lần chạy


def resolve(link):
    if "news.google.com" not in link:
        return link
    try:
        from googlenewsdecoder import gnewsdecoder
        r = gnewsdecoder(link, interval=1)
        return r.get("decoded_url") if r.get("success") else None
    except Exception:
        return None


def enrich(item):
    """Chỉ giải mã link gốc của bài; không tải trang, không lấy ảnh hay trích đoạn."""
    item["enriched"] = True
    url = resolve(item["link"])
    if url:
        item["url"] = url


def main():
    old = []
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text(encoding="utf-8")).get("items", [])
        except Exception:
            old = []
    items = {}
    for i in old:
        if i.get("group") not in ALLOWED_GROUPS:
            continue  # bỏ tin từ nguồn đã ngừng lấy (báo chí)
        i = {k: v for k, v in i.items() if k not in ("image", "excerpt")}
        i["topic"] = topic_of(i["title"])
        items[i["link"]] = i
    cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    errors = []

    for group, url, need_kw in FEEDS:
        try:
            root = ET.fromstring(fetch(url))
        except Exception as e:
            errors.append(f"{group}: {e}")
            continue
        for it in root.iter("item"):
            link = (it.findtext("link") or "").strip()
            src_el = it.find("source")
            source = (src_el.text or "").strip() if src_el is not None else group
            title = clean_title(it.findtext("title") or "", source)
            date = parse_date(it.findtext("pubDate") or "")
            if not link or len(title) < 20 or not date or date < cutoff:
                continue
            if need_kw and not any(k in title.lower() for k in POWER_KW):
                continue
            if link in items:
                continue
            items[link] = {
                "title": title,
                "link": link,
                "source": source or group,
                "group": group,
                "topic": topic_of(title),
                "date": date.astimezone(timezone.utc).isoformat(),
            }

    # Bỏ tin quá cũ, trùng tiêu đề; mới nhất lên đầu
    seen, out = set(), []
    for i in sorted(items.values(), key=lambda x: x["date"], reverse=True):
        key = re.sub(r"\W+", "", i["title"].lower())
        if key in seen or len(i["title"]) < 20 or datetime.fromisoformat(i["date"]) < cutoff:
            continue
        seen.add(key)
        out.append(i)
    out = out[:MAX_ITEMS]

    recent = datetime.now(timezone.utc) - timedelta(days=ENRICH_DAYS)
    todo = [i for i in out if not i.get("enriched") and datetime.fromisoformat(i["date"]) >= recent][:ENRICH_MAX]
    for n, i in enumerate(todo, 1):
        enrich(i)
        time.sleep(0.5)
    print(f"Giải mã link gốc: {len(todo)} bài")

    OUT.write_text(json.dumps({
        "updated": datetime.now(timezone.utc).isoformat(),
        "count": len(out),
        "errors": errors,
        "items": out,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(out)} tin; lỗi nguồn: {len(errors)}")
    for e in errors:
        print(" -", e)


if __name__ == "__main__":
    main()
