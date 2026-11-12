//! Plan limits through a web session the user signs in to *inside the app*
//! (claude.ai, chatgpt.com, opencode.ai), so nothing else needs to be installed.
//!
//! Each account gets its own WebView2 profile folder. Usage is read from inside
//! a page of the site with the page's own `fetch`: the requests are the real
//! browser's, with no copied cookies, no spoofed User-Agent and no
//! impersonation of an official client. Tokens the site hands its own page
//! (e.g. chatgpt.com's session token) never leave that page. The page reports
//! back through one IPC command (`report_web_usage`), the only thing these
//! origins may call (capabilities/web-sessions.json); it checks the calling
//! window and its host.
//!
//! All endpoints used here are internal and undocumented; they may change.

use crate::config::{self, Account, Provider};
use crate::providers::{base_usage, Usage, Window};
use chrono::{DateTime, TimeZone, Utc};
use serde_json::Value;
use std::{collections::HashMap, path::PathBuf, sync::Mutex, time::Duration};
use tauri::{
    webview::PageLoadEvent, AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tokio::sync::oneshot;

const ATTEMPTS: u32 = 20;
const ATTEMPT_WAIT: Duration = Duration::from_millis(1500);

type Reply = Result<Value, String>;

/// Waiting fetches, keyed by account id.
#[derive(Default)]
pub struct Pending(pub Mutex<HashMap<String, oneshot::Sender<Reply>>>);

pub struct Site {
    pub host: &'static str,
    pub name: &'static str,
    login: &'static str,
    /// A small same-origin JSON document to run the probe from (no SPA).
    probe: &'static str,
    body: &'static str,
}

const CLAUDE: Site = Site {
    host: "claude.ai",
    name: "claude.ai",
    login: "https://claude.ai/login",
    probe: "https://claude.ai/api/organizations",
    body: r#"
    const o = await get('/api/organizations');
    if (o.json === null) return; // Cloudflare check or redirect in progress
    if (o.status === 401 || o.status === 403) return send({ ok: false, error: 'not signed in to claude.ai' });
    if (!o.ok) return send({ ok: false, error: 'claude.ai organizations: HTTP ' + o.status });
    const org = o.json.find((x) => (x.capabilities || []).includes('chat')) || o.json[0];
    if (!org) return send({ ok: false, error: 'no organization on this claude.ai account' });
    const u = await get('/api/organizations/' + org.uuid + '/usage');
    if (!u.ok || u.json === null) return send({ ok: false, error: 'claude.ai usage: HTTP ' + u.status });
    send({ ok: true, data: u.json });"#,
};

const CHATGPT: Site = Site {
    host: "chatgpt.com",
    name: "chatgpt.com",
    login: "https://chatgpt.com/auth/login",
    probe: "https://chatgpt.com/api/auth/session",
    body: r#"
    const s = await get('/api/auth/session');
    if (s.json === null) return;
    if (!s.json.accessToken) return send({ ok: false, error: 'not signed in to chatgpt.com' });
    const h = { authorization: 'Bearer ' + s.json.accessToken };
    const acct = s.json.account && s.json.account.id;
    if (acct) h['chatgpt-account-id'] = acct;
    const u = await get('/backend-api/wham/usage', h);
    if (!u.ok || u.json === null) return send({ ok: false, error: 'chatgpt.com usage: HTTP ' + u.status });
    send({ ok: true, data: u.json });"#,
};

const OPENCODE: Site = Site {
    host: "opencode.ai",
    name: "opencode.ai",
    login: "https://opencode.ai/console",
    probe: "https://opencode.ai/console/api/orgs",
    body: r#"
    const o = await get('/console/api/orgs');
    if (o.status === 401 || o.status === 403 || o.json === null) return send({ ok: false, error: 'not signed in to opencode.ai' });
    if (!o.ok) return send({ ok: false, error: 'opencode.ai workspaces: HTTP ' + o.status });
    const m = JSON.stringify(o.json).match(/(?:org|wrk)_[A-Za-z0-9_-]+/);
    if (!m) return send({ ok: false, error: 'no opencode.ai workspace found' });
    const h = { 'x-org-id': m[0] };
    const go = await get('/console/api/go/status', h);
    const bill = await get('/console/api/billing/status', h);
    send({ ok: true, data: { go: go.ok ? go.json : null, billing: bill.ok ? bill.json : null } });"#,
};

pub fn site(p: Provider) -> Option<&'static Site> {
    match p {
        Provider::ClaudeWeb => Some(&CLAUDE),
        Provider::ChatgptWeb => Some(&CHATGPT),
        Provider::OpencodeWeb => Some(&OPENCODE),
        _ => None,
    }
}

pub fn label(id: &str) -> String {
    format!("ws-{id}")
}

fn on_host(url: &Url, host: &str) -> bool {
    url.scheme() == "https" && url.host_str() == Some(host)
}

fn profile_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("webviews").join(id))
}

fn parse(s: &str) -> Url {
    s.parse().expect("static url")
}

