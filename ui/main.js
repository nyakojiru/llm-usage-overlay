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
  openrouter: "OpenRouter",
  claude_subscription: "Claude plan",
};

const HINTS = {
  claude_subscription:
    "Account-wide plan limits (all your devices). Reads the token Claude Code keeps on this PC; leave Key empty. Uses an undocumented endpoint.",
  anthropic: "Needs an Admin key (sk-ant-admin…) from Console → Settings → Admin keys. Org accounts only.",
  openai: "Needs an Admin key from platform.openai.com → Organization → Admin keys.",
  openrouter: "Your normal OpenRouter API key works.",
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

function renderAccount(u) {
  const tag = PROVIDER_TAG[u.provider] ?? u.provider;
  let body = "", pill = "", pillLevel = "";

  if (u.windows?.length) {
    for (const w of u.windows) {
      body += `<div class="row"><span class="k">${esc(w.name)}</span>${bar(w.pct / 100)}<span class="v">${Math.round(w.pct)}%</span></div>`;
      if (w.resets_at && (w.name === "5 h" || w.name === "7 d")) body += `<div class="sub">${esc(w.name)} ${untilText(w.resets_at)}</div>`;
    }
    const top = u.windows[0];
    pill = `${top.name} ${Math.round(top.pct)}%`;
    pillLevel = level(Math.max(...u.windows.map((w) => w.pct)) / 100);
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
}

async function refresh() {
  if (!cfg.accounts.length) { renderUsage(); return; }
  $("status").textContent = "updating…";
  try {
    last = await invoke("fetch_all");
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
  syncForm();
}

function syncForm() {
  const p = $("provider").value;
  $("row-secret").hidden = false;
  $("row-secret").firstChild.textContent = p === "claude_subscription" ? "OAuth token (optional, normally empty) " : "Key ";
  $("row-path").hidden = p !== "claude_subscription";
  $("row-budget").hidden = p === "claude_subscription";
  $("hint").textContent = HINTS[p];
}

function showSettings(on) {
  $("view-settings").hidden = !on;
  $("view-usage").hidden = on;
  if (on) renderSettings();
  else refresh();
}

$("provider").onchange = syncForm;
$("add-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $("form-error").textContent = "";
  try {
    cfg = await invoke("add_account", {
      provider: f.get("provider"),
      label: f.get("label") || "",
      secret: f.get("secret") || null,
      budgetMonth: f.get("budget_month") ? Number(f.get("budget_month")) : null,
      credentialsPath: f.get("credentials_path") || null,
    });
    e.target.reset();
    renderSettings();
  } catch (err) {
    $("form-error").textContent = String(err);
  }
};
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

(async () => {
  setCompact(store.get("compact", false));
  cfg = await invoke("get_config");
  if (!cfg.accounts.length) showSettings(true);
  else await refresh();
  schedule();
  // Keep the "resets in" countdowns fresh between fetches.
  setInterval(() => { if ($("view-settings").hidden && last.length) renderUsage(); }, 60_000);
})();
