import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query as fq, where, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ADMIN_UIDS } from "./firebase-config.js";

/* ---------- Khởi tạo ---------- */
const configured = !!firebaseConfig.projectId;
let auth = null, db = null, user = null;
if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}
const isAdmin = () => !!user && ADMIN_UIDS.includes(user.uid);

const $ = s => document.querySelector(s);
const view = $("#view");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let DATA = { questions: [], risks: [], lookup: {} };
let query = "";
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const hit = (...p) => !query || p.join(" ").toLowerCase().includes(query);
const hl = s => { const t = esc(s); if (!query) return t; const i = t.toLowerCase().indexOf(query); return i < 0 ? t : t.slice(0, i) + "<mark>" + t.slice(i, i + query.length) + "</mark>" + t.slice(i + query.length); };
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

/* ---------- 01. Tự kiểm tra ---------- */
let tab = "luyen-tap", topicFilter = "Tất cả";
let practice = store.get("stnl-ans", {});
let exam = null;      // đề đang làm
let result = null;    // kết quả vừa nộp
let timerId = null;

function renderQuizSection() {
  const tabs = [["luyen-tap", "Luyện tập"], ["thi", "Thi"], ["xep-hang", "Xếp hạng"], ["lich-su", "Lịch sử của tôi"]];
  if (isAdmin()) tabs.push(["quan-tri", "Quản trị"]);
  view.innerHTML = `<h1>Tự kiểm tra</h1>
    <p class="lede">Luyện tập tự do, hoặc tạo đề thi có tính giờ để chấm điểm và xếp hạng. Ngân hàng hiện có <b class="num">${DATA.questions.length}</b> câu hỏi.</p>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" type="button" data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join("")}</div>
    <div id="pane"></div>`;
  view.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { if (exam && !confirmLeave()) return; tab = b.dataset.tab; renderQuizSection(); });
  ({ "luyen-tap": panePractice, "thi": paneExam, "xep-hang": paneRank, "lich-su": paneHistory, "quan-tri": paneAdmin }[tab] || panePractice)();
}
const confirmLeave = () => confirm("Bài thi đang làm sẽ bị hủy. Tiếp tục?") && (stopTimer(), exam = null, true);

function paneOptions(q, chosen, reveal, cls = "") {
  return q.o.map((o, j) => {
    let c = cls;
    if (reveal) c = j === q.a ? "right" : (j === chosen ? "wrong" : "");
    else if (j === chosen) c = "sel";
    return `<button class="opt ${c}" type="button" data-j="${j}" ${reveal ? "disabled" : ""}><span class="l">${"ABCD"[j]}</span><span>${hl(o)}</span></button>`;
  }).join("");
}

function paneOptionsExplain(q, chosen) {
  return `<div class="explain"><b>${chosen === q.a ? "Đúng." : chosen === undefined ? "Chưa trả lời." : "Chưa đúng."}</b> ${esc(q.e)}<br>Căn cứ: ${esc(q.b)}</div>`;
}

function paneQuestionCard(q, chosen, reveal, extraHead = "") {
  return `<article class="card" data-q="${q.id}"><div class="r-head"><span class="eyebrow">${esc(q.topic)} · ${LEVELS[q.level] || ""}</span>${extraHead}</div>
    <p class="q">${hl(q.q)}</p><div class="opts">${paneOptions(q, chosen, reveal)}</div>${reveal ? paneOptionsExplain(q, chosen) : ""}</article>`;
}

