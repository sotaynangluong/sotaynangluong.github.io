import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query as fq, where, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ADMIN_UIDS } from "./firebase-config.js?v=8";

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
let exam = null;      // đề đang làm
let result = null;    // kết quả vừa nộp
let timerId = null;

function renderQuizSection() {
  const tabs = [["luyen-tap", "Luyện tập"], ["thi", "Thi"], ["bang-tong", "Bảng xếp hạng"], ["xep-hang", "Xếp hạng theo đề"], ["lich-su", "Lịch sử của tôi"]];
  if (isAdmin()) tabs.push(["quan-tri", "Quản trị"]);
  view.innerHTML = `<h1>Tự kiểm tra</h1>
    <p class="lede">Luyện tập tự do, hoặc tạo đề thi có tính giờ để chấm điểm và xếp hạng. Ngân hàng hiện có <b class="num">${DATA.questions.length}</b> câu hỏi.</p>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" type="button" data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join("")}</div>
    <div id="pane"></div>`;
  view.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { if (exam && !confirmLeave()) return; tab = b.dataset.tab; if (tab === "luyen-tap") practiceSet = null; renderQuizSection(); });
  ({ "luyen-tap": panePractice, "thi": paneExam, "bang-tong": paneOverall, "xep-hang": paneRank, "lich-su": paneHistory, "quan-tri": paneAdmin }[tab] || panePractice)();
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
/* Bảng xếp hạng tổng hợp theo người: gộp mọi lượt thi đã lưu */
async function paneOverall() {
  if (needLogin("Đăng nhập để xem bảng xếp hạng.")) return;
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
    const me = all.find(p => p.uid === user.uid);
    $("#pane").innerHTML = `${me ? `<div class="card"><div class="score"><span class="big num">${me.avg.toFixed(1)}</span><span>Điểm trung bình của anh/chị · <b class="num">${me.n}</b> lượt · đúng <b class="num">${me.c}/${me.t}</b> câu · cao nhất <b class="num">${me.best.toFixed(1)}</b>${me.t < 10 ? " · cần làm đủ 10 câu để vào bảng" : ` · hạng <b class="num">${list.findIndex(p => p.uid === user.uid) + 1}/${list.length}</b>`}</span></div></div>` : `<p class="hint">Anh/chị chưa có lượt thi nào. Vào tab Thi để bắt đầu.</p>`}
    <h2>Bảng xếp hạng tổng</h2>
    ${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Hạng</th><th>Người thi</th><th>Điểm TB</th><th>Đúng / tổng câu</th><th>Số lượt</th><th>Cao nhất</th></tr></thead><tbody>
      ${list.map((p, i) => `<tr class="${i === 0 ? "rank1" : ""} ${p.uid === user.uid ? "me-row" : ""}"><td class="num">${i + 1}</td><td>${esc(p.name)}</td><td class="num">${p.avg.toFixed(2)}</td><td class="num">${p.c}/${p.t}</td><td class="num">${p.n}</td><td class="num">${p.best.toFixed(1)}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="empty">Chưa có ai đủ điều kiện xếp hạng.</p>`}
    <p class="hint">Điểm TB = tổng câu đúng / tổng câu đã thi × 10, gộp mọi lượt thi (kể cả đề không xếp hạng theo bộ đề). Cần tối thiểu 10 câu để vào bảng. Bằng điểm thì ai làm nhiều câu hơn đứng trước.${pending.length ? ` Có ${pending.length} người chưa đủ 10 câu.` : ""}</p>`;
  } catch (e) { $("#pane").innerHTML = `<p class="empty">Không tải được: ${esc(e.message)}</p>`; }
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

