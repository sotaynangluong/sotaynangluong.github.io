import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query as fq, where, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { firebaseConfig, ADMIN_UIDS, RECAPTCHA_SITE_KEY, AI_MODEL } from "./firebase-config.js?v=29";

/* ---------- Khởi tạo ---------- */
const configured = !!firebaseConfig.projectId;
let auth = null, db = null, user = null, app = null;
if (configured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}
const isAdmin = () => !!user && ADMIN_UIDS.includes(user.uid);

const $ = s => document.querySelector(s);
const view = $("#view");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let DATA = { questions: [], risks: [], lookup: {}, tech: null };
let query = "";
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const hit = (...p) => !query || p.join(" ").toLowerCase().includes(query);
const hl = s => { const t = esc(s); if (!query) return t; const i = t.toLowerCase().indexOf(query); return i < 0 ? t : t.slice(0, i) + "<mark>" + t.slice(i, i + query.length) + "</mark>" + t.slice(i + query.length); };
/* Thuật ngữ viết tắt: hiện chú giải khi rê chuột/chạm, và bảng tra trong mục IV */
const ABBR = {
  BCNCTKT: "Báo cáo nghiên cứu tiền khả thi", BCNCKT: "Báo cáo nghiên cứu khả thi", BCKTKT: "Báo cáo kinh tế - kỹ thuật",
  TKCS: "Thiết kế cơ sở", TKKT: "Thiết kế kỹ thuật", TKBVTC: "Thiết kế bản vẽ thi công",
  FEED: "Thiết kế tổng thể giai đoạn đầu (Front-End Engineering Design), lập cho dự án có thiết kế công nghệ",
  EPC: "Hợp đồng thiết kế – cung cấp thiết bị, vật tư – thi công xây dựng (Engineering, Procurement, Construction)",
  EP: "Hợp đồng thiết kế – cung cấp thiết bị, vật tư", EC: "Hợp đồng thiết kế – thi công xây dựng",
  TMĐT: "Tổng mức đầu tư", QLDA: "Quản lý dự án", KHLCNT: "Kế hoạch lựa chọn nhà thầu", GPMB: "Giải phóng mặt bằng",
  BIM: "Mô hình thông tin công trình (Building Information Modeling)", ODA: "Hỗ trợ phát triển chính thức (vốn vay ưu đãi nước ngoài)",
  PPP: "Đầu tư theo phương thức đối tác công tư", NSNN: "Ngân sách nhà nước", UBND: "Ủy ban nhân dân",
  PCCC: "Phòng cháy, chữa cháy", GTGT: "Giá trị gia tăng", VAT: "Thuế giá trị gia tăng",
  KCN: "Khu công nghiệp", KCX: "Khu chế xuất", KCNC: "Khu công nghệ cao", KKT: "Khu kinh tế",
  DPPA: "Mua bán điện trực tiếp (Direct Power Purchase Agreement)", BESS: "Hệ thống lưu trữ điện năng bằng pin (Battery Energy Storage System)",
  EVN: "Tập đoàn Điện lực Việt Nam", NSMO: "Công ty TNHH MTV Vận hành hệ thống điện và thị trường điện quốc gia",
  "NĐ": "Nghị định", "TT": "Thông tư", "QĐ": "Quyết định"
};
const ABBR_RE = new RegExp("(^|[^\\p{L}\\d])(" + Object.keys(ABBR).sort((a, b) => b.length - a.length).join("|") + ")(?![\\p{L}\\d])", "gu");
const ab = html => html.replace(ABBR_RE, (m, pre, k) => `${pre}<abbr title="${ABBR[k]}">${k}</abbr>`);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const topics = () => [...new Set(DATA.questions.map(q => q.topic))];
const LEVELS = { 0: "Mọi mức độ", 1: "Cơ bản", 2: "Trung bình", 3: "Nâng cao" };

/* ---------- Đăng nhập ---------- */
function renderUser() {
  const box = $("#userbox");
  if (!configured) { box.innerHTML = `<span class="hint">Chưa cấu hình Firebase</span>`; return; }
  if (user) {
    box.innerHTML = `${user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : ""}<span>${esc(user.displayName || user.email)}</span><button class="btn" id="logout" type="button">Đăng xuất</button>`;
    $("#logout").onclick = () => signOut(auth);
  } else {
    box.innerHTML = `<button class="btn primary" id="login" type="button">Đăng nhập Google</button>`;
    $("#login").onclick = login;
  }
}
async function login() {
  const p = new GoogleAuthProvider();
  try { await signInWithPopup(auth, p); }
  catch (e) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(e.code)) await signInWithRedirect(auth, p);
    else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") alert("Đăng nhập không thành công: " + e.message);
  }
}

/* ---------- Dữ liệu cá nhân: đồng ý và tên hiển thị ---------- */
const consentKey = () => user ? "stnl-consent-" + user.uid : "";
const getConsent = () => user ? store.get(consentKey(), null) : null;
function shortName(n) {
  const w = String(n || "").trim().split(/\s+/).filter(Boolean);
  if (w.length < 2) return w[0] || "Ẩn danh";
  return w.slice(0, -1).map(x => x[0].toUpperCase() + ".").join("") + " " + w[w.length - 1];
}
const publicName = () => { const c = getConsent(); const n = user?.displayName || "Ẩn danh"; return c?.nameMode === "short" ? shortName(n) : n; };
function consentCard() {
  const full = esc(user.displayName || "Ẩn danh"), sh = esc(shortName(user.displayName));
  return `<div class="card consent">
    <h3>Thông báo xử lý dữ liệu cá nhân</h3>
    <p>Khi anh/chị dùng chức năng thi, trang lưu trên Firebase (Google, máy chủ Singapore) các dữ liệu: mã người dùng Google, tên hiển thị, ảnh đại diện, kết quả và thời gian làm bài. Mục đích: chấm điểm, lưu lịch sử và lập bảng xếp hạng công khai (mọi người truy cập trang đều xem được tên hiển thị và điểm). Trang không lưu email, không chia sẻ cho bên thứ ba. Quản trị viên xem và xóa được các lượt thi. Muốn xóa toàn bộ dữ liệu của mình, liên hệ email ở thanh bên.</p>
    <fieldset class="nm"><legend>Tên hiển thị trên bảng xếp hạng</legend>
      <label><input type="radio" name="nm" value="full" id="nm-full" checked> Họ tên đầy đủ: <b>${full}</b></label>
      <label><input type="radio" name="nm" value="short" id="nm-short"> Viết tắt: <b>${sh}</b></label>
    </fieldset>
    <div class="top"><button class="btn primary" id="agree" type="button">Đồng ý và tiếp tục</button><button class="btn" id="decline" type="button">Không đồng ý (đăng xuất)</button></div>
    <p class="hint">Xem đầy đủ tại <a href="#chinh-sach">Chính sách dữ liệu và bản quyền</a>.</p></div>`;
}

/* ---------- Yêu cầu đăng nhập ---------- */
function gateBanner(msg) {
  if (user || !configured) return "";
  return `<div class="gate"><span>${msg}</span><button class="btn primary" type="button" data-login>Đăng nhập Google</button></div>`;
}
function wireGate(root = view) { root.querySelectorAll("[data-login]").forEach(b => b.onclick = login); }

/* ---------- II. Kiểm tra kiến thức ---------- */
let tab = "luyen-tap", topicFilter = "Tất cả";
let exam = null;      // đề đang làm
let result = null;    // kết quả vừa nộp
let timerId = null;

function renderQuizSection() {
  const tabs = [["luyen-tap", "Luyện tập"], ["thi", "Thi"], ["bang-tong", "Bảng xếp hạng"], ["xep-hang", "Xếp hạng theo đề"], ["lich-su", "Lịch sử của tôi"]];
  if (isAdmin()) tabs.push(["quan-tri", "Quản trị"]);
  view.innerHTML = `<h1>Kiểm tra kiến thức</h1>
    <p class="lede">Luyện tập tự do, hoặc tạo đề thi có tính giờ để chấm điểm và xếp hạng. Ngân hàng hiện có <b class="num">${DATA.questions.length}</b> câu hỏi.</p>
    ${gateBanner("Mọi người đều luyện tập, thi thử và xem bảng xếp hạng được. Đăng nhập Google để lưu kết quả, có tên trên bảng xếp hạng và xem lịch sử thi.")}
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" type="button" data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join("")}</div>
    <div id="pane"></div>`;
  wireGate();
  view.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { if (exam && !confirmLeave()) return; tab = b.dataset.tab; if (tab === "luyen-tap") practiceSet = null; renderQuizSection(); });
  ({ "luyen-tap": panePractice, "thi": paneExam, "bang-tong": paneOverall, "xep-hang": paneRank, "lich-su": paneHistory, "quan-tri": paneAdmin }[tab] || panePractice)();
}
const confirmLeave = () => confirm("Bài thi đang làm sẽ bị hủy. Tiếp tục?") && (stopTimer(), exam = null, true);

