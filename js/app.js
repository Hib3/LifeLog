/* ===== いっぽ — app.js ===== */
"use strict";

/* ---------- state ---------- */
const STORE_KEY = "ippo-v1";
const defaultState = {
  name: "",
  reduceMotion: false,
  sound: true,
  voice: false,
  notify: false,
  installDismissed: false,
  diary: {},       // {"YYYY-MM-DD": {mood, text, good:[..], sleep, med, photo:bool}}
  wins: [],        // {ts, text}
  energy: [],      // {date:"YYYY-MM-DD", level:1-5}
  plans: [],       // {id, ifText, thenText}
  comebacks: 0,
  lastActiveDate: null,
};
let S = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign({}, defaultState, JSON.parse(raw));
  } catch (e) { /* corrupted -> start fresh */ }
  return structuredClone(defaultState);
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
function todayKey(d = new Date()) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* comeback detection: returning after >=2 days gap */
(function detectComeback() {
  const today = todayKey();
  if (S.lastActiveDate && S.lastActiveDate !== today) {
    const gap = (new Date(today) - new Date(S.lastActiveDate)) / 86400000;
    if (gap >= 2) {
      S.comebacks++;
      setTimeout(() => toast("おかえりなさい。戻ってきた、それだけで十分です 🌱"), 800);
    }
  }
  S.lastActiveDate = today;
  save();
})();

/* ---------- helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* gentle sound (WebAudio, no assets) */
let audioCtx = null;
function chime(freq = 660, dur = 0.5, type = "sine", vol = 0.12) {
  if (!S.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* audio unavailable */ }
}
function vibrate(pattern) { if (navigator.vibrate) navigator.vibrate(pattern); }

/* ---------- navigation ---------- */
let currentView = "home";
function go(view) {
  if (view === currentView) return;
  // leaving cleanup
  if (currentView === "start") resetStartFlow(false);
  if (currentView === "breathe") stopBreathing();
  $$(".view").forEach((v) => v.removeAttribute("data-active"));
  $("#view-" + view).setAttribute("data-active", "true");
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.nav === view));
  currentView = view;
  window.scrollTo({ top: 0 });
  if (view === "home") renderHome();
  if (view === "log") renderLog();
  if (view === "plan") renderPlans();
  if (view === "note") renderNote();
}
document.addEventListener("click", (e) => {
  const goBtn = e.target.closest("[data-go]");
  if (goBtn) go(goBtn.dataset.go);
});

/* ---------- home ---------- */
function renderGreeting() {
  const h = new Date().getHours();
  const word = h < 5 ? "深夜までおつかれさま" : h < 11 ? "おはようございます" : h < 18 ? "こんにちは" : "こんばんは";
  $("#greeting").textContent = S.name ? `${word}、${S.name}さん` : word;
}

const SUGGESTIONS = {
  1: {
    text: "空っぽの日。何もしなくていい。よかったら、寝たままできる呼吸だけ、いっしょにしませんか。",
    actions: [["呼吸する(寝たままOK)", "breathe"], ["今日は休むと記録する", "_rest"]],
  },
  2: {
    text: "低めの日。大きなことはしなくていい。「水を1杯飲む」くらいの一歩なら、できるかもしれません。",
    actions: [["超ミニ一歩をやってみる", "start"], ["まず呼吸を整える", "breathe"]],
  },
  3: {
    text: "ふつうの日。チャンスです。考えすぎる前に、2分だけ始めてみましょう。",
    actions: [["2分スターターへ", "start"], ["If-Then作戦を確認", "plan"]],
  },
  4: {
    text: "高めの日。いい波です。ただし全部やろうとしないで。いちばん大事な1つに絞りましょう。",
    actions: [["1つに絞って始める", "start"]],
  },
  5: {
    text: "エネルギーがあふれる日。少しだけブレーキを。やりすぎは数日後の反動になります。終了時刻を決めて、夜はしっかり休んで。",
    actions: [["終了時刻をIf-Thenに入れる", "plan"], ["呼吸でクールダウン", "breathe"]],
  },
};

