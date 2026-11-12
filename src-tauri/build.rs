fn main() {
    // Declaring the app commands puts them under the capability ACL, so each
    // window gets only what its capability file grants. In particular the
    // web-session windows (claude.ai, chatgpt.com, opencode.ai) may call report_web_usage and nothing else.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_config",
            "add_account",
            "remove_account",
            "set_refresh",
            "fetch_all",
            "web_sign_in",
            "report_web_usage",
        ]),
    ))
    .expect("failed to run tauri-build");
}
