//! Account list (plain JSON in the app config dir) and secrets (Windows Credential Manager).
//! Secrets never leave the Rust side: the UI can set or delete them, never read them.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const KEYRING_SERVICE: &str = "llm-usage-overlay";

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    /// Anthropic Console org, Admin API key (sk-ant-admin...).
    Anthropic,
    /// OpenAI org, Admin key.
    Openai,
    /// OpenRouter, regular API key.
    Openrouter,
    /// Claude Pro/Max subscription limits, via the Claude Code OAuth login.
    ClaudeSubscription,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Account {
    pub id: String,
    pub provider: Provider,
    pub label: String,
    /// Monthly budget in USD, for the bar and the projection.
    #[serde(default)]
    pub budget_month: Option<f64>,
    /// ClaudeSubscription only: path to Claude Code's .credentials.json
    /// (defaults to %USERPROFILE%\.claude\.credentials.json).
    #[serde(default)]
    pub credentials_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Config {
    #[serde(default)]
    pub accounts: Vec<Account>,
    #[serde(default = "default_refresh")]
    pub refresh_secs: u64,
}

fn default_refresh() -> u64 {
    120
}

impl Default for Config {
    fn default() -> Self {
        Self { accounts: vec![], refresh_secs: default_refresh() }
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

pub fn load(app: &AppHandle) -> Config {
    config_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(config_path(app)?, json).map_err(|e| e.to_string())
}

fn entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, id).map_err(|e| e.to_string())
}

pub fn set_secret(id: &str, secret: &str) -> Result<(), String> {
    entry(id)?.set_password(secret).map_err(|e| e.to_string())
}

pub fn get_secret(id: &str) -> Option<String> {
    entry(id).ok()?.get_password().ok()
}

pub fn delete_secret(id: &str) {
    if let Ok(e) = entry(id) {
        let _ = e.delete_credential();
    }
}