function paneOptions(q, chosen, reveal, cls = "") {
  return q.o.map((o, j) => {
    let c = cls;
    if (reveal) c = j === q.a ? "right" : (j === chosen ? "wrong" : "");
    else if (j === chosen) c = "sel";
    return `<button class="opt ${c}" type="button" data-j="${j}" ${reveal ? "disabled" : ""}><span class="l">${"ABCD"[j]}</span><span>${ab(hl(o))}</span></button>`;
  }).join("");
}

function paneOptionsExplain(q, chosen) {
  return `<div class="explain"><b>${chosen === q.a ? "Đúng." : chosen === undefined ? "Chưa trả lời." : "Chưa đúng."}</b> ${ab(esc(q.e))}<br>Căn cứ: ${esc(q.b)}</div>`;
}

function paneQuestionCard(q, chosen, reveal, extraHead = "") {
  return `<article class="card" data-q="${q.id}"><div class="r-head"><span class="eyebrow">${esc(q.topic)} · ${LEVELS[q.level] || ""}</span>${extraHead}</div>
    <p class="q">${ab(hl(q.q))}</p><div class="opts">${paneOptions(q, chosen, reveal)}</div>${reveal ? paneOptionsExplain(q, chosen) : ""}</article>`;
}

/* Luyện tập */
function paneOptionsChips() {
  return `<div class="chips">${["Tất cả", ...topics()].map(t => `<button class="chip" type="button" aria-pressed="${t === topicFilter}" data-t="${esc(t)}">${esc(t)}</button>`).join("")}</div>`;
}
let practiceSet = null, practiceAns = {};
function newPracticeSet() {
  const pool = DATA.questions.filter(q => topicFilter === "Tất cả" || q.topic === topicFilter);
  practiceSet = shuffle(pool).slice(0, 5).map(q => q.id);
  practiceAns = {};
}
function panePractice() {
  if (!practiceSet) newPracticeSet();
  const byId = Object.fromEntries(DATA.questions.map(q => [q.id, q]));
  const searching = !!query;
  const list = searching
    ? DATA.questions.filter(q => (topicFilter === "Tất cả" || q.topic === topicFilter) && hit(q.q, q.topic, q.o.join(" "))).slice(0, 20)
    : practiceSet.map(id => byId[id]).filter(Boolean);
  const done = list.filter(q => practiceAns[q.id] !== undefined).length, right = list.filter(q => practiceAns[q.id] === q.a).length;
  $("#pane").innerHTML = `<div class="meter"><span>${searching ? `Kết quả tìm kiếm: <b class="num">${list.length}</b> câu` : `Bộ 5 câu ngẫu nhiên · Đã trả lời <b class="num">${done}/${list.length}</b> · Đúng <b class="num">${right}</b>`}</span>
    <div class="bar"><i style="width:${list.length ? done / list.length * 100 : 0}%"></i></div>
    <button class="btn primary" id="reroll" type="button">5 câu khác</button></div>${paneOptionsChips()}
    ${!searching && done === list.length && list.length ? `<p class="hint">Hoàn thành: đúng ${right}/${list.length}. Bấm "5 câu khác" để luyện tiếp.</p>` : ""}
    <div class="stack">${list.map(q => paneQuestionCard(q, practiceAns[q.id], practiceAns[q.id] !== undefined)).join("") || `<p class="empty">Không có câu hỏi phù hợp.</p>`}</div>`;
  $("#pane").querySelectorAll(".chip").forEach(b => b.onclick = () => { topicFilter = b.dataset.t; newPracticeSet(); panePractice(); });
  $("#pane").querySelectorAll(".opt").forEach(b => b.onclick = () => { practiceAns[b.closest("[data-q]").dataset.q] = +b.dataset.j; panePractice(); });
  $("#reroll").onclick = () => { newPracticeSet(); panePractice(); window.scrollTo({ top: 0, behavior: "smooth" }); };
}

/* Thi */
const examKey = (topic, n) => `${topic}|${n}`;
function paneExam() {
  if (user && configured && !getConsent() && !exam && !result) {
    $("#pane").innerHTML = consentCard();
    $("#agree").onclick = () => { store.set(consentKey(), { at: new Date().toISOString(), nameMode: $("#pane").querySelector('input[name="nm"]:checked').value }); paneExam(); };
    $("#decline").onclick = () => signOut(auth);
    return;
  }
  if (exam) return renderExam();
  if (result) return renderResult();
  const pool = t => DATA.questions.filter(q => t === "Tất cả" || q.topic === t);
  $("#pane").innerHTML = `<div class="card">
    <div class="form">
      <label for="ex-topic">Chủ đề<select id="ex-topic">${["Tất cả", ...topics()].map(t => `<option>${esc(t)}</option>`).join("")}</select></label>
      <label for="ex-n">Số câu<select id="ex-n">${[10, 20, 40].map(n => `<option value="${n}">${n} câu</option>`).join("")}</select></label>
      <label for="ex-level">Mức độ<select id="ex-level">${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label for="ex-time">Thời gian<select id="ex-time"><option value="60">1 phút/câu</option><option value="90">1,5 phút/câu</option><option value="0">Không giới hạn</option></select></label>
    </div>
    <p class="hint" id="ex-info"></p>
    <button class="btn primary" id="ex-start" type="button">Tạo đề và bắt đầu</button>
    ${!user ? `<p class="hint">Cần đăng nhập Google để lưu kết quả và tham gia xếp hạng. Chưa đăng nhập vẫn làm thử được.</p>` : ""}
  </div>`;
  const info = () => {
    const t = $("#ex-topic").value, n = +$("#ex-n").value, lv = +$("#ex-level").value;
    const avail = pool(t).filter(q => !lv || q.level === lv).length;
    $("#ex-info").textContent = avail >= n ? `Ngân hàng có ${avail} câu phù hợp; đề sẽ bốc ngẫu nhiên ${n} câu.` : `Ngân hàng chỉ có ${avail} câu phù hợp; đề sẽ gồm ${avail} câu và không tính vào bảng xếp hạng.`;
    $("#ex-start").disabled = avail === 0;
  };
  ["ex-topic", "ex-n", "ex-level"].forEach(id => $("#" + id).onchange = info); info();
  $("#ex-start").onclick = () => {
    const t = $("#ex-topic").value, n = +$("#ex-n").value, lv = +$("#ex-level").value, per = +$("#ex-time").value;
    const qs = shuffle(pool(t).filter(q => !lv || q.level === lv)).slice(0, n).map(q => {
      const order = shuffle([0, 1, 2, 3].slice(0, q.o.length));
      return { ...q, o: order.map(i => q.o[i]), a: order.indexOf(q.a) };
    });
    exam = { topic: t, n, level: lv, ranked: qs.length === n && lv === 0, qs, ans: {}, flags: {}, cur: 0, start: Date.now(), limit: per ? per * qs.length : 0 };
    startTimer(); renderExam();
  };
}
function startTimer() {
  stopTimer();
  timerId = setInterval(() => {
    if (!exam) return stopTimer();
    const el = $("#timer"); if (!el) return;
    const used = Math.floor((Date.now() - exam.start) / 1000);
    if (exam.limit) { const left = exam.limit - used; el.textContent = fmtTime(Math.max(0, left)); el.classList.toggle("low", left <= 60); if (left <= 0) submitExam(true); }
    else el.textContent = fmtTime(used);
  }, 500);
}
function stopTimer() { clearInterval(timerId); timerId = null; }
function renderExam() {
  const q = exam.qs[exam.cur], answered = Object.keys(exam.ans).length;
  $("#pane").innerHTML = `<div class="exam-bar"><span class="timer" id="timer">--:--</span>
    <div class="qnav">${exam.qs.map((x, i) => `<button type="button" data-i="${i}" class="${exam.ans[x.id] !== undefined ? "done" : ""} ${exam.flags[x.id] ? "flag" : ""}" aria-label="Câu ${i + 1}" ${i === exam.cur ? 'aria-current="true" style="outline:2px solid var(--ink)"' : ""}>${i + 1}</button>`).join("")}</div>
    <button class="btn primary" id="submit" type="button">Nộp bài (${answered}/${exam.qs.length})</button></div>
    ${paneQuestionCard(q, exam.ans[q.id], false, `<button class="flagbtn" id="flag" type="button" aria-pressed="${!!exam.flags[q.id]}">${exam.flags[q.id] ? "Đã đánh dấu" : "Đánh dấu xem lại"}</button>`)}
    <div class="top" style="margin-top:14px"><button class="btn" id="prev" type="button" ${exam.cur === 0 ? "disabled" : ""}>Câu trước</button><button class="btn" id="next" type="button" ${exam.cur === exam.qs.length - 1 ? "disabled" : ""}>Câu sau</button></div>`;
  $("#pane").querySelectorAll(".qnav button").forEach(b => b.onclick = () => { exam.cur = +b.dataset.i; renderExam(); });
  $("#pane").querySelectorAll(".opt").forEach(b => b.onclick = () => { exam.ans[q.id] = +b.dataset.j; if (exam.cur < exam.qs.length - 1) exam.cur++; renderExam(); });
  $("#flag").onclick = () => { exam.flags[q.id] = !exam.flags[q.id]; renderExam(); };
  $("#prev").onclick = () => { exam.cur--; renderExam(); };
  $("#next").onclick = () => { exam.cur++; renderExam(); };
  $("#submit").onclick = () => { const miss = exam.qs.length - Object.keys(exam.ans).length; if (!miss || confirm(`Còn ${miss} câu chưa trả lời. Nộp bài?`)) submitExam(false); };
}
async function submitExam(timeout) {
  if (!exam) return;
  stopTimer();
  const e = exam; exam = null;
  const total = e.qs.length, correct = e.qs.filter(q => e.ans[q.id] === q.a).length;
  const duration = Math.max(1, Math.round((Date.now() - e.start) / 1000));
  result = { ...e, total, correct, score: Math.round(correct / total * 100) / 10, duration, timeout, saved: null };
  renderResult();
  if (configured && user) {
    try {
      await addDoc(collection(db, "attempts"), {
        uid: user.uid, name: publicName(), photo: user.photoURL || "",
        key: examKey(e.topic, e.n), topic: e.topic, level: e.level, ranked: e.ranked,
        total, correct, score: result.score, duration, createdAt: serverTimestamp()
      });
      result.saved = true;
    } catch (err) { result.saved = false; result.err = err.message; }
    if (tab === "thi") renderResult();
  }
}
function renderResult() {
  const r = result;
  const save = !configured || !user ? "Chưa đăng nhập: kết quả không được lưu." : r.saved === null ? "Đang lưu kết quả…" : r.saved ? (r.ranked ? "Đã lưu và tính vào bảng xếp hạng." : "Đã lưu (đề không đủ chuẩn nên không xếp hạng).") : "Lưu thất bại: " + esc(r.err);
  $("#pane").innerHTML = `<div class="card"><div class="score"><span class="big num">${r.score.toFixed(1)}</span>
    <span>Đúng <b class="num">${r.correct}/${r.total}</b> · Thời gian <b class="num">${fmtTime(r.duration)}</b>${r.timeout ? " · Hết giờ" : ""}</span></div>
    <p class="hint">${save}</p><div class="top"><button class="btn primary" id="again" type="button">Tạo đề mới</button><button class="btn" id="torank" type="button">Xem xếp hạng</button></div></div>
    <h2>Xem lại bài làm</h2><div class="stack">${r.qs.map(q => paneQuestionCard(q, r.ans[q.id], true)).join("")}</div>`;
  $("#again").onclick = () => { result = null; paneExam(); };
  $("#torank").onclick = () => { tab = "bang-tong"; renderQuizSection(); };
}