function renderEnergy() {
  const today = S.energy.find((e) => e.date === todayKey());
  $$(".energy-btn").forEach((b) =>
    b.setAttribute("aria-checked", today && +b.dataset.level === today.level ? "true" : "false")
  );
  const card = $("#suggestion-card");
  if (today) {
    const s = SUGGESTIONS[today.level];
    $("#suggest-text").textContent = s.text;
    const wrap = $("#suggest-actions");
    wrap.innerHTML = "";
    s.actions.forEach(([label, target]) => {
      const b = document.createElement("button");
      b.className = "chip small";
      b.textContent = label;
      if (target === "_rest") {
        b.addEventListener("click", () => { addWin("今日は休むと決めた(立派な判断)"); toast("記録しました。休むのも仕事のうち。"); });
      } else {
        b.dataset.go = target;
      }
      wrap.appendChild(b);
    });
    card.classList.remove("hidden");
  } else {
    card.classList.add("hidden");
  }
}

$$(".energy-btn").forEach((b) =>
  b.addEventListener("click", () => {
    const level = +b.dataset.level;
    const today = todayKey();
    const ex = S.energy.find((e) => e.date === today);
    if (ex) ex.level = level; else S.energy.push({ date: today, level });
    if (S.energy.length > 60) S.energy = S.energy.slice(-60);
    save();
    chime(520, 0.25);
    renderEnergy();
    updateBadge();
  })
);

function renderTodayWins() {
  const list = $("#today-wins");
  const today = todayKey();
  const wins = S.wins.filter((w) => todayKey(new Date(w.ts)) === today);
  list.innerHTML = wins.length
    ? wins.map((w) => `<li><span class="win-time">${fmtTime(w.ts)}</span>${esc(w.text)}</li>`).join("")
    : `<li class="win-empty">まだ記録はありません。ゼロの日があって当たり前です。</li>`;
}
function fmtTime(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
function addWin(text) {
  S.wins.push({ ts: Date.now(), text });
  if (S.wins.length > 500) S.wins = S.wins.slice(-500);
  save();
  renderTodayWins();
}
function renderHome() { renderGreeting(); renderEnergy(); renderTodayWins(); }

/* ---------- start flow (5sec rule + 2min timer) ---------- */
let countdownTimer = null, sessionTimer = null;
let timerTotal = 120, timerLeft = 120, timerEnd = 0, taskText = "";
const RING_LEN = 2 * Math.PI * 88; // 553

const stages = ["input", "countdown", "timer", "done"];
function showStage(name) {
  stages.forEach((s) => $("#stage-" + s).classList.toggle("hidden", s !== name));
}

$("#task-input").addEventListener("input", (e) => {
  $("#btn-to-countdown").disabled = !e.target.value.trim();
});
$("#task-chips").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  $("#task-input").value = chip.textContent;
  $("#btn-to-countdown").disabled = false;
});

