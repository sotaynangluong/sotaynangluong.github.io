# Sổ tay Dự án Năng lượng

Sổ tay tra cứu và tự kiểm tra cho phát triển, xây dựng, quản lý dự án năng lượng tại Việt Nam.

- **01 Tin tức ngành điện:** tự động tổng hợp tiêu đề và link từ Bộ Công Thương, EVN, NSMO, Bộ Tài chính, Chính phủ, báo chí năng lượng.
- **02 Tự kiểm tra:** luyện tập, tạo đề thi có tính giờ, chấm điểm, bảng xếp hạng, lịch sử, quản trị.
- **03 Cẩm nang rủi ro:** ma trận rủi ro theo 8 loại hình dự án.
- **04 Tra cứu nhanh:** giá điện 2025, khung giá phát điện, cấp điện áp, nhóm dự án, văn bản pháp luật có link.

Công nghệ: HTML/JS tĩnh trên GitHub Pages, đăng nhập Google và lưu kết quả bằng Firebase (gói miễn phí Spark).

## Cấu trúc

| File | Vai trò |
|---|---|
| `index.html`, `style.css`, `app.js` | Giao diện và logic |
| `firebase-config.js` | Cấu hình Firebase và email quản trị |
| `firestore.rules` | Quy tắc bảo mật, dán vào Firebase Console |
| `data/questions.json` | Ngân hàng câu hỏi |
| `data/risks.json` | Cẩm nang rủi ro |
| `data/lookup.json` | Bảng tra cứu, giá điện, văn bản |
| `data/news.json` | Tin tức (do GitHub Actions tự ghi) |
| `scripts/fetch_news.py`, `.github/workflows/news.yml` | Lấy tin tự động lúc 6h và 14h |

## Cài đặt lần đầu

1. **Firebase**
   - Tạo dự án, bật Authentication → Google, tạo Firestore (Singapore, production mode).
   - Lấy `firebaseConfig` dán vào `firebase-config.js`; điền UID quản trị vào `ADMIN_UIDS` (Authentication → Users, sau khi đăng nhập lần đầu).
2. **Quy tắc bảo mật:** mở Firestore → Rules, dán nội dung `firestore.rules` (thay UID quản trị), bấm **Publish**.
3. **Tên miền được phép:** Authentication → Settings → Authorized domains → **Add domain** → `<tên-tài-khoản>.github.io`.
4. **GitHub Pages:** repo → Settings → Pages → Source: *Deploy from a branch* → Branch `main`, thư mục `/ (root)` → Save. Sau 1–2 phút trang chạy tại `https://<tên-tài-khoản>.github.io/so-tay-nang-luong/`.

## Thêm câu hỏi

Sửa `data/questions.json` trực tiếp trên GitHub (biểu tượng bút chì), mỗi câu theo mẫu:

```json
{
 "id": "q6",
 "topic": "Đầu tư – Xây dựng",
 "level": 1,
 "q": "Nội dung câu hỏi",
 "o": ["Đáp án A", "Đáp án B", "Đáp án C", "Đáp án D"],
 "a": 2,
 "e": "Giải thích đáp án đúng",
 "b": "Căn cứ: Điều …, NĐ …"
}
```

- `a` là vị trí đáp án đúng, đếm từ 0 (A = 0, B = 1, C = 2, D = 3).
- `level`: 1 cơ bản, 2 trung bình, 3 nâng cao.
- `id` không được trùng.

## Quy tắc thi

- Đề bốc ngẫu nhiên từ ngân hàng, đảo thứ tự đáp án.
- Chỉ đề đủ số câu và chọn "Mọi mức độ" mới tính xếp hạng.
- Xếp hạng theo điểm cao nhất của mỗi người, bằng điểm thì thời gian ngắn hơn đứng trước.
- Giới hạn: điểm chấm trên trình duyệt (gói miễn phí). Quy tắc Firestore chặn điểm vượt thang, điểm không khớp số câu đúng và thời gian làm bài dưới 3 giây/câu. Quản trị viên xóa được lượt thi bất thường.

## Tin tức

- Chạy tự động lúc 6h và 14h (giờ Việt Nam). Chạy tay: tab **Actions** → *Cập nhật tin tức ngành điện* → **Run workflow**.
- Thêm/bớt nguồn: sửa danh sách `FEEDS` trong `scripts/fetch_news.py`.