/* ---------- 01. Tin tức ngành điện ---------- */
let newsGroup = "Tất cả", newsTopic = "Tất cả", newsDays = 3, newsLayout = store.get("stnl-news-layout", "grid");
const RANGES = [[3, "3 ngày"], [7, "7 ngày"], [45, "45 ngày"]];
const ago = d => { const h = Math.round((Date.now() - new Date(d)) / 36e5); return h < 1 ? "vừa xong" : h < 24 ? `${h} giờ trước` : new Date(d).toLocaleDateString("vi-VN"); };
function newsCard(i) {
  const href = esc(i.url || i.link);
  const pic = i.image
    ? `<img src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('noimg');this.remove()">`
    : "";
  return `<article class="ncard">
    <a class="nimg ${i.image ? "" : "noimg"}" href="${href}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${pic}<span>${esc((i.source || "?").slice(0, 1))}</span></a>
    <div class="nbody">
      <div class="nmeta"><span>${esc(i.source)}</span><span class="num">${ago(i.date)}</span></div>
      <h3><a href="${href}" target="_blank" rel="noopener">${hl(i.title)}</a></h3>
      ${i.excerpt ? `<p>${hl(i.excerpt)}</p>` : ""}
      <span class="tag">${esc(i.topic)}</span>
    </div></article>`;
}
function renderNews() {
  const N = DATA.news || { items: [] };
  const all = N.items || [];
  const since = Date.now() - newsDays * 864e5;
  const items = all.filter(i => new Date(i.date) >= since);
  const groups = ["Tất cả", ...new Set(items.map(i => i.group))];
  const tops = ["Tất cả", ...new Set(items.map(i => i.topic))];
  if (!groups.includes(newsGroup)) newsGroup = "Tất cả";
  if (!tops.includes(newsTopic)) newsTopic = "Tất cả";
  const list = items.filter(i => (newsGroup === "Tất cả" || i.group === newsGroup) && (newsTopic === "Tất cả" || i.topic === newsTopic) && hit(i.title, i.source, i.topic, i.excerpt || ""));
  const chips = (arr, cur, key) => `<div class="chips">${arr.map(t => { const [v, l] = Array.isArray(t) ? t : [t, t]; return `<button class="chip" type="button" aria-pressed="${v === cur}" data-${key}="${esc(v)}">${esc(l)}</button>`; }).join("")}</div>`;
  const upd = N.updated ? new Date(N.updated).toLocaleString("vi-VN") : "chưa cập nhật";
  const empty = `<p class="empty">${all.length ? "Không có tin phù hợp." : "Chưa có tin. Hệ thống sẽ tự cập nhật trong lần chạy tới."}</p>`;
  view.innerHTML = `<h1>Tin tức ngành điện</h1>
  <p class="lede">Tổng hợp tự động từ Bộ Công Thương, EVN, NSMO, Bộ Tài chính, Cổng TTĐT Chính phủ và báo chí năng lượng. Trích dẫn ngắn lấy từ thẻ chia sẻ của bài; bấm tiêu đề để đọc bài gốc.</p>
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
const linkCell = u => u ? `<a href="${esc(u)}" target="_blank" rel="noopener">Xem ↗</a>` : `<span class="hint">–</span>`;
function table(head, rows, monoCols = [], linkCol = -1) {
  const r = (rows || []).filter(x => hit(x.join(" ")));
  return `<div class="tbl-wrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${r.map(x => `<tr>${x.map((c, i) => i === linkCol ? `<td>${linkCell(c)}</td>` : `<td class="${monoCols.includes(i) ? "num" : ""}">${hl(c)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${head.length}" class="empty">Không có kết quả.</td></tr>`}</tbody></table></div>`;
}
function renderLookup() {
  const L = DATA.lookup;
  view.innerHTML = `<h1>Tra cứu nhanh</h1>
  <p class="lede">Giá điện, phân cấp, nhóm dự án và văn bản thường dùng. Bấm "Xem" để mở văn bản hoặc nguồn tham chiếu.</p>
  <h2>Giá bán lẻ điện 2025</h2>${table(["Nội dung", "Mức / phạm vi", "Thời điểm", "Văn bản", "Xem"], L.retail, [], 4)}
  <h2>Khung giá phát điện 2025</h2>
  <p class="hint">Giá tối đa, đồng/kWh, chưa gồm VAT.</p>
  ${table(["Loại hình", "Miền Bắc", "Miền Trung", "Miền Nam", "Văn bản", "Xem"], L.gen, [1, 2, 3], 5)}
  <ul class="hint">${(L.genNotes || []).map(n => `<li>${esc(n)}</li>`).join("")}</ul>
  <h2>Cơ chế giá khác</h2>${table(["Đối tượng", "Cơ chế", "Văn bản", "Xem"], L.other, [], 3)}
  <h2>Cấp điện áp và quản lý lưới</h2>${table(["Phân loại", "Cấp điện áp", "Đơn vị quản lý"], L.voltage, [1])}
  <h2>Thẩm định BCNCKT tại cơ quan chuyên môn – thời hạn</h2>
  <p class="hint">Theo NĐ 217/2026/NĐ-CP.</p>
  ${table(["Nhóm dự án", "Có công trình cấp I trở lên", "Các dự án còn lại", "Căn cứ"], L.apprTime, [1, 2])}
  <ul class="hint">${(L.apprNotes || []).map(n => `<li>${esc(n)}</li>`).join("")}</ul>
  <h2>Thẩm định BCNCKT tại cơ quan chuyên môn – thẩm quyền</h2>
  <ul class="hint">${(L.apprScope || []).map(n => `<li>${esc(n)}</li>`).join("")}</ul>
  ${table(["Trường hợp", "Cơ quan thẩm định", "Căn cứ"], L.apprAuth)}
  <h2>Cấp giấy phép xây dựng</h2>
  ${table(["Cơ quan cấp", "Phạm vi", "Căn cứ"], L.permit)}
  <ul class="hint">${(L.permitNotes || []).map(n => `<li>${esc(n)}</li>`).join("")}</ul>
  <h2>Văn bản pháp luật</h2>${table(["Loại", "Số hiệu", "Trích yếu", "Xem"], L.docs, [1], 3)}
  <p class="hint">Link dẫn đến cổng thông tin cơ quan nhà nước hoặc trang tra cứu pháp luật. Đối chiếu bản gốc có chữ ký số trước khi viện dẫn chính thức.</p>`;
}

/* ---------- Điều hướng ---------- */
const routes = { "tin-tuc": renderNews, "tu-kiem-tra": renderQuizSection, "rui-ro": renderRisk, "tra-cuu": renderLookup };
let current = "";
function route() {
  const v = routes[location.hash.slice(1)] ? location.hash.slice(1) : "tin-tuc";
  if (current === "tu-kiem-tra" && v !== current && exam && !confirmLeave()) { history.replaceState(null, "", "#tu-kiem-tra"); return; }
  if (v === "tu-kiem-tra" && current !== v) practiceSet = null;
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
    const [questions, risks, lookup, news] = await Promise.all(["questions", "risks", "lookup", "news"].map(n => fetch(`data/${n}.json`, { cache: "no-cache" }).then(r => r.ok ? r.json() : null)));
    DATA = { questions: questions || [], risks: risks || [], lookup: lookup || {}, news: news || { items: [] } };
  } catch (e) { view.innerHTML = `<p class="empty">Không tải được dữ liệu (${esc(e.message)}). Nếu mở file trực tiếp trên máy, hãy dùng GitHub Pages hoặc một máy chủ web.</p>`; return; }
  renderUser();
  route();
  if (configured) onAuthStateChanged(auth, u => {
    user = u; renderUser();
    if (current === "tu-kiem-tra" && !exam && tab !== "luyen-tap") renderQuizSection();
  });
}
boot();