$("#btn-to-countdown").addEventListener("click", () => {
  taskText = $("#task-input").value.trim();
  if (!taskText) return;
  showStage("countdown");
  let n = 5;
  const num = $("#count-num");
  const tick = () => {
    num.textContent = n;
    num.parentElement.classList.remove("count-pop");
    void num.parentElement.offsetWidth; // restart animation
    num.parentElement.classList.add("count-pop");
    chime(440 + (5 - n) * 60, 0.18, "triangle");
    vibrate(30);
    if (n === 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      startTimer(120);
      return;
    }
    n--;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
});

function startTimer(seconds) {
  timerTotal = seconds; timerLeft = seconds;
  timerEnd = Date.now() + seconds * 1000; // 実時刻基準 — iOSがバックグラウンドでintervalを止めても正しく進む
  $("#timer-task-label").textContent = taskText;
  $(".ring-sub").textContent = seconds <= 120 ? "2分だけ" : "+5分 延長中";
  showStage("timer");
  updateRing();
  chime(740, 0.4);
  requestWakeLock();
  sessionTimer = setInterval(tickTimer, 500);
}
function tickTimer() {
  timerLeft = Math.max(0, Math.round((timerEnd - Date.now()) / 1000));
  updateRing();
  if (timerLeft <= 0) {
    clearInterval(sessionTimer);
    sessionTimer = null;
    releaseWakeLock();
    chime(880, 0.7); setTimeout(() => chime(1100, 0.9), 250);
    vibrate([80, 60, 80]);
    notifyDone();
    showStage("done");
  }
}
function updateRing() {
  const m = Math.floor(timerLeft / 60), s = timerLeft % 60;
  $("#timer-display").textContent = m + ":" + String(s).padStart(2, "0");
  $("#ring-fg").style.strokeDashoffset = RING_LEN * (1 - timerLeft / timerTotal);
}

$("#btn-abort-timer").addEventListener("click", () => {
  const elapsed = timerTotal - timerLeft;
  resetStartFlow(false);
  if (elapsed >= 10) {
    addWin(`「${taskText}」に ${Math.max(1, Math.round(elapsed / 60))}分 向き合った`);
    toast("途中でやめてもゼロじゃない。記録しました。");
  } else {
    toast("また気が向いたらどうぞ。いつでもここにいます。");
  }
  go("home");
});

$("#btn-continue").addEventListener("click", () => {
  addWin(`「${taskText}」を2分やった → 続行中`);
  startTimer(300);
});
$("#btn-stop-here").addEventListener("click", () => {
  addWin(`「${taskText}」をやりきった`);
  resetStartFlow(true);
  toast("いっぽ、貯金しました 🌱");
  go("home");
});

function resetStartFlow(clearInput) {
  clearInterval(countdownTimer); countdownTimer = null;
  clearInterval(sessionTimer); sessionTimer = null;
  releaseWakeLock();
  if (clearInput) { $("#task-input").value = ""; $("#btn-to-countdown").disabled = true; }
  $("#ring-fg").style.strokeDashoffset = 0;
  showStage("input");
}

/* ---------- breathe ---------- */
let breathing = false, breatheTimer = null, breatheCycle = 0;
const PHASES = [
  { word: "吸って", cls: "inhale" },
  { word: "止めて", cls: "inhale" },
  { word: "吐いて", cls: "exhale" },
  { word: "止めて", cls: "exhale" },
];
$("#btn-breathe").addEventListener("click", () => (breathing ? stopBreathing() : startBreathing()));

function startBreathing() {
  breathing = true; breatheCycle = 0;
  $("#btn-breathe").textContent = "おわる";
  $("#breathe-dot").classList.add("run");
  requestWakeLock();
  let phase = 0;
  const box = $("#breathe-box"), word = $("#breathe-word");
  const step = () => {
    word.textContent = PHASES[phase].word;
    box.classList.remove("inhale", "exhale");
    void box.offsetWidth;
    box.classList.add(PHASES[phase].cls);
    chime(phase < 2 ? 520 : 392, 0.3, "sine", 0.07);
    speak(PHASES[phase].word);
    if (phase === 0 && breatheCycle > 0) {
      $("#breathe-cycles").textContent = `${breatheCycle}周 完了 — いい調子`;
    }
    phase = (phase + 1) % 4;
    if (phase === 0) breatheCycle++;
  };
  step();
  breatheTimer = setInterval(step, 4000);
}
function stopBreathing() {
  if (!breathing) return;
  breathing = false;
  clearInterval(breatheTimer); breatheTimer = null;
  releaseWakeLock();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  $("#btn-breathe").textContent = "はじめる";
  $("#breathe-word").textContent = "準備";
  $("#breathe-cycles").textContent = "";
  const box = $("#breathe-box");
  box.classList.remove("inhale", "exhale");
  $("#breathe-dot").classList.remove("run");
  if (breatheCycle >= 1) {
    addWin(`ボックス呼吸を${breatheCycle}周した`);
    toast("呼吸、おつかれさま。記録しました。");
  }
}

/* ---------- plans ---------- */
function renderPlans() {
  const list = $("#plan-list");
  if (!S.plans.length) {
    list.innerHTML = `<li class="plan-empty">まだ作戦がありません。「もし朝コーヒーをいれたら → 机に座る」のように、引き金と行動をセットで決めましょう。3つまでがおすすめ。</li>`;
    return;
  }
  list.innerHTML = S.plans.map((p) =>
    `<li class="plan-item" data-id="${p.id}">
      <span class="plan-text"><b>もし</b> ${esc(p.ifText)}<br><b>そのとき</b> ${esc(p.thenText)}</span>
      <button class="plan-del" aria-label="削除">✕</button>
    </li>`).join("");
}
$("#btn-add-plan").addEventListener("click", () => {
  const ifText = $("#plan-if").value.trim(), thenText = $("#plan-then").value.trim();
  if (!ifText || !thenText) { toast("IfとThen、両方うめてください"); return; }
  if (S.plans.length >= 5) { toast("作戦は5つまで。絞るほど効きます。"); return; }
  S.plans.push({ id: Date.now(), ifText, thenText });
  save();
  $("#plan-if").value = ""; $("#plan-then").value = "";
  renderPlans();
  chime(660, 0.3);
  toast("作戦を追加しました 🧭");
});
$("#plan-list").addEventListener("click", (e) => {
  if (!e.target.closest(".plan-del")) return;
  const id = +e.target.closest(".plan-item").dataset.id;
  S.plans = S.plans.filter((p) => p.id !== id);
  save();
  renderPlans();
});

/* ---------- log ---------- */
function renderLog() {
  $("#stat-total").textContent = S.wins.length;
  $("#stat-days").textContent = new Set(S.wins.map((w) => todayKey(new Date(w.ts)))).size;
  $("#stat-comeback").textContent = S.comebacks;

  // wave chart: last 14 days energy
  const chart = $("#wave-chart");
  chart.innerHTML = "";
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const rec = S.energy.find((e) => e.date === todayKey(d));
    const bar = document.createElement("div");
    bar.className = "wave-bar" + (rec ? (rec.level === 5 ? " high" : "") : " empty");
    bar.style.height = rec ? rec.level * 20 + "%" : "4px";
    bar.title = todayKey(d) + (rec ? `:レベル${rec.level}` : ":記録なし");
    chart.appendChild(bar);
  }

  const list = $("#log-list");
  const recent = S.wins.slice(-30).reverse();
  list.innerHTML = recent.length
    ? recent.map((w) => {
        const d = new Date(w.ts);
        return `<li><span class="win-time">${d.getMonth() + 1}/${d.getDate()} ${fmtTime(w.ts)}</span>${esc(w.text)}</li>`;
      }).join("")
    : `<li class="win-empty">記録はこれから。最初のいっぽを待っています。</li>`;
}

