// Dán cấu hình Firebase của dự án vào đây (Project settings → Your apps → Web app).
// Đây là thông tin công khai, không phải mật khẩu. Bảo mật do firestore.rules quyết định.
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// Email quản trị: được xem và xóa mọi lượt thi. Phải khớp với danh sách trong firestore.rules.
export const ADMIN_EMAILS = ["EMAIL_QUAN_TRI@gmail.com"];
