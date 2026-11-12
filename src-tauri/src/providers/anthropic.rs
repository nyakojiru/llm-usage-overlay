//! Anthropic Console org spend via the Admin API cost report.
//! GET /v1/organizations/cost_report, daily buckets only; amounts are USD cents
//! as decimal strings. Data typically lands within ~5 minutes; polling once a
//! minute is the documented sustained rate.

use super::{check, Periods, Usage};
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::Value;

const URL: &str = "https://api.anthropic.com/v1/organizations/cost_report";

pub async fn fetch(client: &reqwest::Client, key: &str, u: &mut Usage) -> Result<(), String> {
    let p = Periods::now();
    p.zero(u);
    let mut page: Option<String> = None;
    loop {
        let mut q: Vec<(&str, String)> = vec![
            ("starting_at", p.earliest().to_rfc3339_opts(SecondsFormat::Secs, true)),
            ("ending_at", p.end.to_rfc3339_opts(SecondsFormat::Secs, true)),
            ("bucket_width", "1d".into()),
            ("limit", "31".into()),
        ];
        if let Some(pg) = &page {
            q.push(("page", pg.clone()));
        }
        let resp = client
            .get(URL)
            .query(&q)
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let v: Value = check(resp).await?.json().await.map_err(|e| e.to_string())?;

        for bucket in v["data"].as_array().into_iter().flatten() {
            let Some(start) = bucket["starting_at"]
                .as_str()
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|d| d.with_timezone(&Utc))
            else {
                continue;
            };
            let cents: f64 = bucket["results"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|r| match &r["amount"] {
                    Value::String(s) => s.parse::<f64>().ok(),
                    Value::Number(n) => n.as_f64(),
                    _ => None,
                })
                .sum();
            p.add(u, start, cents / 100.0);
        }

        if v["has_more"].as_bool() == Some(true) {
            page = v["next_page"].as_str().map(String::from);
            if page.is_none() {
                break;
            }
        } else {
            break;
        }
    }
    Ok(())
}
