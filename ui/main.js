const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const win = window.__TAURI__.window.getCurrentWindow();

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let cfg = { accounts: [], refresh_secs: 120 };
let timer = null;
let last = [];

// Plan accounts sign in to the provider's own site inside the app.
const WEB = { claude_web: "claude.ai", chatgpt_web: "chatgpt.com", opencode_web: "opencode.ai" };

const tag = (p) => t(`tag.${p}`);
const hint = (p) => t(`hint.${p}`) + (WEB[p] ? " " + t("hint.signin", { site: WEB[p] }) : "");
/** Display name of a limit window (internal names stay English for history keys). */
const wname = (n) => (n === "month" ? t("win.month") : n);

/** Apply the language preference everywhere, including the tray and sign-in windows. */
function setLanguage(pref) {
  LANG = detectLang(pref);
  applyStatic();
  invoke("set_language", {
    strings: {
      show: t("tray.show"),
      ghost: t("tray.ghost"),
      quit: t("tray.quit"),
      signin_title: t("signin.title"),
    },
  }).catch(console.error);
}

const usd = (n) => (n == null ? "—" : n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`);
const level = (ratio) => (ratio >= 1 ? "bad" : ratio >= 0.8 ? "warn" : "");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function untilText(iso) {
  if (!iso) return "";
  const ms = new Date(iso) - Date.now();
  if (!(ms > 0)) return t("resetting");
  return t("resets.in", { d: fmtDur(ms) });
}

function bar(ratio) {
  const pct = Math.max(0, Math.min(100, ratio * 100));
  return `<div class="bar"><i class="now" style="width:${pct}%"></i></div>`;
}

function monthProjection(month) {
  const now = new Date();
  const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = now.getUTCDate() - 1 + (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440;
  return elapsed > 0.25 ? (month / elapsed) * days : null;
}

// ---- Pace: a little local history of each limit window -------------------
// Samples stay in this app's own WebView2 storage and are never sent anywhere.
const HIST_KEY = "history-v1";
const KEEP_MS = 8 * 864e5;
const WINDOW_MS = { "5 h": 5 * 36e5, "7 d": 7 * 864e5, month: 30 * 864e5 };
let hist = store.get(HIST_KEY, {});

/** Length of a limit window from its name: "5 h", "7 d", "30 d", "7 d Opus", "month". */
function winMs(name) {
  if (WINDOW_MS[name]) return WINDOW_MS[name];
  const m = /^(\d+)\s*([dh])\b/.exec(name);
  if (m) return Number(m[1]) * (m[2] === "d" ? 864e5 : 36e5);
  return WINDOW_MS["5 h"];
}

function record(usages) {
  const now = Date.now();
  for (const u of usages) {
    for (const w of u.windows || []) {
      const key = `${u.id}|${w.name}`;
      let s = hist[key] || [];
      const lastS = s[s.length - 1];
      if (lastS && w.pct + 0.5 < lastS[1]) s = []; // the window reset
      if (!lastS || now - lastS[0] >= 55e3) s.push([now, w.pct]);
      hist[key] = s.filter(([t]) => now - t < KEEP_MS);
    }
  }
  store.set(HIST_KEY, hist);
}

function fmtDur(ms) {
  const h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return h >= 24 ? t("dur.dh", { d: Math.floor(h / 24), h: h % 24 }) : h ? t("dur.hm", { h, m }) : t("dur.m", { m });
}

/** Where this window is heading: null (not enough data), or {text, level, hits}. */
function pace(u, w) {
  const s = hist[`${u.id}|${w.name}`] || [];
  const now = Date.now();
  const lookback = winMs(w.name) / 5;
  const recent = s.filter(([t]) => now - t <= lookback);
  if (recent.length < 2) return null;
  const [t0, p0] = recent[0], [t1, p1] = recent[recent.length - 1];
  // Don't extrapolate a short burst over a long window: need a quarter of the
  // lookback (15 min for 5 h, ~8 h for 7 days, ~1.5 days for a month).
  if (t1 - t0 < Math.max(10 * 6e4, lookback / 4)) return null;
  const rate = (p1 - p0) / (t1 - t0); // % per ms
  const toReset = w.resets_at ? new Date(w.resets_at) - now : null;
  if (rate <= 0) return { text: t("idle"), level: "", hits: false, proj: w.pct };
  const eta = (100 - w.pct) / rate;
  if (toReset != null && eta > toReset) {
    const atReset = Math.min(100, w.pct + rate * toReset);
    return { text: t("pace.at_reset", { p: Math.round(atReset) }), level: atReset >= 80 ? "warn" : "", hits: false, proj: atReset };
  }
  return { text: t("pace.limit_in", { d: fmtDur(eta) }), level: eta < 36e5 ? "bad" : "warn", hits: true, proj: 100, eta };
}

// ---- Alerts: Windows notifications, once per threshold and period ---------
const ALERT_KEY = "alerts-v1";
let fired = store.get(ALERT_KEY, {});
const alertsOn = () => store.get("alerts", true);

function notify(title, body) {
  try { window.__TAURI__.notification.sendNotification({ title, body }); } catch (e) { console.error(e); }
}

function alertOnce(key, title, body) {
  if (fired[key]) return;
  fired[key] = Date.now();
  if (alertsOn()) notify(title, body);
}

function checkAlerts(usages) {
  for (const u of usages) {
    if (u.error) continue;
    for (const w of u.windows || []) {
      const period = w.resets_at || "";
      for (const th of [80, 95]) {
        if (w.pct >= th) alertOnce(`${u.id}|${w.name}|${th}|${period}`, t("alert.at", { label: u.label, win: wname(w.name), p: Math.round(w.pct) }), w.resets_at ? untilText(w.resets_at) : "");
      }
      const p = pace(u, w);
      if (p?.hits) alertOnce(`${u.id}|${w.name}|pace|${period}`, `${u.label}: ${wname(w.name)} · ${p.text}`, w.resets_at ? t("alert.pace.body", { reset: untilText(w.resets_at) }) : "");
    }
    if (u.budget_month && u.month != null) {
      const month = new Date().toISOString().slice(0, 7);
      for (const th of [80, 100]) {
        if (u.month >= (u.budget_month * th) / 100) alertOnce(`${u.id}|budget|${th}|${month}`, t("alert.budget", { label: u.label, p: th }), t("alert.budget.body", { v: usd(u.month), b: usd(u.budget_month) }));
      }
    }
  }
  // Forget alerts older than 40 days.
  const cutoff = Date.now() - 40 * 864e5;
  for (const k of Object.keys(fired)) if (fired[k] < cutoff) delete fired[k];
  store.set(ALERT_KEY, fired);
}

/** Colour means state only: "" fine, warn (heading to 80 %+), bad (will run out / 95 %+). */
function limitState(w, p) {
  if (w.pct >= 95 || (p?.hits && p.eta < 36e5)) return "bad";
  if (w.pct >= 80 || p?.hits || (p?.proj ?? 0) >= 80) return "warn";
  return "";
}

function renderAccount(u) {
  let body = "", pill = "", pillLevel = "";

  if (u.windows?.length) {
    // One line per limit: name · bar (now + projected at reset) · % · reset or warning.
    let worst = null;
    for (const w of u.windows) {
      const p = pace(u, w);
      const st = limitState(w, p);
      const proj = Math.max(w.pct, Math.min(100, p?.proj ?? w.pct));
      const right = p?.hits
        ? `⚠ ${fmtDur(p.eta)}`
        : w.resets_at ? `↻ ${new Date(w.resets_at) > Date.now() ? fmtDur(new Date(w.resets_at) - Date.now()) : "…"}` : "";
      const tip = [wname(w.name), w.resets_at ? untilText(w.resets_at) : "", p ? p.text : ""].filter(Boolean).join(" · ");
      body += `<div class="lim ${st}" title="${esc(tip)}">
        <span class="k">${esc(wname(w.name))}</span>
        <div class="bar"><i class="now" style="width:${w.pct}%"></i><i class="proj" style="left:${w.pct}%;width:${proj - w.pct}%"></i></div>
        <span class="v">${Math.round(w.pct)}%</span>
        <span class="r">${esc(right)}</span>
      </div>`;
      const rank = { "": 0, warn: 1, bad: 2 };
      if (!worst || rank[st] > rank[worst.st] || (rank[st] === rank[worst.st] && w.pct > worst.w.pct)) worst = { w, st, p };
    }
    // Compact pill: the most constrained window, coloured by its state.
    pill = `${wname(worst.w.name)} ${Math.round(worst.w.pct)}%${worst.p?.hits ? " ⚠" : ""}`;
    pillLevel = worst.st;
  } else if (u.day != null || u.week != null || u.month != null) {
    const b = u.budget_month;
    const dayB = b ? b / 30 : null, weekB = b ? b / 4.345 : null;
    const row = (k, v, budget) => {
      const r = budget ? (v ?? 0) / budget : 0;
      return `<div class="lim ${budget ? level(r) : ""}"><span class="k">${k}</span>${budget ? bar(r) : '<div class="bar off"></div>'}<span class="v">${usd(v)}</span><span class="r"></span></div>`;
    };
    body += row(t("today"), u.day, dayB) + row(t("week"), u.week, weekB) + row(t("month"), u.month, b);
    const proj = u.month != null ? monthProjection(u.month) : null;
    if (proj != null) body += `<div class="sub">${t("spend.pace", { v: usd(proj) })}${b ? t("spend.budget", { v: usd(b) }) : ""}</div>`;
    pill = `${usd(u.day)} · ${usd(u.month)}`;
    pillLevel = b && u.month != null ? level(u.month / b) : "";
  }
  if (u.error) {
    body += `<div class="err">${esc(tb(u.error))}</div>`;
    if (WEB[u.provider]) body += `<button class="link" data-signin="${esc(u.id)}">${esc(t("signin.link", { site: WEB[u.provider] }))}</button>`;
    pill = t("error");
    pillLevel = "bad";
  }

  return `<div class="acc">
    <div class="acc-head"><span class="acc-name">${esc(u.label)}</span><span class="acc-note">${esc(tb(u.note || ""))}</span><span class="pill ${pillLevel}">${esc(pill)}</span></div>
    ${body}
  </div>`;
}

function renderUsage() {
  const main = $("view-usage");
  if (!cfg.accounts.length) {
    main.innerHTML = `<div class="empty">${esc(t("empty"))} <a id="go-settings">${esc(t("empty.add"))}</a>.</div>`;
    $("go-settings").onclick = () => showSettings(true);
    return;
  }
  main.innerHTML = last.map(renderAccount).join("");
  main.querySelectorAll("[data-signin]").forEach((b) => {
    b.onclick = () => invoke("web_sign_in", { id: b.dataset.signin });
  });
  fitHeight();
}

// ---- Freshness and size ----------------------------------------------------
let lastFetch = 0;

function renderStatus() {
  if (!lastFetch) return;
  const mins = Math.floor((Date.now() - lastFetch) / 6e4);
  const el = $("status");
  el.textContent = mins < 1 ? t("ago.now") : t("ago.min", { m: mins });
  // Stale: two refresh intervals without fresh data.
  el.classList.toggle("stale", Date.now() - lastFetch > 2 * Math.max(60, cfg.refresh_secs) * 1000 + 30e3);
}

/** Height follows the content (no empty space, no scrollbar); width is the user's. */
function fitHeight() {
  const view = $("view-settings").hidden ? $("view-usage") : $("view-settings");
  const header = document.querySelector("header");
  // The view stretches to fill the window, so measure its last child instead.
  const lastEl = [...view.children].filter((c) => !c.hidden).pop();
  const content = lastEl ? lastEl.offsetTop - view.offsetTop + lastEl.offsetHeight + 14 : 40;
  const want = Math.ceil(header.offsetHeight + content + 2);
  const max = Math.floor(screen.availHeight * 0.85);
  const h = Math.max(60, Math.min(want, max));
  if (Math.abs(h - window.innerHeight) > 1) {
    win.setSize(new window.__TAURI__.dpi.LogicalSize(window.innerWidth, h)).catch(console.error);
  }
}

async function refresh() {
  if (!cfg.accounts.length) { renderUsage(); return; }
  $("status").textContent = t("updating");
  try {
    last = await invoke("fetch_all");
    record(last);
    checkAlerts(last);
    lastFetch = Date.now();
    renderStatus();
  } catch (e) {
    $("status").textContent = t("error");
    console.error(e);
  }
  renderUsage();
}

function schedule() {
  clearInterval(timer);
  timer = setInterval(refresh, Math.max(60, cfg.refresh_secs) * 1000);
}

function renderSettings() {
  $("account-list").innerHTML =
    cfg.accounts.map((a) => `<li><span>${esc(a.label)} <span class="acc-tag">${esc(tag(a.provider))}</span></span><button data-id="${esc(a.id)}">${esc(t("remove"))}</button></li>`).join("") ||
    `<li class="hint">${esc(t("accounts.none"))}</li>`;
  $("account-list").querySelectorAll("button").forEach((b) => {
    b.onclick = async () => {
      cfg = await invoke("remove_account", { id: b.dataset.id });
      renderSettings();
    };
  });
  $("refresh").value = cfg.refresh_secs;
  $("alerts").checked = alertsOn();
  window.__TAURI__.autostart.isEnabled().then((on) => ($("autostart").checked = on)).catch(console.error);
  syncForm();
  fitHeight();
}

function syncForm() {
  const p = $("provider").value;
  $("row-secret").hidden = !!WEB[p];
  $("row-budget").hidden = !!WEB[p];
  $("hint").textContent = hint(p);
}

function showSettings(on) {
  $("view-settings").hidden = !on;
  $("view-usage").hidden = on;
  $("view-settings").scrollTop = 0;
  if (on) renderSettings();
  else refresh();
}

$("provider").onchange = syncForm;
$("add-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = e.target.querySelector("button[type=submit]");
  if (btn.disabled) return;
  btn.disabled = true;
  $("form-error").textContent = "";
  const errText = (err) => tb(String(err));
  try {
    cfg = await invoke("add_account", {
      provider: f.get("provider"),
      label: f.get("label") || "",
      secret: f.get("secret") || null,
      budgetMonth: f.get("budget_month") ? Number(f.get("budget_month")) : null,
    });
    e.target.reset();
    syncForm();
    const added = cfg.accounts[cfg.accounts.length - 1];
    if (WEB[added?.provider]) await invoke("web_sign_in", { id: added.id });
    // Back to the usage view so the new account shows up right away.
    showSettings(false);
  } catch (err) {
    $("form-error").textContent = errText(err);
  } finally {
    btn.disabled = false;
  }
};
$("alerts").onchange = (e) => store.set("alerts", e.target.checked);
$("autostart").onchange = async (e) => {
  const a = window.__TAURI__.autostart;
  try { await (e.target.checked ? a.enable() : a.disable()); } catch (err) { console.error(err); }
  e.target.checked = await a.isEnabled().catch(() => false);
};
$("test-alert").onclick = () => notify("LLM Usage Overlay", t("alerts.test.body"));
$("language").onchange = (e) => {
  store.set("language", e.target.value);
  setLanguage(e.target.value);
  renderSettings();
  renderStatus();
};
$("refresh").onchange = async (e) => {
  cfg = await invoke("set_refresh", { secs: Number(e.target.value) || 120 });
  $("refresh").value = cfg.refresh_secs;
  schedule();
};

function setCompact(on) {
  document.body.classList.toggle("compact", on);
  store.set("compact", on);
  fitHeight();
}
$("btn-compact").onclick = () => setCompact(!document.body.classList.contains("compact"));
document.querySelector("header").ondblclick = (e) => { if (e.target.tagName !== "BUTTON") setCompact(!document.body.classList.contains("compact")); };
$("btn-refresh").onclick = refresh;
$("btn-settings").onclick = () => showSettings($("view-settings").hidden);
$("btn-hide").onclick = () => win.hide();
$("grip").onmousedown = (e) => { e.preventDefault(); win.startResizeDragging("East"); };

listen("ghost", (e) => document.body.classList.toggle("ghost", !!e.payload));
listen("web-signed-in", () => { showSettings(false); });

(async () => {
  const langPref = store.get("language", "auto");
  $("language").value = langPref;
  setLanguage(langPref);
  setCompact(store.get("compact", false));
  cfg = await invoke("get_config");
  if (!cfg.accounts.length) showSettings(true);
  else await refresh();
  schedule();
  // Keep the "resets in" countdowns fresh between fetches.
  setInterval(() => { renderStatus(); if ($("view-settings").hidden && last.length) renderUsage(); }, 60_000);
  window.addEventListener("resize", () => clearTimeout(window.__fit) || (window.__fit = setTimeout(fitHeight, 150)));
})();
