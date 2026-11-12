# llm-usage-overlay

**A tiny always-on-top Windows overlay that shows what your LLM accounts are spending — today, this week, this month — and how close your Claude plan is to its limits.**

Built with [Tauri 2](https://tauri.app) (Rust + WebView2): ~40 MB RAM, no Electron.

## What it shows

| Source | What you get | Key you need | Freshness |
|---|---|---|---|
| **Claude Pro/Max plan** | 5-hour and 7-day limit usage (%), per-model weekly windows, reset countdowns — **account-wide, every device counted** | none: reads the Claude Code login on this PC | live |
| **Anthropic API** (Console org) | USD spend today / week / month | Admin key `sk-ant-admin…` | ~5 min |
| **OpenAI API** (org) | USD spend today / week / month | Admin key | can lag hours |
| **OpenRouter** | USD spend today / week / month | normal API key | live |

Periods are **UTC** calendar periods (day, week from Monday, month), because that is how the providers bucket their data. With a monthly budget set you get bars (day ≈ budget/30, week ≈ budget/4.3) and a month-end projection.

Normal API keys **cannot** read usage at Anthropic or OpenAI; only admin keys can. They are powerful: create a dedicated one, and note that this app stores it in the **Windows Credential Manager**, never in a file. The UI can set or delete a key but never read it back.

### About the Claude plan source

It calls `GET https://api.anthropic.com/api/oauth/usage`, the endpoint behind `/usage` in Claude Code. **It is undocumented and may change or break.** The app only *reads* the OAuth token Claude Code keeps in `%USERPROFILE%\.claude\.credentials.json` and never refreshes it (refreshing rotates the token and could log Claude Code out). If it says the token expired, run any Claude Code command on that PC.

## Use

- Drag the header to move; drag the bottom-right corner to resize. Position and size are remembered.
- **▭** or double-click the header: compact mode (one line per account).
- **Ctrl+Alt+U**: click-through ("ghost") mode — the overlay dims and ignores the mouse, so it can sit over a game or your editor.
- **Ctrl+Alt+H**: show/hide. The tray icon has the same actions plus Quit.
- Refresh interval: 120 s by default, 60 s minimum (Anthropic's documented sustained polling rate).

Overlays don't appear over **exclusive fullscreen** games; use borderless windowed.

## Build

Requirements: Node 18+, Rust (stable, MSVC toolchain), Visual Studio Build Tools with the C++ workload, WebView2 (built into Windows 11).

```powershell
npm install
npm run dev      # run
npm run build    # installer in src-tauri/target/release/bundle/nsis/
```

## Layout

```
ui/                      plain HTML/CSS/JS, no bundler
src-tauri/src/lib.rs     window, tray, global shortcuts, commands
src-tauri/src/config.rs  accounts (JSON in %APPDATA%) + secrets (Credential Manager)
src-tauri/src/providers/ one file per provider
```

Adding a provider = one file in `providers/` that fills `Usage` (`day`/`week`/`month` in USD, or `windows` in %), plus one `Provider` variant.

## Roadmap

- Near-real-time spend from token usage × a local price table (the Anthropic usage report has 1-minute buckets), reconciled with the official cost
- Local SQLite history, sparklines, per-model breakdown
- Threshold notifications (80 % / 100 % of budget, spikes)
- Gemini (via Cloud Billing export), DeepSeek balance, xAI

## License

MIT
