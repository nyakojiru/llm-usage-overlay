//! One module per provider. Each returns a `Usage` for one account.
//! Periods are UTC calendar periods (day, ISO week from Monday, month), because
//! that is how the providers bucket their own data.

mod anthropic;
mod claude_sub;
mod openai;
mod openrouter;

use crate::config::{Account, Provider};
use chrono::{DateTime, Datelike, Duration, TimeZone, Utc};
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct Window {
    pub name: String,
    /// 0-100.
    pub pct: f64,
    pub resets_at: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Usage {
    pub id: String,
    pub label: String,
    pub provider: String,
    /// USD spend per UTC period. None when the provider does not expose it.
    pub day: Option<f64>,
    pub week: Option<f64>,
    pub month: Option<f64>,
    pub budget_month: Option<f64>,
    /// Plan limit windows (subscriptions): 5h, 7d, per-model...
    pub windows: Vec<Window>,
    pub note: Option<String>,
    pub error: Option<String>,
    pub fetched_at: String,
}

pub struct Periods {
    pub day: DateTime<Utc>,
    pub week: DateTime<Utc>,
    pub month: DateTime<Utc>,
    pub end: DateTime<Utc>,
}

impl Periods {
    pub fn now() -> Self {
        let now = Utc::now();
        let day = Utc.with_ymd_and_hms(now.year(), now.month(), now.day(), 0, 0, 0).unwrap();
        let week = day - Duration::days(now.weekday().num_days_from_monday() as i64);
        let month = Utc.with_ymd_and_hms(now.year(), now.month(), 1, 0, 0, 0).unwrap();
        Self { day, week, month, end: day + Duration::days(1) }
    }

    /// Earliest instant we need data from.
    pub fn earliest(&self) -> DateTime<Utc> {
        self.week.min(self.month)
    }

    /// Add one daily bucket's amount to whichever periods contain it.
    pub fn add(&self, u: &mut Usage, bucket_start: DateTime<Utc>, amount: f64) {
        if bucket_start >= self.day {
            *u.day.get_or_insert(0.0) += amount;
        }
        if bucket_start >= self.week {
            *u.week.get_or_insert(0.0) += amount;
        }
        if bucket_start >= self.month {
            *u.month.get_or_insert(0.0) += amount;
        }
    }

    pub fn zero(&self, u: &mut Usage) {
        u.day = Some(0.0);
        u.week = Some(0.0);
        u.month = Some(0.0);
    }
}

pub fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("llm-usage-overlay/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .expect("http client")
}

pub async fn fetch(client: &reqwest::Client, acc: &Account, secret: Option<String>) -> Usage {
    let mut u = Usage {
        id: acc.id.clone(),
        label: acc.label.clone(),
        provider: serde_json::to_value(acc.provider)
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_default(),
        budget_month: acc.budget_month,
        fetched_at: Utc::now().to_rfc3339(),
        ..Default::default()
    };
    let res = match acc.provider {
        Provider::Anthropic => match secret {
            Some(k) => anthropic::fetch(client, &k, &mut u).await,
            None => Err("missing admin key".into()),
        },
        Provider::Openai => match secret {
            Some(k) => openai::fetch(client, &k, &mut u).await,
            None => Err("missing admin key".into()),
        },
        Provider::Openrouter => match secret {
            Some(k) => openrouter::fetch(client, &k, &mut u).await,
            None => Err("missing API key".into()),
        },
        Provider::ClaudeSubscription => {
            claude_sub::fetch(client, secret, acc.credentials_path.as_deref(), &mut u).await
        }
    };
    if let Err(e) = res {
        u.error = Some(e);
    }
    u
}

/// Turn a non-2xx response into a short error string (status + start of body).
pub async fn check(resp: reqwest::Response) -> Result<reqwest::Response, String> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let body = resp.text().await.unwrap_or_default();
    let snippet: String = body.chars().take(160).collect();
    Err(format!("HTTP {}: {}", status.as_u16(), snippet))
}