/* Xếp hạng: lấy 500 lượt gần nhất, tính điểm cao nhất mỗi người (không cần chỉ mục ghép) */
let rankKey = examKey("Tất cả", 10);
async function fetchAttempts(extra = []) {
  const snap = await getDocs(fq(collection(db, "attempts"), ...extra, orderBy("createdAt", "desc"), limit(500)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
function needLogin(msg) {
  if (!configured) { $("#pane").innerHTML = `<p class="empty">Trang chưa kết nối Firebase. Xem README để cấu hình.</p>`; return true; }
  if (!user) { $("#pane").innerHTML = `<div class="card"><p>${msg}</p><button class="btn primary" type="button" id="lg">Đăng nhập Google</button></div>`; $("#lg").onclick = login; return true; }
  return false;
}
async function paneRank() {
  if (!configured) { $("#pane").innerHTML = `<p class="empty">Trang chưa kết nối Firebase.</p>`; return; }
  const keys = ["Tất cả", ...topics()].flatMap(t => [10, 20, 40].map(n => examKey(t, n)));
  $("#pane").innerHTML = `<div class="form"><label for="rk">Bộ đề<select id="rk">${keys.map(k => `<option value="${esc(k)}" ${k === rankKey ? "selected" : ""}>${esc(k.replace("|", " · "))} câu</option>`).join("")}</select></label></div><div id="rk-body"><p class="empty">Đang tải…</p></div><p class="hint">Bảng xếp hạng mang tính tham khảo: điểm chấm trên trình duyệt của người thi. Quản trị viên rà soát và xóa lượt thi bất thường.</p>`;
  $("#rk").onchange = e => { rankKey = e.target.value; paneRank(); };
  try {
    const rows = (await fetchAttempts()).filter(a => a.key === rankKey && a.ranked);
    const best = {};
    rows.forEach(a => { const b = best[a.uid]; if (!b || a.score > b.score || (a.score === b.score && a.duration < b.duration)) best[a.uid] = { ...a, count: (b?.count || 0) + 1 }; else b.count++; });
    const list = Object.values(best).sort((a, b) => b.score - a.score || a.duration - b.duration);
    $("#rk-body").innerHTML = list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Hạng</th><th>Người thi</th><th>Điểm</th><th>Thời gian</th><th>Số lượt</th></tr></thead><tbody>
      ${list.map((a, i) => `<tr class="${i === 0 ? "rank1" : ""} ${a.uid === user?.uid ? "me-row" : ""}"><td class="num">${i + 1}</td><td>${esc(a.name)}</td><td class="num">${a.score.toFixed(1)}</td><td class="num">${fmtTime(a.duration)}</td><td class="num">${a.count}</td></tr>`).join("")}
      </tbody></table></div><p class="hint">Xếp theo điểm cao nhất, bằng điểm thì thời gian ngắn hơn đứng trước.</p>` : `<p class="empty">Chưa có lượt thi nào cho bộ đề này.</p>`;
  } catch (e) { $("#rk-body").innerHTML = `<p class="empty">Không tải được: ${esc(e.message)}</p>`; }
}
/* Bảng xếp hạng tổng hợp theo người: gộp mọi lượt thi đã lưu */
async function paneOverall() {
  if (!configured) { $("#pane").innerHTML = `<p class="empty">Trang chưa kết nối Firebase.</p>`; return; }
  $("#pane").innerHTML = `<p class="empty">Đang tải…</p>`;
  try {
    const per = {};
    (await fetchAttempts()).forEach(a => {
      const p = per[a.uid] ||= { uid: a.uid, name: a.name, n: 0, c: 0, t: 0, best: 0, last: 0 };
      p.n++; p.c += a.correct; p.t += a.total; p.best = Math.max(p.best, +a.score);
      const ts = a.createdAt?.seconds || 0; if (ts > p.last) { p.last = ts; p.name = a.name; }
    });
    const all = Object.values(per).map(p => ({ ...p, avg: p.t ? p.c / p.t * 10 : 0 }));
    const list = all.filter(p => p.t >= 10).sort((a, b) => b.avg - a.avg || b.t - a.t || b.best - a.best);
    const pending = all.filter(p => p.t < 10);
    const me = user ? all.find(p => p.uid === user.uid) : null;
    $("#pane").innerHTML = `${me ? `<div class="card"><div class="score"><span class="big num">${me.avg.toFixed(1)}</span><span>Điểm trung bình của anh/chị · <b class="num">${me.n}</b> lượt · đúng <b class="num">${me.c}/${me.t}</b> câu · cao nhất <b class="num">${me.best.toFixed(1)}</b>${me.t < 10 ? " · cần làm đủ 10 câu để vào bảng" : ` · hạng <b class="num">${list.findIndex(p => p.uid === user?.uid) + 1}/${list.length}</b>`}</span></div></div>` : (user ? `<p class="hint">Anh/chị chưa có lượt thi nào. Vào tab Thi để bắt đầu.</p>` : `<p class="hint">Đăng nhập Google để lưu kết quả thi và có tên trên bảng xếp hạng.</p>`)}
    <h2>Bảng xếp hạng tổng (tham khảo)</h2>
    ${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Hạng</th><th>Người thi</th><th>Điểm TB</th><th>Đúng / tổng câu</th><th>Số lượt</th><th>Cao nhất</th></tr></thead><tbody>
      ${list.map((p, i) => `<tr class="${i === 0 ? "rank1" : ""} ${p.uid === user?.uid ? "me-row" : ""}"><td class="num">${i + 1}</td><td>${esc(p.name)}</td><td class="num">${p.avg.toFixed(2)}</td><td class="num">${p.c}/${p.t}</td><td class="num">${p.n}</td><td class="num">${p.best.toFixed(1)}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="empty">Chưa có ai đủ điều kiện xếp hạng.</p>`}
    <p class="hint">Bảng xếp hạng mang tính tham khảo: điểm chấm trên trình duyệt của người thi. Quản trị viên rà soát và xóa lượt thi bất thường.</p>
    <p class="hint">Điểm TB = tổng câu đúng / tổng câu đã thi × 10, gộp mọi lượt thi (kể cả đề không xếp hạng theo bộ đề). Cần tối thiểu 10 câu để vào bảng. Bằng điểm thì ai làm nhiều câu hơn đứng trước.${pending.length ? ` Có ${pending.length} người chưa đủ 10 câu.` : ""}</p>`;
  } catch (e) { $("#pane").innerHTML = `<p class="empty">Không tải được: ${esc(e.message)}</p>`; }
}
async function paneHistory() {
  if (needLogin("Đăng nhập để xem lịch sử thi.")) return;
  $("#pane").innerHTML = `<p class="empty">Đang tải…</p>`;
  try {
    const snap = await getDocs(fq(collection(db, "attempts"), where("uid", "==", user.uid), limit(200)));
    const rows = snap.docs.map(d => d.data()).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    const nm = getConsent()?.nameMode || "full";
    $("#pane").innerHTML = `<div class="form"><label for="nm-sel">Tên hiển thị cho các lượt thi mới<select id="nm-sel"><option value="full" ${nm === "full" ? "selected" : ""}>Họ tên đầy đủ</option><option value="short" ${nm === "short" ? "selected" : ""}>Viết tắt (${esc(shortName(user.displayName))})</option></select></label></div>`
      + (rows.length ? attemptTable(rows, false) : `<p class="empty">Anh/chị chưa có lượt thi nào.</p>`);
    $("#nm-sel").onchange = e => { const c = getConsent() || {}; c.nameMode = e.target.value; store.set(consentKey(), c); };
  } catch (e) { $("#pane").innerHTML = `<p class="empty">Không tải được: ${esc(e.message)}</p>`; }
}
function attemptTable(rows, admin) {
  return `<div class="tbl-wrap"><table><thead><tr><th>Thời điểm</th>${admin ? "<th>Người thi</th>" : ""}<th>Bộ đề</th><th>Điểm</th><th>Đúng</th><th>Thời gian</th>${admin ? "<th></th>" : ""}</tr></thead><tbody>
    ${rows.map(a => `<tr><td class="num">${a.createdAt ? new Date(a.createdAt.seconds * 1000).toLocaleString("vi-VN") : "–"}</td>${admin ? `<td>${esc(a.name)}</td>` : ""}<td>${esc((a.key || "").replace("|", " · "))}${a.ranked ? "" : " <span class='tag'>không xếp hạng</span>"}</td><td class="num">${(+a.score).toFixed(1)}</td><td class="num">${a.correct}/${a.total}</td><td class="num">${fmtTime(a.duration)}</td>${admin ? `<td><button class="btn danger" type="button" data-del="${a.id}">Xóa</button></td>` : ""}</tr>`).join("")}
    </tbody></table></div>`;
}
async function paneAdmin() {
  if (!isAdmin()) return paneRank();
  $("#pane").innerHTML = `<p class="empty">Đang tải…</p>`;
  try {
    const rows = await fetchAttempts();
    $("#pane").innerHTML = `<p class="hint">${rows.length} lượt thi gần nhất. Xóa lượt thi không hợp lệ (gian lận, thi thử).</p>` + attemptTable(rows, true);
    $("#pane").querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      if (!confirm("Xóa lượt thi này?")) return;
      try { await deleteDoc(doc(db, "attempts", b.dataset.del)); paneAdmin(); } catch (e) { alert("Không xóa được: " + e.message); }
    });
  } catch (e) { $("#pane").innerHTML = `<p class="empty">Không tải được: ${esc(e.message)}</p>`; }
}

/* Danh sách truy cập nhanh: nút cuộn tới mục trong trang (không dùng #id vì # dành cho điều hướng) */
const slug = t => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const quickNav = (items, label = "Truy cập nhanh") => items.length ? `<div class="qnavbar" role="navigation" aria-label="${esc(label)}"><span class="qlabel">${esc(label)}</span>${items.map(([id, t]) => `<button type="button" class="chip" data-jump="${esc(id)}">${esc(t)}</button>`).join("")}</div>` : "";
const smoothTo = y => { const start = scrollY; scrollTo({ top: y, behavior: "smooth" }); setTimeout(() => { if (Math.abs(scrollY - start) < 2 && Math.abs(y - start) > 2) scrollTo(0, y); }, 400); };
view.addEventListener("click", e => { const b = e.target.closest("[data-jump]"); if (!b) return; const el = document.getElementById(b.dataset.jump); if (el) smoothTo(el.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(el).scrollMarginTop || 0)); });

/* ---------- III. Cẩm nang công nghệ ---------- */
const SEV = { c: "CAO", w: "TB", o: "THẤP" };
const riskBlock = types => {
  const rs = (DATA.risks || []).filter(r => types.includes(r.type));
  if (!rs.length) return "";
  return `<section class="card" id="t-risk"><h3>Rủi ro phát triển dự án</h3><p class="hint">Do Sổ tay tổng hợp từ thực tế, không thuộc tài liệu nguồn.</p>
    ${rs.map(r => `${rs.length > 1 ? `<div class="eyebrow">${esc(r.type)}</div>` : ""}${r.items.map(i => `<div class="risk"><span class="sev ${i[0]}">${SEV[i[0]]}</span><div><b>${hl(i[1])}:</b> ${hl(i[2])}</div><div class="m">→ ${hl(i[3])}</div></div>`).join("")}`).join("")}</section>`;
};
const srcLine = (T, t) => { const s = T.sources[t.src]; return `${esc(s.title)}, ${esc(t.chapter)}, trang ${esc(t.pages)} (số trang theo file PDF). ${esc(s.org)}. ${esc(s.date)}.`; };
const firstVal = (t, re) => { for (const sh of t.sheets) { const r = sh.rows.find(x => re.test(x[0])); if (r) return { v: r[2], u: r[1], y: (sh.cols || ["2025"])[0] }; } return null; };
function techSheet(sh) {
  const cols = sh.cols || ["2025", "2030", "2040", "2050"];
  return `<div class="tbl-wrap"><table class="tsheet"><caption>${esc(sh.name)} <span class="hint">· trang ${sh.page}</span></caption>
    <thead><tr><th>Thông số</th><th>Đơn vị</th>${cols.map(c => `<th class="num">${c}</th>`).join("")}</tr></thead>
    <tbody>${sh.rows.map(r => `<tr><td>${hl(r[0])}</td><td class="hint">${esc(r[1])}</td>${r.slice(2).map(v => `<td class="num">${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
const nfmt = v => v.toLocaleString("vi-VN", { maximumFractionDigits: 3 });
function hbars(c) {
  const totals = c.cats.map((_, i) => c.series.reduce((a, s) => a + s.values[i], 0));
  const max = Math.max(...totals);
  const stack = c.series.length > 1;
  return `<figure class="pchart"><figcaption>${esc(c.title)}</figcaption>
    ${stack ? `<div class="glegend">${c.series.map((s, k) => `<span><b class="pc${k}"></b>${esc(s.name)}</span>`).join("")}</div>` : ""}
    ${c.cats.map((cat, i) => `<div class="prow"><div class="plab">${esc(cat)}</div><div class="ptrack"><div class="pbar" style="--w:${(totals[i] / max * 100).toFixed(2)}%">${c.series.map((s, k) => `<i class="pc${stack ? k : 0}" style="flex:${s.values[i]}" title="${esc(s.name)}: ${nfmt(s.values[i])} ${esc(c.unit)}"></i>`).join("")}<span>${nfmt(totals[i])}</span></div></div></div>`).join("")}
    <p class="hint">Đơn vị: ${esc(c.unit)}.</p></figure>`;
}
function capexTrend(t) {
  const rows = t.sheets.map(sh => { const r = sh.rows.find(x => /^Suất đầu tư/.test(x[0])); return r ? { name: sh.name.replace(/ \(cột đầu là 2030\)/, ""), unit: r[1], cols: sh.cols || ["2025", "2030", "2040", "2050"], v: r.slice(2).map(num), raw: r.slice(2) } : null; }).filter(Boolean);
  if (!rows.length) return "";
  const max = Math.max(...rows.flatMap(r => r.v).filter(Number.isFinite));
  return `<figure class="pchart trend"><figcaption>Xu hướng suất đầu tư (${esc(rows[0].unit)}, USD 2025)</figcaption>
    ${rows.map(r => `<div class="tgroup"><div class="plab">${esc(r.name)}</div><div class="tyears">${r.v.map((v, i) => `<div class="ty"><div class="tcol"><div style="--h:${Number.isFinite(v) ? (v / max * 100).toFixed(1) : 0}%"><span>${esc(r.raw[i])}</span></div></div><em>${r.cols[i]}</em></div>`).join("")}</div></div>`).join("")}
  </figure>`;
}
function potentialBlock(t) {
  const p = t.potential;
  const kp = p && p.kpis ? `<div class="pkpi">${p.kpis.map(k => `<div><b>${esc(k[0])}</b><span>${esc(k[1])}</span></div>`).join("")}</div>` : "";
  const trend = capexTrend(t);
  if (!p && !trend) return "";
  const tb = p && p.table ? `<div class="tbl-wrap"><table><thead><tr>${p.table.head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${p.table.rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? "num" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "";
  return `<section class="card" id="t-pot"><h3>${p ? "Tiềm năng và số liệu trực quan" : "Biểu đồ trực quan"}</h3>
    ${kp}${p && p.maps ? `<div class="pmaps">${p.maps.map(m => `<figure class="pmap"><a href="${esc(m[0])}" target="_blank" rel="noopener"><img src="${esc(m[0])}" alt="${esc(m[1])}" loading="lazy"></a><figcaption><b>${esc(m[1])}</b><br>${esc(m[2])}. Trích từ ${esc(DATA.tech.sources[t.src].title)}, trang ${esc(m[3])}.</figcaption></figure>`).join("")}</div>` : ""}${p && p.chart ? hbars(p.chart) : ""}${tb}${trend}
    ${p && p.map ? `<p><a class="btn" href="${esc(p.map[1])}" target="_blank" rel="noopener">🗺 ${esc(p.map[0])} ↗</a></p>` : ""}
    ${p && p.note ? `<p class="hint">${esc(p.note)}${p.page ? ` Trang ${esc(p.page)} tài liệu nguồn.` : ""}</p>` : ""}</section>`;
}
function renderTech(sub) {
  const T = DATA.tech;
  if (!T || !T.items) { view.innerHTML = `<h1>Cẩm nang công nghệ</h1><p class="empty">Chưa tải được dữ liệu.</p>`; return; }
  const disc = `<section class="card disclaimer" id="t-disc"><h3>Nguồn và miễn trừ trách nhiệm</h3>
    <p><b>Nguồn:</b></p><ul>${Object.values(T.sources).map(s => `<li>${esc(s.title)} – ${esc(s.org)}, ${esc(s.date)}. ${esc(s.note)}.</li>`).join("")}</ul>
    <p class="hint">Tài liệu nguồn cho phép sử dụng, chia sẻ, in tái bản với điều kiện ghi rõ nguồn.</p>
    <p><b>Miễn trừ trách nhiệm:</b></p><ul>${T.disclaimer.map(d => `<li>${esc(d)}</li>`).join("")}</ul></section>`;
  const t = T.items.find(x => x.id === sub);
  if (!t) {
    const list = T.items.filter(x => hit(x.name, x.summary, x.group));
    view.innerHTML = `<h1>Cẩm nang công nghệ</h1>
    <p class="lede">Tóm lược đặc tính kỹ thuật, chi phí và xu hướng đến 2050 của từng loại hình công nghệ, theo Cẩm nang Công nghệ Việt Nam 2026 của Cục Điện lực và Cục Năng lượng Đan Mạch (EAV & DEA). Chi phí tính bằng USD năm 2025.</p>
    <div class="qtech">${T.groups.map(g => `<div class="qgroup"><span class="qlabel">${esc(g)}</span>${T.items.filter(x => x.group === g).map(x => `<a class="chip" href="#cong-nghe/${x.id}">${esc(x.name)}</a>`).join("")}</div>`).join("")}</div>
    ${T.groups.map(g => { const it = list.filter(x => x.group === g); return it.length ? `<h2>${g}</h2><div class="tgrid">${it.map(x => {
      const cap = firstVal(x, /^Suất đầu tư/), cf = firstVal(x, /^Hệ số công suất|^Hiệu suất/);
      return `<a class="card tcard" href="#cong-nghe/${x.id}"><h3>${hl(x.name)}</h3><p>${hl(x.summary.split(". ")[0].replace(/\.$/, ""))}.</p>
        <div class="tkpi">${cap ? `<span><b class="num">${esc(cap.v)}</b> ${esc(cap.u)} <i>(${cap.y})</i></span>` : ""}${cf ? `<span><b class="num">${esc(cf.v)}${/^%/.test(cf.u) ? "%" : ""}</b>${/^%/.test(cf.u) ? "" : " " + esc(cf.u)} ${/Hiệu suất/.test(x.sheets[0].rows.map(r => r[0]).join()) && !/Hệ số công suất/.test(x.sheets[0].rows.map(r => r[0]).join()) ? "hiệu suất" : "hệ số công suất"}</span>` : ""}</div>
        <span class="hint">${esc(x.chapter)} · trang ${esc(x.pages)}</span></a>`; }).join("")}</div>` : ""; }).join("") || `<p class="empty">Không có công nghệ phù hợp.</p>`}
    <h2>Rủi ro chung – dự án lưới truyền tải</h2>${riskBlock(["Lưới truyền tải"])}
    <p class="hint">Đủ 30 công nghệ theo 2 cẩm nang: 17 phát điện, 6 lưu trữ, 7 nhiên liệu tái tạo và Power-to-X.</p>
    ${disc}`;
    return;
  }
  const others = T.items.filter(x => x.id !== t.id);
  view.innerHTML = `<p class="crumb"><a href="#cong-nghe">Cẩm nang công nghệ</a> / ${esc(t.group)}</p>
  <h1>${esc(t.name)}</h1>
  <p class="lede">${hl(t.summary)}</p>
  <div class="qswitch"><label>Chuyển nhanh đến công nghệ <select id="tswitch">${T.groups.map(g => `<optgroup label="${esc(g)}">${T.items.filter(x => x.group === g).map(x => `<option value="${x.id}" ${x.id === t.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</optgroup>`).join("")}</select></label></div>
  ${quickNav([["t-vn", "Đặc điểm tại Việt Nam"], ["t-pot", "Tiềm năng, biểu đồ"], ["t-data", "Bảng số liệu"], ["t-pc", "Ưu, nhược điểm"], ["t-risk", "Rủi ro dự án"], ["t-src", "Nguồn"], ["t-disc", "Miễn trừ"]].filter(([id]) => id !== "t-vn" || (t.vn && t.vn.length)).filter(([id]) => id !== "t-risk" || (t.risk && t.risk.length && DATA.risks.some(r => t.risk.includes(r.type)))).filter(([id]) => id !== "t-data" || t.sheets.length).filter(([id]) => id !== "t-pot" || t.potential || t.sheets.some(sh => sh.rows.some(r => /^Suất đầu tư/.test(r[0])))))}
  <div class="stack">
    ${t.vn && t.vn.length ? `<section class="card" id="t-vn"><h3>Đặc điểm tại Việt Nam và giả định chính</h3><ul>${t.vn.map(v => `<li>${hl(v)}</li>`).join("")}</ul></section>` : ""}
    ${potentialBlock(t)}
    ${t.sheets.length ? `<section class="card" id="t-data"><h3>Bảng số liệu chính</h3><p class="hint">Giá trị trung tâm; chi phí USD năm 2025, chưa gồm VAT. Khoảng bất định xem bản gốc.</p>${t.sheets.map(techSheet).join("")}</section>` : ""}
    <div class="pc" id="t-pc"><section class="card pro"><h3>Ưu điểm</h3><ul>${t.pros.map(v => `<li>${hl(v)}</li>`).join("")}</ul></section>
    <section class="card con"><h3>Nhược điểm</h3><ul>${t.cons.map(v => `<li>${hl(v)}</li>`).join("")}</ul></section></div>
    ${t.sheets.length ? "" : `<section class="card"><p class="hint">Tài liệu nguồn chưa xây dựng bảng số liệu cho công nghệ này.</p></section>`}
    ${riskBlock(t.risk || [])}
    <section class="card src" id="t-src"><h3>Nguồn tài liệu</h3><p>${srcLine(T, t)}</p></section>
    ${disc}
    <div class="tnext">${others.map(x => `<a class="chip" href="#cong-nghe/${x.id}">${esc(x.name)}</a>`).join("")}</div>
  </div>`;

  $("#tswitch").onchange = e => { location.hash = "#cong-nghe/" + e.target.value; };}

/* ---------- 01. Tin tức ngành điện ---------- */
let newsGroup = "Tất cả", newsTopic = "Tất cả", newsDays = 3, newsLayout = store.get("stnl-news-layout", "grid");
const RANGES = [[3, "3 ngày"], [7, "7 ngày"], [45, "45 ngày"]];
const ago = d => { const h = Math.round((Date.now() - new Date(d)) / 36e5); return h < 1 ? "vừa xong" : h < 24 ? `${h} giờ trước` : new Date(d).toLocaleDateString("vi-VN"); };
const NEWS_GROUPS = ["Bộ Công Thương", "Chính phủ", "Bộ Tài chính", "EVN", "NSMO", "EVNNPT"];
function newsCard(i) {
  const href = esc(i.url || i.link);
  return `<article class="ncard">
    <div class="nbody">
      <div class="nmeta"><span>${esc(i.source)}</span><span class="num">${ago(i.date)}</span></div>
      <h3><a href="${href}" target="_blank" rel="noopener">${hl(i.title)}</a></h3>
      <span class="tag">${esc(i.topic)}</span>
    </div></article>`;
}
function renderNews() {
  const N = DATA.news || { items: [] };
  const all = (N.items || []).filter(i => NEWS_GROUPS.includes(i.group));
  const since = Date.now() - newsDays * 864e5;
  const items = all.filter(i => new Date(i.date) >= since);
  const groups = ["Tất cả", ...new Set(items.map(i => i.group))];
  const tops = ["Tất cả", ...new Set(items.map(i => i.topic))];
  if (!groups.includes(newsGroup)) newsGroup = "Tất cả";
  if (!tops.includes(newsTopic)) newsTopic = "Tất cả";
  const list = items.filter(i => (newsGroup === "Tất cả" || i.group === newsGroup) && (newsTopic === "Tất cả" || i.topic === newsTopic) && hit(i.title, i.source, i.topic, ""));
  const chips = (arr, cur, key) => `<div class="chips">${arr.map(t => { const [v, l] = Array.isArray(t) ? t : [t, t]; return `<button class="chip" type="button" aria-pressed="${v === cur}" data-${key}="${esc(v)}">${esc(l)}</button>`; }).join("")}</div>`;
  const upd = N.updated ? new Date(N.updated).toLocaleString("vi-VN") : "chưa cập nhật";
  const empty = `<p class="empty">${all.length ? "Không có tin phù hợp." : "Chưa có tin. Hệ thống sẽ tự cập nhật trong lần chạy tới."}</p>`;
  view.innerHTML = `<h1>Tin tức ngành điện</h1>
  <p class="lede">Tổng hợp tự động tiêu đề tin từ cổng thông tin của Bộ Công Thương, Cổng TTĐT Chính phủ, Bộ Tài chính, EVN, NSMO và EVNNPT. Trang chỉ hiển thị tiêu đề, nguồn và link; bấm tiêu đề để đọc bài gốc tại trang nguồn. Cập nhật lúc 8h và 18h hằng ngày.</p>
  <div class="nbar"><span class="hint">Cập nhật: <b class="num">${esc(upd)}</b> · <b class="num">${list.length}</b> tin</span>
    <div class="seg" role="group" aria-label="Kiểu hiển thị"><button type="button" data-l="grid" aria-pressed="${newsLayout === "grid"}">Lưới</button><button type="button" data-l="list" aria-pressed="${newsLayout === "list"}">Danh sách</button></div></div>
  <div class="frow"><span class="eyebrow">Thời gian</span>${chips(RANGES, newsDays, "d")}</div>
  <div class="frow"><span class="eyebrow">Nguồn</span>${chips(groups, newsGroup, "g")}</div>
  <div class="frow"><span class="eyebrow">Chủ đề</span>${chips(tops, newsTopic, "t")}</div>
  ${!list.length ? empty : newsLayout === "grid"
    ? `<div class="ngrid">${list.slice(0, 120).map(newsCard).join("")}</div>`
    : `<div class="tbl-wrap"><table><thead><tr><th>Ngày</th><th>Tiêu đề</th><th>Nguồn</th><th>Chủ đề</th></tr></thead><tbody>
      ${list.slice(0, 200).map(i => `<tr><td class="num">${new Date(i.date).toLocaleDateString("vi-VN")}</td><td><a href="${esc(i.url || i.link)}" target="_blank" rel="noopener">${hl(i.title)}</a></td><td>${esc(i.source)}</td><td><span class="tag">${esc(i.topic)}</span></td></tr>`).join("")}
      </tbody></table></div>`}`;
  view.querySelectorAll("[data-d]").forEach(b => b.onclick = () => { newsDays = +b.dataset.d; renderNews(); });
  view.querySelectorAll("[data-g]").forEach(b => b.onclick = () => { newsGroup = b.dataset.g; renderNews(); });
  view.querySelectorAll("[data-t]").forEach(b => b.onclick = () => { newsTopic = b.dataset.t; renderNews(); });
  view.querySelectorAll("[data-l]").forEach(b => b.onclick = () => { newsLayout = b.dataset.l; store.set("stnl-news-layout", newsLayout); renderNews(); });
}

/* ---------- 04. Tra cứu nhanh ---------- */
const linkCell = u => !u ? `<span class="hint">–</span>` : (user || !configured) ? `<a href="${esc(u)}" target="_blank" rel="noopener">Xem ↗</a>` : `<button class="lock" type="button" data-login title="Đăng nhập để mở văn bản">🔒 Đăng nhập</button>`;
function table(head, rows, monoCols = [], linkCol = -1) {
  const r = (rows || []).filter(x => hit(x.join(" ")));
  return `<div class="tbl-wrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${r.map(x => `<tr>${x.map((c, i) => i === linkCol ? `<td>${linkCell(c)}</td>` : `<td class="${monoCols.includes(i) ? "num" : ""}">${hl(c)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${head.length}" class="empty">Không có kết quả.</td></tr>`}</tbody></table></div>`;
}
/* Khung giá phát điện dạng đồ thị thanh ngang: loại hình có giá theo miền vẽ 3 thanh, còn lại 1 thanh toàn quốc */
const GEN_GROUPS = [["Điện mặt trời", /ĐMT/], ["Điện gió", /gió/i], ["Thủy điện", /Thủy điện/], ["Nhiệt điện", /Nhiệt điện|Tuabin khí/], ["Sinh khối, chất thải", /sinh khối|chất thải/i]];
const num = s => parseFloat(String(s).replace(/\./g, "").replace(",", "."));
function genChart(rows) {
  const r = (rows || []).filter(x => hit(x.join(" ")));
  if (!r.length) return `<p class="empty">Không có kết quả.</p>`;
  const max = Math.ceil(Math.max(...r.flatMap(x => [1, 2, 3].map(i => num(x[i])))) / 500) * 500;
  const ticks = []; for (let t = 0; t <= max; t += 1000) ticks.push(t);
  const fmt = v => v.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  const bar = (v, cls, lab) => `<div class="gbar ${cls}" style="--w:${(v / max * 100).toFixed(2)}%"><span>${lab ? `<i>${lab}</i> ` : ""}${fmt(v)}</span></div>`;
  const row = x => {
    const v = [1, 2, 3].map(i => num(x[i])), same = v.every(y => y === v[0]);
    return `<div class="grow"><div class="glab">${hl(x[0])} <span class="tag">${esc(x[4])}</span></div>
      <div class="gtrack">${same ? bar(v[0], "g-all", "") : bar(v[0], "g-n", "Bắc") + bar(v[1], "g-c", "Trung") + bar(v[2], "g-s", "Nam")}</div></div>`;
  };
  const used = new Set();
  const groups = GEN_GROUPS.map(([g, re]) => {
    const items = r.filter(x => !used.has(x) && re.test(x[0])).sort((a, b) => Math.max(num(b[1]), num(b[2]), num(b[3])) - Math.max(num(a[1]), num(a[2]), num(a[3])));
    items.forEach(x => used.add(x));
    return items.length ? `<div class="ggroup"><div class="ghead">${g}</div>${items.map(row).join("")}</div>` : "";
  }).join("") + (r.filter(x => !used.has(x)).map(row).join(""));
  return `<div class="gchart" role="img" aria-label="Đồ thị giá tối đa khung giá phát điện theo loại hình, đồng/kWh">
    <div class="glegend"><span><b class="g-n"></b>Miền Bắc</span><span><b class="g-c"></b>Miền Trung</span><span><b class="g-s"></b>Miền Nam</span><span><b class="g-all"></b>Áp dụng chung cả nước</span></div>
    <div class="gaxis">${ticks.map(t => `<span style="--x:${(t / max * 100).toFixed(2)}%">${fmt(t)}</span>`).join("")}</div>
    <div class="gbody" style="--grid:${(1000 / max * 100).toFixed(3)}%">${groups}</div>
    <p class="hint">Đơn vị: đồng/kWh, giá tối đa, chưa gồm VAT. Nhãn năm cho biết khung giá áp dụng (2025 hoặc 2026).</p></div>`;
}
function renderLookup() {
  const L = DATA.lookup;
  const secs = [["q-gen", "Khung giá phát điện 2026"], ["q-other", "Cơ chế giá khác"], ["q-docs", "Văn bản pháp luật"], ["q-abbr", "Thuật ngữ viết tắt"]];
  const fields = [...new Set((L.docs || []).map(r => r[0]))];
  view.innerHTML = `<h1>Tra cứu nhanh</h1>
  <p class="lede">Khung giá phát điện, cơ chế giá, văn bản pháp luật và thuật ngữ thường dùng. Bấm "Xem" để mở văn bản hoặc nguồn tham chiếu.</p>
  ${quickNav(secs)}
  ${gateBanner("Đăng nhập để mở link văn bản gốc và nguồn tham chiếu.")}
  <h2 id="q-gen">Khung giá phát điện 2026</h2>
  <p class="hint">Giá tối đa, đồng/kWh, chưa gồm VAT.</p>
  ${genChart(L.gen)}
  <details class="gtable"><summary>Xem dạng bảng và văn bản căn cứ</summary>${table(["Loại hình", "Miền Bắc", "Miền Trung", "Miền Nam", "Năm", "Văn bản", "Xem"], L.gen, [1, 2, 3, 4], 6)}</details>
  <ul class="hint">${(L.genNotes || []).map(n => `<li>${esc(n)}</li>`).join("")}</ul>
  <h2 id="q-other">Cơ chế giá khác</h2>${table(["Đối tượng", "Cơ chế", "Văn bản", "Xem"], L.other, [], 3)}
  <h2 id="q-docs">Văn bản pháp luật</h2>
  ${quickNav(fields.map(f => ["q-doc-" + slug(f), f]), "Lĩnh vực")}
  ${fields.map(f => `<h3 id="q-doc-${slug(f)}" class="dochead">${esc(f)}</h3>${table(["Loại", "Số hiệu", "Trích yếu", "Xem"], L.docs.filter(r => r[0] === f).map(r => r.slice(1)), [1], 3)}`).join("")}
  <p class="hint">Link dẫn đến cổng thông tin cơ quan nhà nước hoặc trang tra cứu pháp luật. Đối chiếu bản gốc có chữ ký số trước khi viện dẫn chính thức.</p>
  <h2 id="q-abbr">Thuật ngữ viết tắt</h2>
  <div class="tbl-wrap"><table><thead><tr><th>Viết tắt</th><th>Nghĩa</th></tr></thead><tbody>${Object.entries(ABBR).filter(([k]) => hit(k, ABBR[k])).map(([k, v]) => `<tr><td><b>${k}</b></td><td>${hl(v)}</td></tr>`).join("")}</tbody></table></div>`;
  wireGate();
}

/* ---------- Chính sách dữ liệu và bản quyền ---------- */
function renderPolicy() {
  view.innerHTML = `<h1>Chính sách dữ liệu và bản quyền</h1>
  <div class="stack policy">
    <section class="card"><h3>1. Dữ liệu cá nhân</h3>
      <p>Đăng nhập bằng Google chỉ để xác định người thi. Trang lưu trên Firebase (Google, máy chủ Singapore): mã người dùng, tên hiển thị (đầy đủ hoặc viết tắt theo lựa chọn), ảnh đại diện, kết quả, thời gian làm bài. Trang không lưu email, không bán hay chia sẻ dữ liệu cho bên thứ ba.</p>
      <p>Mục đích: chấm điểm, lưu lịch sử, lập bảng xếp hạng công khai (hiển thị tên đã chọn và điểm). Người dùng có thể đổi cách hiển thị tên ở tab "Lịch sử của tôi" và yêu cầu xóa dữ liệu qua email liên hệ.</p></section>
    <section class="card"><h3>1a. Trợ lý hỏi đáp AI</h3>
      <p>Trợ lý dùng mô hình Gemini của Google qua Firebase AI Logic. Câu hỏi của người dùng cùng các đoạn nội dung liên quan của Sổ tay được gửi tới Google để tạo câu trả lời; Sổ tay không lưu lịch sử hỏi đáp trên máy chủ. Không nhập thông tin cá nhân, bí mật kinh doanh vào ô hỏi đáp. Câu trả lời do AI tạo, có thể sai, chỉ mang tính tham khảo.</p></section>
    <section class="card"><h3>2. Tin tức</h3>
      <p>Mục Tin tức chỉ hiển thị tiêu đề, tên nguồn, ngày đăng và đường dẫn đến bài gốc trên cổng thông tin của cơ quan nhà nước, doanh nghiệp ngành điện. Trang không sao chép nội dung, hình ảnh của bài viết.</p></section>
    <section class="card"><h3>3. Văn bản và đường dẫn</h3>
      <p>Đường dẫn trong mục Tra cứu dẫn đến nơi đăng văn bản gốc hoặc trang tra cứu pháp luật. Bản quyền nội dung tại các trang đó thuộc chủ sở hữu tương ứng.</p></section>
    <section class="card"><h3>4. Yêu cầu gỡ bỏ</h3>
      <p>Chủ sở hữu nội dung cần gỡ đường dẫn, hoặc người dùng cần xóa dữ liệu, xin liên hệ <b>Nghiêm Trọng Việt</b>, email <span class="mail">nghiemtrongviet@gmail.com</span>. Yêu cầu hợp lệ sẽ được xử lý trong thời gian sớm nhất.</p></section>
    <section class="card"><h3>5. Miễn trừ</h3>
      <p>Nội dung phục vụ học tập và tra cứu trong lĩnh vực năng lượng. Khi áp dụng cho trường hợp cụ thể, hãy đối chiếu văn bản gốc và hướng dẫn mới nhất của cơ quan có thẩm quyền.</p></section>
  </div>`;
}

/* ---------- Điều hướng ---------- */
const routes = { "tin-tuc": renderNews, "tu-kiem-tra": renderQuizSection, "cong-nghe": renderTech, "tra-cuu": renderLookup, "chinh-sach": renderPolicy };
let current = "";
function route() {
  if (location.hash === "#rui-ro") { history.replaceState(null, "", "#cong-nghe"); }
  const [h, sub] = location.hash.slice(1).split("/");
  const v = routes[h] ? h : "tin-tuc";
  if (current === "tu-kiem-tra" && v !== current && exam && !confirmLeave()) { history.replaceState(null, "", "#tu-kiem-tra"); return; }
  if (v === "tu-kiem-tra" && current !== v) practiceSet = null;
  current = v;
  document.querySelectorAll("#nav a").forEach(a => a.dataset.v === v ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  routes[v](sub);
  if (sub) scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", e => { if (exam) { e.preventDefault(); e.returnValue = ""; } });
$("#q").addEventListener("input", e => {
  query = e.target.value.trim().toLowerCase();
  if (current === "tu-kiem-tra") { if (tab === "luyen-tap") panePractice(); } else route();
});
$("#theme").onclick = () => {
  const r = document.documentElement, dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  r.dataset.theme = dark ? "light" : "dark"; store.set("stnl-theme", r.dataset.theme);
};
{ const t = store.get("stnl-theme", null); if (t) document.documentElement.dataset.theme = t; }

async function boot() {
  try {
    const [questions, risks, lookup, news, tech] = await Promise.all(["questions", "risks", "lookup", "news", "tech"].map(n => fetch(`data/${n}.json`, { cache: "no-cache" }).then(r => r.ok ? r.json() : null)));
    DATA = { questions: questions || [], risks: risks || [], lookup: lookup || {}, news: news || { items: [] }, tech };
  } catch (e) { view.innerHTML = `<p class="empty">Không tải được dữ liệu (${esc(e.message)}). Nếu mở file trực tiếp trên máy, hãy dùng GitHub Pages hoặc một máy chủ web.</p>`; return; }
  renderUser();
  route();
  if (configured) onAuthStateChanged(auth, u => {
    user = u; renderUser();
    if (!exam && (current === "tu-kiem-tra" || current === "tra-cuu")) route();
  });
}
boot();

/* Nút lên đầu trang */
{ const b = $("#totop"); if (b) { const f = () => b.classList.toggle("show", scrollY > 500); addEventListener("scroll", f, { passive: true }); f(); b.onclick = () => smoothTo(0); } }

/* ---------- Trợ lý hỏi đáp AI (Gemini qua Firebase AI Logic) ----------
   Chỉ trả lời dựa trên nội dung trang: chọn các đoạn dữ liệu liên quan nhất rồi gửi kèm câu hỏi. */
const FB = "https://www.gstatic.com/firebasejs/12.11.0/";
let aiModel = null, aiBusy = false, chunks = null;
const fold = t => String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
function buildChunks() {
  const C = [];
  const T = DATA.tech;
  if (T) T.items.forEach(t => {
    const rows = t.sheets.map(sh => `${sh.name} (trang ${sh.page}): ` + sh.rows.map(r => `${r[0]} ${r.slice(2).join("/")} ${r[1]}`).join("; ")).join(" | ");
    const pot = t.potential ? [(t.potential.kpis || []).map(k => k.join(": ")).join("; "), t.potential.table ? t.potential.table.rows.map(r => r.join(" – ")).join("; ") : "", t.potential.chart ? t.potential.chart.title + ": " + t.potential.chart.cats.map((c, i) => c + " " + t.potential.chart.series.map(s => s.values[i]).join("+")).join("; ") : ""].join(" ") : "";
    C.push({ title: "Cẩm nang công nghệ – " + t.name, link: "#cong-nghe/" + t.id, src: `${T.sources[t.src].title}, ${t.chapter}`, text: `${t.summary} Việt Nam: ${(t.vn || []).join(" ")} Tiềm năng: ${pot} Ưu điểm: ${t.pros.join("; ")} Nhược điểm: ${t.cons.join("; ")} Số liệu (các mốc năm theo bảng): ${rows}` });
  });
  const L = DATA.lookup || {};
  if (L.gen) C.push({ title: "Khung giá phát điện", link: "#tra-cuu", src: "Mục IV. Tra cứu nhanh", text: "Giá tối đa đồng/kWh chưa VAT (Bắc/Trung/Nam, năm, văn bản): " + L.gen.map(r => `${r[0]}: ${r[1]}/${r[2]}/${r[3]} (${r[4]}, ${r[5]})`).join("; ") + " " + (L.genNotes || []).join(" ") });
  if (L.other) C.push({ title: "Cơ chế giá khác", link: "#tra-cuu", src: "Mục IV. Tra cứu nhanh", text: L.other.map(r => r.slice(0, 3).join(" – ")).join("; ") });
  if (L.docs) [...new Set(L.docs.map(r => r[0]))].forEach(f => C.push({ title: "Văn bản pháp luật – " + f, link: "#tra-cuu", src: "Mục IV. Tra cứu nhanh", text: L.docs.filter(r => r[0] === f).map(r => `${r[1]} ${r[2]}: ${r[3]}`).join("; ") }));
  (DATA.questions || []).forEach(q => C.push({ title: "Câu hỏi " + q.topic, link: "#tu-kiem-tra", src: q.b, text: `Hỏi: ${q.q} Đáp án đúng: ${q.o[q.a]}. Giải thích: ${q.e} Căn cứ: ${q.b}` }));
  (DATA.risks || []).forEach(r => C.push({ title: "Rủi ro dự án – " + r.type, link: "#cong-nghe", src: "Sổ tay tổng hợp", text: r.items.map(i => `${i[1]}: ${i[2]} → ${i[3]}`).join("; ") }));
  C.forEach(c => { c.f = fold(c.title + " " + c.text); });
  return C;
}
function retrieve(q, k = 8) {
  if (!chunks && DATA.tech) chunks = buildChunks();
  if (!chunks) return [];
  const w = fold(q).split(/[^a-z0-9.,%]+/).filter(x => x.length > 1);
  const bi = w.slice(1).map((x, i) => w[i] + " " + x);
  const scored = chunks.map(c => {
    let s = 0;
    w.forEach(x => { if (c.f.includes(x)) s += x.length > 3 ? 2 : 1; });
    bi.forEach(x => { if (c.f.includes(x)) s += 4; });
    if (w.some(x => fold(c.title).includes(x))) s += 3;
    return [s, c];
  }).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, k).map(x => x[1]);
  let total = 0;
  return scored.filter(c => (total += c.text.length) < 14000);
}
async function ensureAI() {
  if (aiModel) return aiModel;
  if (!RECAPTCHA_SITE_KEY) throw new Error("Trợ lý AI chưa được cấu hình App Check.");
  const [{ initializeAppCheck, ReCaptchaV3Provider }, { getAI, getGenerativeModel, GoogleAIBackend }] = await Promise.all([import(FB + "firebase-app-check.js"), import(FB + "firebase-ai.js")]);
  initializeAppCheck(app, { provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  aiModel = getGenerativeModel(ai, {
    model: AI_MODEL,
    systemInstruction: "Bạn là trợ lý của trang Sổ tay đầu tư xây dựng ngành điện (Việt Nam). Chỉ trả lời dựa trên các đoạn TƯ LIỆU được cung cấp trong mỗi câu hỏi. Nếu tư liệu không đủ để trả lời, nói rõ 'Sổ tay chưa có thông tin này' và gợi ý mục liên quan, không tự suy đoán hay dùng kiến thức ngoài. Trả lời bằng tiếng Việt, ngắn gọn, nêu kết luận trước, giữ nguyên số liệu, đơn vị, số hiệu văn bản như trong tư liệu. Ghi nguồn bằng ký hiệu [số] tương ứng với đoạn tư liệu đã dùng. Không đưa lời khuyên pháp lý, đầu tư có tính ràng buộc.",
    generationConfig: { temperature: 0.2, maxOutputTokens: 900 }
  });
  return aiModel;
}
const DAY_LIMIT = 30;
const usageKey = () => "stnl-ai-" + (user ? user.uid : "x") + "-" + new Date().toISOString().slice(0, 10);
function renderAnswer(text, ctx) {
  let h = esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^\s*[-*•]\s+(.*)$/gm, "<li>$1</li>").replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`).replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>");
  h = h.replace(/\[(\d+)\]/g, (m, n) => { const c = ctx[+n - 1]; return c ? `<a class="cite" href="${c.link}" title="${esc(c.title)}">[${n}]</a>` : m; });
  return h;
}
function chatUI() {
  const box = document.createElement("div");
  box.innerHTML = `<button id="ai-fab" class="ai-fab" type="button" aria-label="Hỏi đáp AI" title="Hỏi đáp AI"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 9.5h8M8 12.5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Hỏi đáp</span></button>
  <section id="ai-panel" class="ai-panel" hidden aria-label="Trợ lý hỏi đáp">
    <header><b>Trợ lý Sổ tay</b><span class="hint">Gemini · trả lời theo nội dung trang</span><button type="button" class="ai-x" aria-label="Đóng">×</button></header>
    <div class="ai-log" id="ai-log" aria-live="polite"></div>
    <form id="ai-form"><textarea id="ai-q" rows="2" maxlength="600" placeholder="Ví dụ: Suất đầu tư điện gió ngoài khơi 2030?"></textarea><button class="btn primary" type="submit">Gửi</button></form>
    <p class="ai-note">AI có thể sai. Câu trả lời chỉ dựa trên nội dung Sổ tay, không thay thế văn bản gốc hay tư vấn chuyên môn. Không nhập thông tin cá nhân, bí mật.</p>
  </section>`;
  document.body.append(...box.children);
  const panel = $("#ai-panel"), log = $("#ai-log");
  const add = (cls, html) => { const d = document.createElement("div"); d.className = "ai-msg " + cls; d.innerHTML = html; log.append(d); log.scrollTop = log.scrollHeight; return d; };
  const greet = () => { log.innerHTML = ""; add("bot", user ? "Xin chào. Anh/chị hỏi về công nghệ, khung giá, quy định đấu nối, đầu tư xây dựng… Tôi trả lời theo nội dung Sổ tay và ghi nguồn [số] bấm được." : `Đăng nhập Google để dùng trợ lý hỏi đáp. <button class="btn" type="button" data-login>Đăng nhập</button>`); log.querySelector("[data-login]")?.addEventListener("click", login); };
  $("#ai-fab").onclick = () => { panel.hidden = !panel.hidden; document.body.classList.toggle("ai-open", !panel.hidden); if (!panel.hidden) { if (!log.children.length || !user || log.querySelector("[data-login]")) greet(); $("#ai-q").focus(); } };
  panel.querySelector(".ai-x").onclick = () => { panel.hidden = true; document.body.classList.remove("ai-open"); };
  $("#ai-q").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#ai-form").requestSubmit(); } });
  $("#ai-form").onsubmit = async e => {
    e.preventDefault();
    const q = $("#ai-q").value.trim();
    if (!q || aiBusy) return;
    if (!user) { greet(); return; }
    const used = +store.get(usageKey(), 0);
    if (used >= DAY_LIMIT) { add("bot", `Anh/chị đã dùng hết ${DAY_LIMIT} câu hỏi hôm nay. Vui lòng quay lại ngày mai.`); return; }
    $("#ai-q").value = ""; add("me", esc(q));
    const out = add("bot", `<span class="hint">Đang tra cứu…</span>`);
    aiBusy = true;
    try {
      const ctx = retrieve(q);
      if (!ctx.length) { out.innerHTML = "Sổ tay chưa có nội dung liên quan đến câu hỏi này. Anh/chị thử diễn đạt khác hoặc dùng ô tìm kiếm phía trên."; return; }
      const model = await ensureAI();
      const prompt = "TƯ LIỆU:\n" + ctx.map((c, i) => `[${i + 1}] ${c.title} (nguồn: ${c.src})\n${c.text}`).join("\n\n") + "\n\nCÂU HỎI: " + q;
      const res = await model.generateContentStream(prompt);
      let txt = "";
      for await (const ch of res.stream) { txt += ch.text(); out.innerHTML = renderAnswer(txt, ctx); log.scrollTop = log.scrollHeight; }
      out.innerHTML = renderAnswer(txt || "Không nhận được câu trả lời.", ctx) + `<div class="ai-src">Tư liệu: ${ctx.slice(0, 5).map((c, i) => `<a href="${c.link}">[${i + 1}] ${esc(c.title)}</a>`).join(" · ")}</div>`;
      store.set(usageKey(), used + 1);
    } catch (err) {
      out.innerHTML = `Không gọi được trợ lý AI (${esc(err.message || err)}). Vui lòng thử lại sau.`;
    } finally { aiBusy = false; }
  };
}
if (configured) chatUI();
