# llm-usage-overlay

**Know how much AI you're using — without handing your data to anyone else.**

A small always-on-top Windows overlay that shows your plan limits and API spend for **Anthropic (Claude)**, **OpenAI (ChatGPT)** and **OpenCode** at a glance. Local-first, no telemetry, no account of ours, open source.

Built with [Tauri 2](https://tauri.app) (Rust + WebView2), about 40 MB of RAM.

## Principles

- **Privacy-first.** No servers of ours, no analytics, no crash reports, nothing phones home. The app only talks to the providers you add.
- **No impersonation.** We never pretend to be Claude Code, Codex, Chrome or anyone else, and never read your browser's cookies.
- **Your secrets stay yours.** Admin keys live in Windows Credential Manager. Plan sign-ins live in a private browser profile per account, deleted when you remove the account.
- **KISS.** One way to do each thing. Few providers, done properly.
- **Honest about what's unofficial.** See [SECURITY.md](SECURITY.md).

## What it shows

| Account | You see | You add |
|---|---|---|
| **Claude plan** (Pro/Max) | 5-hour and weekly limits (%), reset countdowns. Account-wide: every device counts | Sign in to claude.ai in the window that opens |
| **ChatGPT plan** (Plus/Pro) | Your plan's Codex limits: 5-hour and weekly (%) | Sign in to chatgpt.com in the window that opens |
| **OpenCode** | Go / Go Plus limits (5 h, weekly, monthly) and your Zen balance | Sign in to opencode.ai in the window that opens |
| **Anthropic API** | Organization spend today / this week / this month (USD) | An Admin key (`sk-ant-admin…`) |
| **OpenAI API** | Organization spend today / this week / this month (USD) | An Admin key |

Plan accounts need nothing else installed: no CLI, no browser extension. API spend uses the providers' official Admin APIs. Periods are UTC, as the providers count them.

## Install

Download the installer from [Releases](https://github.com/nyakojiru/llm-usage-overlay/releases). It installs for your user only, no admin rights needed.

Every installer is built by GitHub Actions from the tagged source, never on anyone's PC. Check it before running it:

```powershell
gh attestation verify llm-usage-overlay_<version>_x64-setup.exe -R nyakojiru/llm-usage-overlay
```

or compare its SHA-256 with `SHA256SUMS.txt` in the release. The installer is not Authenticode-signed (that needs a paid certificate), so Windows SmartScreen will warn the first time: **More info → Run anyway**.

## Language

English and Spanish (Latin America). By default it follows your Windows display language; you can pick one in settings.

## Use

- One line per limit: the bar is where you are; its faint extension is where you'll be at reset at your current pace. Colour only means trouble: amber when heading to 80 %+, red when you'll run out before the reset (the right column then shows how soon, ⚠).
- Drag the header to move it and its right edge to change the width; the height follows the content. It remembers where you left it.
- **▭** or double-click the header: compact mode, one line per account.
- **Ctrl+Alt+U**: click-through. The overlay dims and lets the mouse pass, so it can sit over your editor or a game.
- **Ctrl+Alt+H**: show / hide. The tray icon has the same, plus Quit.
- It doesn't appear over exclusive-fullscreen games; use borderless windowed.

## Build

Requirements: Node 18+, Rust (stable, MSVC), Visual Studio Build Tools with the C++ workload, WebView2 (built into Windows 11).

```powershell
npm install
npm run dev      # run
npm run build    # installer in src-tauri/target/release/bundle/nsis/
```

## Layout

```
ui/                          plain HTML/CSS/JS, no bundler
src-tauri/src/lib.rs         window, tray, shortcuts, commands
src-tauri/src/config.rs      accounts (JSON in %APPDATA%) + keys (Credential Manager)
src-tauri/src/web_session.rs plan sign-ins (claude.ai, chatgpt.com, opencode.ai)
src-tauri/src/providers/     Admin API spend (Anthropic, OpenAI)
src-tauri/capabilities/      what each window may call
```

## License

MIT