/* ---------- device APIs (iOS-aware, all feature-detected) ---------- */
let wakeLock = null;
async function requestWakeLock() {
  try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}
}
function releaseWakeLock() {
  try { wakeLock && wakeLock.release(); } catch (e) {}
  wakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (sessionTimer) tickTimer();                  // 復帰時に実時刻で再同期
    if (sessionTimer || breathing) requestWakeLock(); // ロックは自動解除されるので取り直す
  } else {
    updateBadge();
  }
});

function speak(text) {
  if (!S.voice || !("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP"; u.rate = 0.85; u.volume = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) {}
}

function notifyDone() {
  if (!S.notify || !document.hidden) return; // 画面を見ているなら通知不要
  try {
    if (Notification.permission === "granted" && navigator.serviceWorker) {
      navigator.serviceWorker.ready.then((reg) =>
        reg.showNotification("2分、動けた 🎉", {
          body: `「${taskText}」— 戻ってきたら記録しましょう`,
          icon: "icons/icon-192.png",
          badge: "icons/icon-192.png",
        }).catch(() => {})
      );
    }
  } catch (e) {}
}

/* app badge: 今日のチェックインがまだならアイコンに印 */
function updateBadge() {
  if (!("setAppBadge" in navigator)) return;
  const done = S.energy.some((e) => e.date === todayKey());
  (done ? navigator.clearAppBadge() : navigator.setAppBadge(1)).catch(() => {});
}

/* ---------- IndexedDB (photos) ---------- */
function idb() {
  return new Promise((res, rej) => {
    const req = indexedDB.open("ippo-photos", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("photos");
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function photoPut(date, blob) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction("photos", "readwrite");
    tx.objectStore("photos").put(blob, date);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function photoGet(date) {
  const db = await idb();
  return new Promise((res) => {
    const rq = db.transaction("photos").objectStore("photos").get(date);
    rq.onsuccess = () => res(rq.result || null);
    rq.onerror = () => res(null);
  });
}
async function photoDel(date) {
  const db = await idb();
  db.transaction("photos", "readwrite").objectStore("photos").delete(date);
}

/* ---------- note (diary / lifelog) ---------- */
let noteMood = 0, notePhotoBlob = null, notePhotoRemoved = false;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
function fmtDay(key) {
  const d = new Date(key + "T00:00");
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

function renderNote() {
  const key = todayKey();
  $("#note-date").textContent = "今日 — " + fmtDay(key);
  const e = S.diary[key] || {};
  noteMood = e.mood || 0;
  notePhotoBlob = null; notePhotoRemoved = false;
  $$(".mood-btn").forEach((b) => b.setAttribute("aria-checked", +b.dataset.mood === noteMood ? "true" : "false"));
  $("#note-text").value = e.text || "";
  ["#good-1", "#good-2", "#good-3"].forEach((sel, i) => { $(sel).value = (e.good && e.good[i]) || ""; });
  $("#note-sleep").value = e.sleep ?? "";
  $("#note-med").checked = !!e.med;
  const pv = $("#photo-preview");
  pv.classList.add("hidden");
  if (e.photo) {
    photoGet(key).then((blob) => {
      if (blob && !notePhotoRemoved) {
        $("#photo-thumb").src = URL.createObjectURL(blob);
        pv.classList.remove("hidden");
      }
    });
  }
  renderNoteList();
}

$$(".mood-btn").forEach((b) =>
  b.addEventListener("click", () => {
    noteMood = +b.dataset.mood;
    $$(".mood-btn").forEach((x) => x.setAttribute("aria-checked", x === b ? "true" : "false"));
    chime(500 + noteMood * 40, 0.2);
  })
);

$("#btn-photo").addEventListener("click", () => $("#note-photo-input").click());
$("#note-photo-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  notePhotoBlob = await shrinkImage(file, 1280, 0.82);
  notePhotoRemoved = false;
  $("#photo-thumb").src = URL.createObjectURL(notePhotoBlob);
  $("#photo-preview").classList.remove("hidden");
  e.target.value = "";
});
$("#btn-photo-del").addEventListener("click", () => {
  notePhotoBlob = null; notePhotoRemoved = true;
  $("#photo-preview").classList.add("hidden");
});

function shrinkImage(file, maxSide, quality) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      c.toBlob((b) => res(b || file), "image/jpeg", quality);
    };
    img.onerror = () => res(file);
    img.src = URL.createObjectURL(file);
  });
}

$("#btn-save-note").addEventListener("click", async () => {
  const key = todayKey();
  const prev = S.diary[key] || {};
  const good = ["#good-1", "#good-2", "#good-3"].map((sel) => $(sel).value.trim()).filter(Boolean);
  const sleepRaw = $("#note-sleep").value;
  const entry = {
    mood: noteMood || prev.mood || 0,
    text: $("#note-text").value.trim(),
    good,
    sleep: sleepRaw === "" ? null : Math.min(24, Math.max(0, parseFloat(sleepRaw))),
    med: $("#note-med").checked,
    photo: notePhotoRemoved ? false : (notePhotoBlob ? true : !!prev.photo),
  };
  if (!entry.mood && !entry.text && !good.length && entry.sleep == null && !entry.med && !entry.photo) {
    toast("気分の絵文字ひとつだけでも残せます"); return;
  }
  S.diary[key] = entry;
  save();
  if (notePhotoBlob) await photoPut(key, notePhotoBlob).catch(() => {});
  if (notePhotoRemoved) photoDel(key);
  requestPersist();
  chime(660, 0.35);
  toast("今日のページを記録しました 📓");
  renderNoteList();
});

async function renderNoteList() {
  const list = $("#note-list");
  const keys = Object.keys(S.diary).filter((k) => k !== todayKey()).sort().reverse().slice(0, 30);
  if (!keys.length) {
    list.innerHTML = `<li class="note-empty">過去のページはまだありません。今日の1ページが最初の1枚になります。</li>`;
    return;
  }
  const MOODS = ["", "😢", "😟", "😐", "🙂", "😊"];
  list.innerHTML = keys.map((k) => {
    const e = S.diary[k];
    const meta = [];
    if (e.sleep != null) meta.push(`😴${e.sleep}h`);
    if (e.med) meta.push("💊");
    return `<li class="note-entry" data-date="${k}">
      <div class="note-entry-head">
        <span class="note-mood">${MOODS[e.mood] || "·"}</span>
        <span class="note-day">${fmtDay(k)}</span>
        <span class="note-meta">${meta.join(" ")}</span>
      </div>
      ${e.text ? `<p class="note-body">${esc(e.text)}</p>` : ""}
      ${e.good && e.good.length ? `<ul class="note-goods">${e.good.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
      ${e.photo ? `<div class="note-photo" data-photo="${k}"></div>` : ""}
    </li>`;
  }).join("");
  // 写真は非同期で差し込む
  for (const k of keys) {
    if (!S.diary[k].photo) continue;
    const blob = await photoGet(k);
    const slot = list.querySelector(`[data-photo="${k}"]`);
    if (blob && slot) {
      const img = new Image();
      img.src = URL.createObjectURL(blob);
      img.alt = fmtDay(k) + "の写真";
      slot.appendChild(img);
    }
  }
}

/* ---------- persistent storage ---------- */
let persistAsked = false;
function requestPersist() {
  if (persistAsked || !navigator.storage || !navigator.storage.persist) return;
  persistAsked = true;
  navigator.storage.persist().catch(() => {});
}

/* ---------- install hint ---------- */
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  showInstallCard("アプリとしてインストールすると、オフラインでも全画面で使えます。");
});
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}
function showInstallCard(text, iosManual) {
  if (S.installDismissed || isStandalone()) return;
  $("#install-text").textContent = text;
  $("#btn-install-go").classList.toggle("hidden", !!iosManual);
  $("#install-card").classList.remove("hidden");
}
(function detectIOS() {
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (iOS && !isStandalone()) {
    showInstallCard("iPhoneの方へ:共有ボタン(□↑)→「ホーム画面に追加」でアプリになります。バッジや全画面表示が使えるようになります。", true);
  }
})();
$("#btn-install-go").addEventListener("click", async () => {
  if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; }
  $("#install-card").classList.add("hidden");
});
$("#btn-install-dismiss").addEventListener("click", () => {
  S.installDismissed = true; save();
  $("#install-card").classList.add("hidden");
});

/* ---------- settings ---------- */
$("#btn-settings").addEventListener("click", () => go("settings"));
$("#setting-name").value = S.name;
$("#setting-motion").checked = S.reduceMotion;
$("#setting-sound").checked = S.sound;
document.body.classList.toggle("reduce-motion", S.reduceMotion);

$("#setting-name").addEventListener("change", (e) => { S.name = e.target.value.trim(); save(); renderGreeting(); });
$("#setting-motion").addEventListener("change", (e) => {
  S.reduceMotion = e.target.checked; save();
  document.body.classList.toggle("reduce-motion", S.reduceMotion);
});
$("#setting-sound").addEventListener("change", (e) => { S.sound = e.target.checked; save(); });
$("#setting-voice").checked = S.voice;
$("#setting-voice").addEventListener("change", (e) => {
  S.voice = e.target.checked; save();
  if (S.voice) speak("音声ガイドをオンにしました");
});
$("#setting-notify").checked = S.notify && typeof Notification !== "undefined" && Notification.permission === "granted";
$("#setting-notify").addEventListener("change", async (e) => {
  if (!e.target.checked) { S.notify = false; save(); return; }
  if (typeof Notification === "undefined") {
    e.target.checked = false;
    toast("この端末は通知に対応していません"); return;
  }
  const perm = await Notification.requestPermission();
  if (perm === "granted") { S.notify = true; save(); toast("バックグラウンド時に完了をお知らせします"); }
  else { e.target.checked = false; toast("通知が許可されませんでした"); }
});

/* storage status */
(async function storageStatus() {
  const el = $("#storage-note");
  try {
    const persisted = await navigator.storage.persisted();
    const est = await navigator.storage.estimate();
    const used = (est.usage / 1048576).toFixed(1);
    el.textContent = `データは端末内のみ・使用 ${used}MB・永続化 ${persisted ? "✓ 有効" : "未設定(記録すると自動申請)"}`;
  } catch (e) { el.textContent = "データは端末内のみに保存されます"; }
})();

$("#btn-share").addEventListener("click", async () => {
  const today = todayKey();
  const wins = S.wins.filter((w) => todayKey(new Date(w.ts)) === today).map((w) => "・" + w.text);
  const text = wins.length
    ? `今日のいっぽ(${fmtDay(today)})\n${wins.join("\n")}\n— いっぽ より`
    : `「いっぽ」を使っています。動けない日の、最初の一歩を助けるアプリです。`;
  if (navigator.share) {
    try { await navigator.share({ text }); } catch (e) { /* キャンセル */ }
  } else {
    try { await navigator.clipboard.writeText(text); toast("クリップボードにコピーしました"); }
    catch (e) { toast("この端末では共有に対応していません"); }
  }
});

$("#btn-backup").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(S, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ippo-backup-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("バックアップを保存しました(写真は含みません)");
});
$("#btn-import").addEventListener("click", () => $("#import-input").click());
$("#import-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.wins)) throw new Error("invalid");
      if (!confirm("現在の記録をバックアップの内容で置き換えます。よろしいですか?")) return;
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.assign({}, defaultState, data)));
      location.reload();
    } catch (err) { toast("読み込めませんでした。いっぽのバックアップファイルを選んでください"); }
  };
  reader.readAsText(file);
  e.target.value = "";
});

$("#btn-export").addEventListener("click", () => {
  const lines = ["# いっぽ 記録エクスポート", "", "## できたログ"];
  S.wins.forEach((w) => lines.push(`- ${new Date(w.ts).toLocaleString("ja-JP")} ${w.text}`));
  lines.push("", "## エネルギー記録");
  S.energy.forEach((e) => lines.push(`- ${e.date}: レベル${e.level}`));
  lines.push("", "## If-Then作戦");
  S.plans.forEach((p) => lines.push(`- もし「${p.ifText}」→「${p.thenText}」`));
  lines.push("", "## こころノート");
  Object.keys(S.diary).sort().forEach((k) => {
    const d = S.diary[k];
    const MOODS = ["", "😢", "😟", "😐", "🙂", "😊"];
    lines.push(`### ${k} ${MOODS[d.mood] || ""}${d.sleep != null ? ` 睡眠${d.sleep}h` : ""}${d.med ? " 💊" : ""}`);
    if (d.text) lines.push(d.text);
    (d.good || []).forEach((g) => lines.push(`- よかった: ${g}`));
    lines.push("");
  });
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ippo-export.txt";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("#btn-reset").addEventListener("click", () => {
  if (confirm("本当にすべての記録を削除しますか?この操作は元に戻せません。")) {
    localStorage.removeItem(STORE_KEY);
    try { indexedDB.deleteDatabase("ippo-photos"); } catch (e) {}
    location.reload();
  }
});

/* ---------- init ---------- */
renderHome();
updateBadge();
$$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.nav === "home"));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