/* Luyện tập */
function paneOptionsChips() {
  return `<div class="chips">${["Tất cả", ...topics()].map(t => `<button class="chip" type="button" aria-pressed="${t === topicFilter}" data-t="${esc(t)}">${esc(t)}</button>`).join("")}</div>`;
}
function panePractice() {
  const list = DATA.questions.filter(q => (topicFilter === "Tất cả" || q.topic === topicFilter) && hit(q.q, q.topic, q.o.join(" ")));
  const done = Object.keys(practice).length, right = DATA.questions.filter(q => practice[q.id] === q.a).length;
  $("#pane").innerHTML = `<div class="meter"><span>Đã làm <b class="num">${done}/${DATA.questions.length}</b> · Đúng <b class="num">${right}</b></span>
    <div class="bar"><i style="width:${DATA.questions.length ? done / DATA.questions.length * 100 : 0}%"></i></div>
    <button class="btn" id="reset" type="button">Làm lại</button></div>${paneOptionsChips()}
    <div class="stack">${list.map(q => paneQuestionCard(q, practice[q.id], practice[q.id] !== undefined)).join("") || `<p class="empty">Không có câu hỏi phù hợp.</p>`}</div>`;
  $("#pane").querySelectorAll(".chip").forEach(b => b.onclick = () => { topicFilter = b.dataset.t; panePractice(); });
  $("#pane").querySelectorAll(".opt").forEach(b => b.onclick = () => { practice[b.closest("[data-q]").dataset.q] = +b.dataset.j; store.set("stnl-ans", practice); panePractice(); });
  $("#reset").onclick = () => { practice = {}; store.set("stnl-ans", practice); panePractice(); };
}

