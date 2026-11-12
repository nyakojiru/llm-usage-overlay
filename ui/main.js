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

const PROVIDER_TAG = {
  anthropic: "Anthropic API",
  openai: "OpenAI API",
  claude_subscription: "Claude plan · CLI",
  claude_web: "Claude plan",
  chatgpt_web: "ChatGPT plan",
  opencode_web: "OpenCode",
};

// Plan accounts sign in to the provider's own site inside the app.
const WEB = { claude_web: "claude.ai", chatgpt_web: "chatgpt.com", opencode_web: "opencode.ai" };

const signInHint = (site) =>
  `A ${site} window opens: sign in there and it closes by itself. Your session stays in this app's own private profile. Nothing else needs to be installed.`;

const HINTS = {
  claude_web: "Account-wide limits (5 h, weekly), counting all your devices. " + signInHint("claude.ai"),
  chatgpt_web: "Your plan's Codex limits (5 h, weekly). " + signInHint("chatgpt.com"),
  opencode_web: "Go / Go Plus limits (5 h, weekly, monthly) and your Zen balance. " + signInHint("opencode.ai"),
  anthropic: "Organization spend in USD. Needs an Admin key (sk-ant-admin…) from Console → Settings → Admin keys.",
  openai: "Organization spend in USD. Needs an Admin key from platform.openai.com → Organization → Admin keys.",
};

const usd = (n) => (n == null ? "—" : n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`);
const level = (ratio) => (ratio >= 1 ? "bad" : ratio >= 0.8 ? "warn" : "");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function untilText(iso) {
  if (!iso) return "";
  const ms = new Date(iso) - Date.now();
  if (!(ms > 0)) return "resetting";
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
  return h >= 24 ? `resets in ${Math.floor(h / 24)}d ${h % 24}h` : `resets in ${h}h ${m}m`;
}

function bar(ratio) {
  const pct = Math.max(0, Math.min(100, ratio * 100));
  return `<div class="bar ${level(ratio)}"><i style="width:${pct}%"></i></div>`;
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
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${m}m` : `${m}m`;
}

/** Where this window is heading: null (not enough data), or {text, level, hits}. */
function pace(u, w) {
  const s = hist[`${u.id}|${w.name}`] || [];
  const now = Date.now();
  const lookback = (WINDOW_MS[w.name] || WINDOW_MS["5 h"]) / 5;
  const recent = s.filter(([t]) => now - t <= lookback);
  if (recent.length < 2) return null;
  const [t0, p0] = recent[0], [t1, p1] = recent[recent.length - 1];
  if (t1 - t0 < 10 * 6e4) return null;
  const rate = (p1 - p0) / (t1 - t0); // % per ms
  const toReset = w.resets_at ? new Date(w.resets_at) - now : null;
  if (rate <= 0) return { text: "idle", level: "", hits: false };
  const eta = (100 - w.pct) / rate;
  if (toReset != null && eta > toReset) {
    const atReset = Math.min(100, w.pct + rate * toReset);
    return { text: `on pace for ${Math.round(atReset)}% at reset`, level: "", hits: false };
  }
  return { text: `limit in ${fmtDur(eta)} at this pace`, level: eta < 36e5 ? "bad" : "warn", hits: true };
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
        if (w.pct >= th) alertOnce(`${u.id}|${w.name}|${th}|${period}`, `${u.label}: ${w.name} at ${Math.round(w.pct)}%`, w.resets_at ? untilText(w.resets_at) : "");
      }
      const p = pace(u, w);
      if (p?.hits) alertOnce(`${u.id}|${w.name}|pace|${period}`, `${u.label}: ${w.name} ${p.text}`, w.resets_at ? `before it ${untilText(w.resets_at)}` : "");
    }
    if (u.budget_month && u.month != null) {
      const month = new Date().toISOString().slice(0, 7);
      for (const th of [80, 100]) {
        if (u.month >= (u.budget_month * th) / 100) alertOnce(`${u.id}|budget|${th}|${month}`, `${u.label}: ${th}% of the monthly budget`, `${usd(u.month)} of ${usd(u.budget_month)}`);
      }
    }
  }
  // Forget alerts older than 40 days.
  const cutoff = Date.now() - 40 * 864e5;
  for (const k of Object.keys(fired)) if (fired[k] < cutoff) delete fired[k];
  store.set(ALERT_KEY, fired);
}