fn probe_script(id: &str, s: &Site) -> String {
    let id = serde_json::to_string(id).unwrap_or_default();
    let host = serde_json::to_string(s.host).unwrap_or_default();
    format!(
        r#"(async () => {{
  if (location.hostname !== {host} || document.readyState === 'loading') return;
  const send = (p) => window.__TAURI_INTERNALS__.invoke('report_web_usage', Object.assign({{ id: {id} }}, p));
  const get = async (path, headers) => {{
    const r = await fetch(path, {{ credentials: 'include', headers: Object.assign({{ accept: 'application/json' }}, headers || {{}}) }});
    const ct = r.headers.get('content-type') || '';
    return {{ status: r.status, ok: r.ok, json: ct.includes('json') ? await r.json().catch(() => null) : null }};
  }};
  try {{{body}
  }} catch (e) {{
    send({{ ok: false, error: String(e) }});
  }}
}})();"#,
        body = s.body
    )
}

fn window(app: &AppHandle, acc: &Account, s: &'static Site, visible: bool) -> Result<WebviewWindow, String> {
    if let Some(w) = app.get_webview_window(&label(&acc.id)) {
        return Ok(w);
    }
    let start = if visible { s.login } else { s.probe };
    let id = acc.id.clone();
    WebviewWindowBuilder::new(app, label(&acc.id), WebviewUrl::External(parse(start)))
        .title({
            let tpl = crate::SIGNIN_TITLE.lock().unwrap().clone();
            if tpl.is_empty() {
                format!("Sign in to {} - LLM Usage Overlay", s.name)
            } else {
                tpl.replace("{site}", s.name)
            }
        })
        .inner_size(480.0, 760.0)
        .visible(visible)
        .focused(visible)
        .skip_taskbar(!visible)
        .data_directory(profile_dir(app, &acc.id)?)
        .on_page_load(move |w, payload| {
            // While the user signs in, probe after every page load: the first
            // successful probe proves the sign-in, and report() then hides the
            // window and refreshes the overlay.
            if payload.event() == PageLoadEvent::Finished
                && w.is_visible().unwrap_or(false)
                && on_host(payload.url(), s.host)
            {
                let _ = w.eval(&probe_script(&id, s));
            }
        })
        .build()
        .map_err(|e| e.to_string())
        .inspect(|w| {
            if !visible {
                let _ = w.hide();
            }
        })
}

/// Show the account's window on the site's login page.
pub fn sign_in(app: &AppHandle, acc: &Account) -> Result<(), String> {
    let s = site(acc.provider).ok_or("not a web-session account")?;
    let w = window(app, acc, s, true)?;
    if !w.is_visible().unwrap_or(false) {
        w.navigate(parse(s.login)).map_err(|e| e.to_string())?;
    }
    let _ = w.set_skip_taskbar(false);
    let _ = w.show();
    let _ = w.set_focus();
    Ok(())
}

/// Close the window and delete the account's browser profile (its session).
pub fn forget(app: &AppHandle, id: &str) {
    if let Some(w) = app.get_webview_window(&label(id)) {
        let _ = w.destroy();
    }
    if let Ok(dir) = profile_dir(app, id) {
        // WebView2 releases its files a moment after the window goes away.
        std::thread::spawn(move || {
            for _ in 0..20 {
                if !dir.exists() || std::fs::remove_dir_all(&dir).is_ok() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        });
    }
}

pub async fn fetch(app: &AppHandle, acc: &Account) -> Usage {
    let mut u = base_usage(acc);
    let res = match site(acc.provider) {
        Some(s) => probe(app, acc, s).await,
        None => Err("not a web-session account".into()),
    };
    let parsed = res.and_then(|v| match acc.provider {
        Provider::ClaudeWeb => claude_windows(&v),
        Provider::ChatgptWeb => chatgpt_windows(&v),
        _ => opencode_windows(&v),
    });
    match parsed {
        Ok((ws, note)) => {
            u.windows = ws;
            u.note = note;
        }
        Err(e) => u.error = Some(e),
    }
    u
}

async fn probe(app: &AppHandle, acc: &Account, s: &'static Site) -> Result<Value, String> {
    let w = window(app, acc, s, false)?;
    let pending = app.state::<Pending>();
    let script = probe_script(&acc.id, s);
    for _ in 0..ATTEMPTS {
        let (tx, rx) = oneshot::channel();
        pending.0.lock().unwrap().insert(acc.id.clone(), tx);
        w.eval(&script).map_err(|e| e.to_string())?;
        if let Ok(Ok(reply)) = tokio::time::timeout(ATTEMPT_WAIT, rx).await {
            return reply;
        }
    }
    pending.0.lock().unwrap().remove(&acc.id);
    Err(format!("{} did not answer (offline, or still loading)", s.name))
}

/// Called from the site's page. Only accepted from the account's own window
/// while it is on that account's site.
pub fn report(app: &AppHandle, webview: &tauri::Webview, id: &str, reply: Reply) -> Result<(), String> {
    if webview.label() != label(id) {
        return Err("rejected: wrong window".into());
    }
    let cfg = config::load(app);
    let acc = cfg.accounts.iter().find(|a| a.id == id).ok_or("rejected: unknown account")?;
    let s = site(acc.provider).ok_or("rejected: not a web-session account")?;
    if !on_host(&webview.url().map_err(|e| e.to_string())?, s.host) {
        return Err("rejected: wrong site".into());
    }
    let ok = reply.is_ok();
    if let Some(tx) = app.state::<Pending>().0.lock().unwrap().remove(id) {
        let _ = tx.send(reply);
    }
    // A successful probe in the visible sign-in window means the user is in.
    if ok {
        if let Some(w) = app.get_webview_window(&label(id)) {
            if w.is_visible().unwrap_or(false) {
                let _ = w.hide();
                let _ = w.set_skip_taskbar(true);
                let _ = app.emit_to("main", "web-signed-in", id.to_string());
            }
        }
    }
    Ok(())
}

/// claude.ai `/usage`: every object with a numeric `utilization` is a limit
/// window, so new windows show up without a code change.
fn claude_windows(v: &Value) -> Result<(Vec<Window>, Option<String>), String> {
    let pretty = |k: &str| match k {
        "five_hour" => "5 h".to_string(),
        "seven_day" => "7 d".to_string(),
        "seven_day_opus" => "7 d Opus".to_string(),
        "seven_day_sonnet" => "7 d Sonnet".to_string(),
        other => other.replace('_', " "),
    };
    let mut ws: Vec<Window> = v
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(k, w)| {
            let pct = w.get("utilization")?.as_f64()?;
            let resets_at = w.get("resets_at").and_then(|r| r.as_str()).map(String::from);
            Some(Window { name: pretty(k), pct, resets_at })
        })
        .collect();
    ws.sort_by_key(|w| if w.name == "5 h" { 0 } else if w.name == "7 d" { 1 } else { 2 });
    if ws.is_empty() {
        return Err("no limit windows in the claude.ai response (free plan or new format?)".into());
    }
    Ok((ws, None))
}

