// Cấu hình Firebase (thông tin công khai theo thiết kế của Firebase; bảo mật do firestore.rules quyết định).
export const firebaseConfig = {
  apiKey: "AIzaSyCqUxNFcvL5-6VxWvMuOinZiBba_FDm7Mg",
  authDomain: "so-tay-nang-luong.firebaseapp.com",
  projectId: "so-tay-nang-luong",
  storageBucket: "so-tay-nang-luong.firebasestorage.app",
  messagingSenderId: "526900219399",
  appId: "1:526900219399:web:cbf4a62627db70827724a2"
};

// UID quản trị (xem ở Firebase Console → Authentication → Users). Phải khớp với firestore.rules.
// Dùng UID thay vì email để không lộ email trong mã nguồn công khai.
export const ADMIN_UIDS = ["FGHJtWDW8RTqoL0m2gfFT3ntN1K3"];