function renderAccount(u) {
  const tag = PROVIDER_TAG[u.provider] ?? u.provider;
  let body = "", pill = "", pillLevel = "";

  if (u.windows?.length) {
    for (const w of u.windows) {
      body += `<div class="row"><span class="k">${esc(w.name)}</span>${bar(w.pct / 100)}<span class="v">${Math.round(w.pct)}%</span></div>`;
      const p = pace(u, w);
      const parts = [w.resets_at ? untilText(w.resets_at) : "", p ? `<span class="${p.level}">${esc(p.text)}</span>` : ""].filter(Boolean);
      if (parts.length) body += `<div class="sub">${esc(w.name)} · ${parts.join(" · ")}</div>`;
    }
    // Compact pill: the most constrained window, coloured by pace or level.
    const top = u.windows.reduce((a, b) => (b.pct > a.pct ? b : a));
    const tp = pace(u, top);
    pill = `${top.name} ${Math.round(top.pct)}%${tp?.hits ? " ⚠" : ""}`;
    pillLevel = tp?.hits ? tp.level : level(top.pct / 100);
  } else if (u.day != null || u.week != null || u.month != null) {
    const b = u.budget_month;
    const dayB = b ? b / 30 : null, weekB = b ? b / 4.345 : null;
    const row = (k, v, budget) =>
      `<div class="row"><span class="k">${k}</span>${budget ? bar((v ?? 0) / budget) : "<span></span>"}<span class="v">${usd(v)}</span></div>`;
    body += row("Today", u.day, dayB) + row("Week", u.week, weekB) + row("Month", u.month, b);
    const proj = u.month != null ? monthProjection(u.month) : null;
    if (proj != null) body += `<div class="sub">On pace for ${usd(proj)} this month${b ? ` (budget ${usd(b)})` : ""}</div>`;
    pill = `${usd(u.day)} · ${usd(u.month)}`;
    pillLevel = b && u.month != null ? level(u.month / b) : "";
  }
  if (u.note) body += `<div class="sub">${esc(u.note)}</div>`;
  if (u.error) {
    body += `<div class="err">${esc(u.error)}</div>`;
    if (WEB[u.provider]) body += `<button class="link" data-signin="${esc(u.id)}">Sign in to ${WEB[u.provider]}</button>`;
    pill = "error";
    pillLevel = "bad";
  }

  return `<div class="acc">
    <div class="acc-head"><span class="acc-name">${esc(u.label)}</span><span class="acc-tag">${esc(tag)}</span><span class="pill ${pillLevel}">${esc(pill)}</span></div>
    ${body}
  </div>`;
}

function renderUsage() {
  const main = $("view-usage");
  if (!cfg.accounts.length) {
    main.innerHTML = `<div class="empty">No accounts yet. <a id="go-settings">Add one</a>.</div>`;
    $("go-settings").onclick = () => showSettings(true);
    return;
  }
  main.innerHTML = last.map(renderAccount).join("");
  main.querySelectorAll("[data-signin]").forEach((b) => {
    b.onclick = () => invoke("web_sign_in", { id: b.dataset.signin });
  });
}

async function refresh() {
  if (!cfg.accounts.length) { renderUsage(); return; }
  $("status").textContent = "updating…";
  try {
    last = await invoke("fetch_all");
    record(last);
    checkAlerts(last);
    const t = new Date();
    $("status").textContent = `${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")} · UTC periods`;
  } catch (e) {
    $("status").textContent = "error";
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
    cfg.accounts.map((a) => `<li><span>${esc(a.label)} <span class="acc-tag">${esc(PROVIDER_TAG[a.provider])}</span></span><button data-id="${esc(a.id)}">Remove</button></li>`).join("") ||
    `<li class="hint">None yet.</li>`;
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
}

function syncForm() {
  const p = $("provider").value;
  $("row-secret").hidden = false;
  $("row-secret").firstChild.textContent = "Admin key ";
  $("row-secret").hidden = !!WEB[p];
  $("row-budget").hidden = !!WEB[p];
  $("hint").textContent = HINTS[p];
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
    $("form-error").textContent = String(err);
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
$("test-alert").onclick = () => notify("LLM Usage Overlay", "Notifications work. You'll hear from it only when a limit or budget needs attention.");
$("refresh").onchange = async (e) => {
  cfg = await invoke("set_refresh", { secs: Number(e.target.value) || 120 });
  $("refresh").value = cfg.refresh_secs;
  schedule();
};

function setCompact(on) {
  document.body.classList.toggle("compact", on);
  store.set("compact", on);
}
$("btn-compact").onclick = () => setCompact(!document.body.classList.contains("compact"));
document.querySelector("header").ondblclick = (e) => { if (e.target.tagName !== "BUTTON") setCompact(!document.body.classList.contains("compact")); };
$("btn-refresh").onclick = refresh;
$("btn-settings").onclick = () => showSettings($("view-settings").hidden);
$("btn-hide").onclick = () => win.hide();
$("grip").onmousedown = (e) => { e.preventDefault(); win.startResizeDragging("SouthEast"); };

listen("ghost", (e) => document.body.classList.toggle("ghost", !!e.payload));
listen("web-signed-in", () => { showSettings(false); });

(async () => {
  setCompact(store.get("compact", false));
  cfg = await invoke("get_config");
  if (!cfg.accounts.length) showSettings(true);
  else await refresh();
  schedule();
  // Keep the "resets in" countdowns fresh between fetches.
  setInterval(() => { if ($("view-settings").hidden && last.length) renderUsage(); }, 60_000);
})();
