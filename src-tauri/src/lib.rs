mod config;
mod providers;

use config::{Account, Config, Provider};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Ghost mode: the overlay ignores the mouse (click-through) and dims.
static GHOST: AtomicBool = AtomicBool::new(false);

fn toggle_ghost(app: &AppHandle) {
    let on = !GHOST.fetch_xor(true, Ordering::SeqCst);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_ignore_cursor_events(on);
        let _ = w.emit("ghost", on);
    }
}

fn toggle_visible(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
        }
    }
}

#[tauri::command]
fn get_config(app: AppHandle) -> Config {
    config::load(&app)
}

#[tauri::command]
fn add_account(
    app: AppHandle,
    provider: Provider,
    label: String,
    secret: Option<String>,
    budget_month: Option<f64>,
    credentials_path: Option<String>,
) -> Result<Config, String> {
    let mut cfg = config::load(&app);
    let id = format!("acc-{}", chrono::Utc::now().timestamp_millis());
    if let Some(s) = secret.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        config::set_secret(&id, s)?;
    } else if provider != Provider::ClaudeSubscription {
        return Err("this provider needs a key".into());
    }
    cfg.accounts.push(Account {
        id,
        provider,
        label: if label.trim().is_empty() {
            match provider {
                Provider::Anthropic => "Anthropic API",
                Provider::Openai => "OpenAI API",
                Provider::Openrouter => "OpenRouter",
                Provider::ClaudeSubscription => "Claude plan",
            }
            .into()
        } else {
            label.trim().into()
        },
        budget_month: budget_month.filter(|b| *b > 0.0),
        credentials_path: credentials_path.filter(|p| !p.trim().is_empty()),
    });
    config::save(&app, &cfg)?;
    Ok(cfg)
}

#[tauri::command]
fn remove_account(app: AppHandle, id: String) -> Result<Config, String> {
    let mut cfg = config::load(&app);
    cfg.accounts.retain(|a| a.id != id);
    config::delete_secret(&id);
    config::save(&app, &cfg)?;
    Ok(cfg)
}

#[tauri::command]
fn set_refresh(app: AppHandle, secs: u64) -> Result<Config, String> {
    let mut cfg = config::load(&app);
    // Anthropic documents one poll per minute as the sustained rate.
    cfg.refresh_secs = secs.max(60);
    config::save(&app, &cfg)?;
    Ok(cfg)
}

#[tauri::command]
async fn fetch_all(app: AppHandle) -> Vec<providers::Usage> {
    let cfg = config::load(&app);
    let client = providers::http();
    let jobs = cfg.accounts.iter().map(|a| {
        let secret = config::get_secret(&a.id);
        let client = &client;
        async move { providers::fetch(client, a, secret).await }
    });
    futures::future::join_all(jobs).await
}

pub fn run() {
    let ghost_key = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyU);
    let show_key = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyH);

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, sc, ev| {
                    if ev.state() != ShortcutState::Pressed {
                        return;
                    }
                    if sc == &ghost_key {
                        toggle_ghost(app);
                    } else if sc == &show_key {
                        toggle_visible(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_config,
            add_account,
            remove_account,
            set_refresh,
            fetch_all
        ])
        .setup(move |app| {
            app.global_shortcut().register(ghost_key)?;
            app.global_shortcut().register(show_key)?;

            let show = MenuItem::with_id(app, "show", "Show / hide  (Ctrl+Alt+H)", true, None::<&str>)?;
            let ghost = MenuItem::with_id(app, "ghost", "Click-through  (Ctrl+Alt+U)", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &ghost, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("icon").clone())
                .tooltip("LLM Usage Overlay")
                .menu(&menu)
                .on_menu_event(|app, ev| match ev.id().as_ref() {
                    "show" => toggle_visible(app),
                    "ghost" => toggle_ghost(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
