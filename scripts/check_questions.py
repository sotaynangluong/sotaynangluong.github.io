"""Kiểm tra ngân hàng câu hỏi: id trùng, cấu trúc, phân bố vị trí đáp án,
và độ dài đáp án đúng so với phương án nhiễu (tránh "chọn câu dài nhất").
Chạy: python3 scripts/check_questions.py  (mã thoát 1 nếu có lỗi)"""
import json, sys
from collections import Counter

qs = json.load(open("data/questions.json", encoding="utf-8"))
err, warn = [], []
ids = Counter(q["id"] for q in qs)
err += [f"id trùng: {i}" for i, n in ids.items() if n > 1]
for q in qs:
    if len(q.get("o", [])) != 4 or q.get("a") not in range(4):
        err.append(f"{q['id']}: cần 4 phương án và a trong 0..3"); continue
    for k in ("topic", "level", "q", "e", "b"):
        if not q.get(k): err.append(f"{q['id']}: thiếu {k}")
    c = len(q["o"][q["a"]]); d = max(len(o) for i, o in enumerate(q["o"]) if i != q["a"])
    if c / d > 1.10:
        err.append(f"{q['id']}: đáp án đúng dài hơn nhiễu dài nhất {c/d:.2f} lần")
n = len(qs)
longest = sum(1 for q in qs if len(q["o"][q["a"]]) > max(len(o) for i, o in enumerate(q["o"]) if i != q["a"]))
pos = Counter(q["a"] for q in qs)
print(f"{n} câu | đáp án đúng dài nhất: {longest} ({longest/n:.0%}, ngưỡng ≤ 40%) | vị trí A–D: {[pos[i] for i in range(4)]}")
if longest / n > 0.40: err.append("tỷ lệ đáp án đúng dài nhất vượt 40%")
if max(pos.values()) - min(pos.values()) > n * 0.1: warn.append("vị trí đáp án lệch")
for w in warn: print("CẢNH BÁO:", w)
for e in err: print("LỖI:", e)
sys.exit(1 if err else 0)