fn window_name(seconds: i64) -> String {
    match seconds {
        18_000 => "5 h".into(),
        604_800 => "7 d".into(),
        s if s % 86_400 == 0 => format!("{} d", s / 86_400),
        s => format!("{} h", (s as f64 / 3600.0).round()),
    }
}

/// chatgpt.com `wham/usage`: the plan's Codex limits (5 h and weekly).
fn chatgpt_windows(v: &Value) -> Result<(Vec<Window>, Option<String>), String> {
    let rl = &v["rate_limit"];
    let ws: Vec<Window> = ["primary_window", "secondary_window"]
        .iter()
        .filter_map(|k| {
            let w = &rl[*k];
            let pct = w["used_percent"].as_f64()?;
            let secs = w["limit_window_seconds"].as_i64().unwrap_or(0);
            let resets_at = w["reset_at"]
                .as_i64()
                .and_then(|t| Utc.timestamp_opt(t, 0).single())
                .map(|d| d.to_rfc3339());
            Some(Window { name: window_name(secs), pct, resets_at })
        })
        .collect();
    if ws.is_empty() {
        return Err("no Codex limits in the ChatGPT response (free plan or new format?)".into());
    }
    let plan = v["plan_type"].as_str().map(|p| format!("ChatGPT {p} · Codex limits"));
    Ok((ws, plan))
}

/// opencode.ai console: Go/Go Plus meters (micro-cents used/limit) and the Zen
/// prepaid balance.
fn opencode_windows(v: &Value) -> Result<(Vec<Window>, Option<String>), String> {
    const SCALE: f64 = 100_000_000.0;
    let num = |x: &Value| x.as_f64().or_else(|| x.as_str().and_then(|s| s.parse().ok()));
    let meters = &v["go"]["access"]["meters"];
    let ws: Vec<Window> = [("fiveHour", "5 h"), ("week", "7 d"), ("month", "month")]
        .iter()
        .filter_map(|(k, name)| {
            let m = &meters[*k];
            let used = num(&m["usedMicroCents"])?;
            let limit = num(&m["limitMicroCents"]).filter(|l| *l > 0.0)?;
            let resets_at = m["resetsAt"]
                .as_str()
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|d| d.with_timezone(&Utc).to_rfc3339());
            Some(Window { name: (*name).into(), pct: (used / limit * 100.0).clamp(0.0, 100.0), resets_at })
        })
        .collect();
    let balance = num(&v["billing"]["balanceMicroCents"]).map(|b| b / SCALE);
    let mut notes = vec![];
    if !ws.is_empty() {
        notes.push("OpenCode Go".to_string());
    }
    if let Some(b) = balance.filter(|b| b.abs() >= 0.005) {
        notes.push(format!("Zen balance ${b:.2}"));
    }
    if ws.is_empty() && balance.is_none() {
        return Err("no Go subscription or Zen balance on this workspace".into());
    }
    Ok((ws, Some(notes.join(" · "))))
}
