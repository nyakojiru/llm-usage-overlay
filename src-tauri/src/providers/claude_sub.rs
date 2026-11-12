//! Claude Pro/Max plan limits: the same account-wide numbers `/usage` shows in
//! Claude Code and claude.ai/settings/usage, so usage from every device counts.
//!
//! Uses the OAuth access token Claude Code stores in ~/.claude/.credentials.json.
//! The endpoint (GET /api/oauth/usage) is UNDOCUMENTED and may change.
//! We only READ the token and never refresh it: refreshing would rotate the
//! refresh token and could log Claude Code out. When it expires, running any
//! Claude Code command on this machine refreshes it.

use super::{check, Usage, Window};
use serde_json::Value;
use std::path::PathBuf;

const URL: &str = "https://api.anthropic.com/api/oauth/usage";

fn default_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join(".credentials.json"))
}

fn read_token(path: Option<&str>) -> Result<String, String> {
    let p = path.map(PathBuf::from).or_else(default_path).ok_or("no home directory")?;
    let raw = std::fs::read_to_string(&p)
        .map_err(|_| format!("{} not found: log in to Claude Code first", p.display()))?;
    let v: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let o = &v["claudeAiOauth"];
    if let Some(exp) = o["expiresAt"].as_i64() {
        if exp < chrono::Utc::now().timestamp_millis() {
            return Err("token expired: run Claude Code on this machine to refresh it".into());
        }
    }
    o["accessToken"].as_str().map(String::from).ok_or_else(|| "no accessToken in credentials file".into())
}

fn pretty(name: &str) -> String {
    match name {
        "five_hour" => "5 h".into(),
        "seven_day" => "7 d".into(),
        "seven_day_opus" => "7 d Opus".into(),
        "seven_day_sonnet" => "7 d Sonnet".into(),
        other => other.replace('_', " "),
    }
}

pub async fn fetch(
    client: &reqwest::Client,
    pasted_token: Option<String>,
    path: Option<&str>,
    u: &mut Usage,
) -> Result<(), String> {
    let token = match pasted_token {
        Some(t) => t,
        None => read_token(path)?,
    };
    let resp = client
        .get(URL)
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let v: Value = check(resp).await?.json().await.map_err(|e| e.to_string())?;

    // Every object with a numeric `utilization` is a limit window; this way new
    // windows show up without a code change.
    let mut ws: Vec<Window> = v
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(k, w)| {
            let pct = w.get("utilization")?.as_f64()?;
            Some(Window {
                name: pretty(k),
                pct,
                resets_at: w.get("resets_at").and_then(|r| r.as_str()).map(String::from),
            })
        })
        .collect();
    ws.sort_by_key(|w| if w.name == "5 h" { 0 } else if w.name == "7 d" { 1 } else { 2 });
    if ws.is_empty() {
        return Err("no limit windows in response (unlimited plan or new format?)".into());
    }
    u.windows = ws;
    Ok(())
}