/* Thi */
const examKey = (topic, n) => `${topic}|${n}`;
function paneExam() {
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
        uid: user.uid, name: user.displayName || "Ẩn danh", photo: user.photoURL || "",
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
  $("#torank").onclick = () => { tab = "xep-hang"; rankKey = examKey(r.topic, r.n); renderQuizSection(); };
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
  if (needLogin("Đăng nhập để xem bảng xếp hạng.")) return;
  const keys = ["Tất cả", ...topics()].flatMap(t => [10, 20, 40].map(n => examKey(t, n)));
  $("#pane").innerHTML = `<div class="form"><label for="rk">Bộ đề<select id="rk">${keys.map(k => `<option value="${esc(k)}" ${k === rankKey ? "selected" : ""}>${esc(k.replace("|", " · "))} câu</option>`).join("")}</select></label></div><div id="rk-body"><p class="empty">Đang tải…</p></div>`;
  $("#rk").onchange = e => { rankKey = e.target.value; paneRank(); };
  try {
    const rows = (await fetchAttempts()).filter(a => a.key === rankKey && a.ranked);
    const best = {};
    rows.forEach(a => { const b = best[a.uid]; if (!b || a.score > b.score || (a.score === b.score && a.duration < b.duration)) best[a.uid] = { ...a, count: (b?.count || 0) + 1 }; else b.count++; });
    const list = Object.values(best).sort((a, b) => b.score - a.score || a.duration - b.duration);
    $("#rk-body").innerHTML = list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Hạng</th><th>Người thi</th><th>Điểm</th><th>Thời gian</th><th>Số lượt</th></tr></thead><tbody>
      ${list.map((a, i) => `<tr class="${i === 0 ? "rank1" : ""} ${a.uid === user.uid ? "me-row" : ""}"><td class="num">${i + 1}</td><td>${esc(a.name)}</td><td class="num">${a.score.toFixed(1)}</td><td class="num">${fmtTime(a.duration)}</td><td class="num">${a.count}</td></tr>`).join("")}
      </tbody></table></div><p class="hint">Xếp theo điểm cao nhất, bằng điểm thì thời gian ngắn hơn đứng trước.</p>` : `<p class="empty">Chưa có lượt thi nào cho bộ đề này.</p>`;
  } catch (e) { $("#rk-body").innerHTML = `<p class="empty">Không tải được: ${esc(e.message)}</p>`; }
}
async function paneHistory() {
  if (needLogin("Đăng nhập để xem lịch sử thi.")) return;
  $("#pane").innerHTML = `<p class="empty">Đang tải…</p>`;
  try {
    const snap = await getDocs(fq(collection(db, "attempts"), where("uid", "==", user.uid), limit(200)));
    const rows = snap.docs.map(d => d.data()).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    $("#pane").innerHTML = rows.length ? attemptTable(rows, false) : `<p class="empty">Anh/chị chưa có lượt thi nào.</p>`;
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

/* ---------- 02. Cẩm nang rủi ro ---------- */
function renderRisk() {
  const lab = { c: "CAO", w: "TB", o: "THẤP" };
  const list = DATA.risks.map(r => ({ ...r, items: r.items.filter(i => hit(r.type, i.join(" "))) })).filter(r => r.items.length);
  view.innerHTML = `<h1>Cẩm nang rủi ro</h1>
  <p class="lede">Ma trận rủi ro chính theo 8 loại hình dự án, kèm biện pháp kiểm soát. Mức độ: <span class="sev c">CAO</span> <span class="sev w">TB</span> <span class="sev o">THẤP</span></p>
  <div class="grid-r">${list.map(r => `<article class="card"><div class="r-head"><h3>${hl(r.type)}</h3><span class="tag">${r.items.length} rủi ro</span></div>
   ${r.items.map(i => `<div class="risk"><span class="sev ${i[0]}">${lab[i[0]]}</span><div><b>${hl(i[1])}:</b> ${hl(i[2])}</div><div class="m">→ ${hl(i[3])}</div></div>`).join("")}</article>`).join("") || `<p class="empty">Không có rủi ro phù hợp.</p>`}</div>`;
}

/* ---------- 03. Tra cứu nhanh ---------- */
function table(head, rows, monoCol) {
  const r = (rows || []).filter(x => hit(x.join(" ")));
  return `<div class="tbl-wrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${r.map(x => `<tr>${x.map((c, i) => `<td class="${i === monoCol ? "num" : ""}">${hl(c)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${head.length}" class="empty">Không có kết quả.</td></tr>`}</tbody></table></div>`;
}
function renderLookup() {
  const L = DATA.lookup;
  view.innerHTML = `<h1>Tra cứu nhanh</h1>
  <p class="lede">Bảng tra phân cấp, nhóm dự án, thẩm quyền và danh mục văn bản thường dùng.</p>
  <h2>Cấp điện áp và quản lý lưới</h2>${table(["Phân loại", "Cấp điện áp", "Đơn vị quản lý"], L.voltage, 1)}
  <h2>Phân loại nhóm dự án <span class="pending">· ngưỡng chờ rà</span></h2>${table(["Nhóm", "Tiêu chí (công trình điện)", "Thẩm quyền quyết định"], L.group, -1)}
  <h2>Văn bản pháp luật</h2>${table(["Loại", "Số hiệu", "Trích yếu"], L.docs, 1)}`;
}

/* ---------- Điều hướng ---------- */
const routes = { "tu-kiem-tra": renderQuizSection, "rui-ro": renderRisk, "tra-cuu": renderLookup };
let current = "";
function route() {
  const v = routes[location.hash.slice(1)] ? location.hash.slice(1) : "tu-kiem-tra";
  if (current === "tu-kiem-tra" && v !== current && exam && !confirmLeave()) { history.replaceState(null, "", "#tu-kiem-tra"); return; }
  current = v;
  document.querySelectorAll("#nav a").forEach(a => a.dataset.v === v ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  routes[v]();
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
    const [questions, risks, lookup] = await Promise.all(["questions", "risks", "lookup"].map(n => fetch(`data/${n}.json`, { cache: "no-cache" }).then(r => r.json())));
    DATA = { questions, risks, lookup };
  } catch (e) { view.innerHTML = `<p class="empty">Không tải được dữ liệu (${esc(e.message)}). Nếu mở file trực tiếp trên máy, hãy dùng GitHub Pages hoặc một máy chủ web.</p>`; return; }
  renderUser();
  route();
  if (configured) onAuthStateChanged(auth, u => {
    user = u; renderUser();
    if (current === "tu-kiem-tra" && !exam && tab !== "luyen-tap") renderQuizSection();
  });
}
boot();
