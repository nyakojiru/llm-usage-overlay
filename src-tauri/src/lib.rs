mod web_session;
mod config;
mod providers;

use config::{Account, Config, Provider};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Ghost mode: the overlay ignores the mouse (click-through) and dims.
static GHOST: AtomicBool = AtomicBool::new(false);
/// Debounce counter for saving the window geometry.
static SAVE_GEN: AtomicU64 = AtomicU64::new(0);

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
) -> Result<Config, String> {
    let mut cfg = config::load(&app);
    let id = format!("acc-{}", chrono::Utc::now().timestamp_millis());
    if let Some(s) = secret.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        config::set_secret(&id, s)?;
    } else if matches!(provider, Provider::Anthropic | Provider::Openai) {
        return Err("this provider needs an admin key".into());
    }
    cfg.accounts.push(Account {
        id,
        provider,
        label: if label.trim().is_empty() {
            match provider {
                Provider::Anthropic => "Anthropic API",
                Provider::Openai => "OpenAI API",
                Provider::ClaudeWeb => "Claude plan",
                Provider::ChatgptWeb => "ChatGPT plan",
                Provider::OpencodeWeb => "OpenCode",
            }
            .into()
        } else {
            label.trim().into()
        },
        budget_month: budget_month.filter(|b| *b > 0.0),
    });
    config::save(&app, &cfg)?;
    Ok(cfg)
}

#[tauri::command]
async fn remove_account(app: AppHandle, id: String) -> Result<Config, String> {
    let mut cfg = config::load(&app);
    cfg.accounts.retain(|a| a.id != id);
    config::delete_secret(&id);
    web_session::forget(&app, &id);
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
        let client = &client;
        let app = &app;
        async move {
            if web_session::site(a.provider).is_some() {
                web_session::fetch(app, a).await
            } else {
                providers::fetch(client, a, config::get_secret(&a.id)).await
            }
        }
    });
    futures::future::join_all(jobs).await
}

/// Open the account's site window to sign in. Must be async: creating a window
/// from a synchronous command deadlocks the WebView2 event loop on Windows.
#[tauri::command]
async fn web_sign_in(app: AppHandle, id: String) -> Result<(), String> {
    let cfg = config::load(&app);
    let acc = cfg.accounts.iter().find(|a| a.id == id).ok_or("unknown account")?;
    web_session::sign_in(&app, acc)
}

/// Called from inside a web-session page (the only command those origins may call).
#[tauri::command]
fn report_web_usage(
    app: AppHandle,
    webview: tauri::Webview,
    id: String,
    ok: bool,
    data: Option<serde_json::Value>,
    error: Option<String>,
) -> Result<(), String> {
    let reply = if ok {
        Ok(data.unwrap_or(serde_json::Value::Null))
    } else {
        Err(error.unwrap_or_else(|| "unknown error".into()))
    };
    web_session::report(&app, &webview, &id, reply)
}

pub fn run() {
    let ghost_key = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyU);
    let show_key = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyH);

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        // Remember only the overlay's own geometry; the claude.ai windows must
        // never be restored (a restored "visible" flag would show the hidden probe).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filter(|label| label == "main")
                .build(),
        )
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
            fetch_all,
            web_sign_in,
            report_web_usage
        ])
        .manage(web_session::Pending::default())
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

            // Persist the overlay's place as soon as the user stops moving or
            // resizing it, so a crash or shutdown doesn't lose it.
            if let Some(main) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                main.on_window_event(move |ev| {
                    if matches!(ev, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
                        let gen = SAVE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
                        let handle = handle.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(600));
                            if SAVE_GEN.load(Ordering::SeqCst) == gen {
                                let _ = handle.save_window_state(StateFlags::all());
                            }
                        });
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
