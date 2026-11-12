//! OpenAI org spend via GET /v1/organization/costs (Admin key, daily buckets,
//! unix-second timestamps, amount.value in USD).

use super::{check, Periods, Usage};
use chrono::{TimeZone, Utc};
use serde_json::Value;

const URL: &str = "https://api.openai.com/v1/organization/costs";

pub async fn fetch(client: &reqwest::Client, key: &str, u: &mut Usage) -> Result<(), String> {
    let p = Periods::now();
    p.zero(u);
    let mut page: Option<String> = None;
    loop {
        let mut q: Vec<(&str, String)> = vec![
            ("start_time", p.earliest().timestamp().to_string()),
            ("end_time", p.end.timestamp().to_string()),
            ("bucket_width", "1d".into()),
            ("limit", "31".into()),
        ];
        if let Some(pg) = &page {
            q.push(("page", pg.clone()));
        }
        let resp = client
            .get(URL)
            .query(&q)
            .bearer_auth(key)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let v: Value = check(resp).await?.json().await.map_err(|e| e.to_string())?;

        for bucket in v["data"].as_array().into_iter().flatten() {
            let Some(start) = bucket["start_time"]
                .as_i64()
                .and_then(|t| Utc.timestamp_opt(t, 0).single())
            else {
                continue;
            };
            let usd: f64 = bucket["results"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|r| match &r["amount"]["value"] {
                    Value::Number(n) => n.as_f64(),
                    Value::String(s) => s.parse::<f64>().ok(),
                    _ => None,
                })
                .sum();
            p.add(u, start, usd);
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
    u.note = Some("OpenAI cost data can lag by hours".into());
    Ok(())
}
