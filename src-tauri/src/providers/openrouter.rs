//! OpenRouter: GET /api/v1/key with the regular key. Returns lifetime usage and,
//! on current API versions, usage_daily / usage_weekly / usage_monthly (UTC).

use super::{check, Usage};
use serde_json::Value;

const URL: &str = "https://openrouter.ai/api/v1/key";

pub async fn fetch(client: &reqwest::Client, key: &str, u: &mut Usage) -> Result<(), String> {
    let resp = client
        .get(URL)
        .bearer_auth(key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let v: Value = check(resp).await?.json().await.map_err(|e| e.to_string())?;
    let d = &v["data"];
    u.day = d["usage_daily"].as_f64();
    u.week = d["usage_weekly"].as_f64();
    u.month = d["usage_monthly"].as_f64();
    if u.day.is_none() && u.month.is_none() {
        // Older response shape: only the lifetime total is available.
        if let Some(total) = d["usage"].as_f64() {
            u.note = Some(format!("lifetime total: ${total:.2}"));
        }
    }
    if u.budget_month.is_none() {
        if let (Some(limit), Some(rem)) = (d["limit"].as_f64(), d["limit_remaining"].as_f64()) {
            u.note = Some(format!("key limit: ${rem:.2} of ${limit:.2} left"));
        }
    }
    Ok(())
}
