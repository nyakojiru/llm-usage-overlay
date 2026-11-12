# Security and privacy

This page says exactly what the app sends, to whom, and what it stores. If anything here is wrong or the code does more than this, that is a bug: please open an issue.

## What leaves your computer

Only requests to the providers you added. Nothing else: no telemetry, no update checks, no crash reports, no servers of ours.

| Account | Requests go to | What is sent |
|---|---|---|
| Claude plan | `claude.ai` | Made by the claude.ai page itself, inside the app, with your session. Reads `/api/organizations` and `/api/organizations/{id}/usage` |
| ChatGPT plan | `chatgpt.com` | Made by the chatgpt.com page itself. Reads `/api/auth/session` and `/backend-api/wham/usage` |
| OpenCode | `opencode.ai` | Made by the opencode.ai page itself. Reads `/console/api/orgs`, `/console/api/go/status`, `/console/api/billing/status` |
| Anthropic API | `api.anthropic.com` | Your Admin key, to the official `cost_report` endpoint |
| OpenAI API | `api.openai.com` | Your Admin key, to the official `organization/costs` endpoint |

The app's own requests identify themselves honestly as `llm-usage-overlay/<version>`.

## What is official and what is not

- **Official:** the Anthropic and OpenAI Admin APIs.
- **Unofficial:** the plan endpoints of claude.ai, chatgpt.com and opencode.ai are the internal ones their own websites use. They are undocumented and may change or break without notice.

How we use them, and what we don't do:

- The requests are made **by the provider's own web page**, loaded in a window of this app, exactly as when you open your usage page in a browser. The app does not copy your cookies, does not fake a browser User-Agent, and does not pretend to be an official client (Claude Code, Codex, ...).
- Tokens a site gives its own page (for example chatgpt.com's session token) stay in that page. The app only receives the usage numbers.

## What is stored, and where

| What | Where | Protection |
|---|---|---|
| Admin keys | Windows Credential Manager, service `llm-usage-overlay` | Windows user account (DPAPI) |
| Plan sign-ins | `%LOCALAPPDATA%\io.github.nyakojiru.llmusageoverlay\webviews\<account>` | A private WebView2 profile per account, separate from your browser |
| Account list, settings | `%APPDATA%\io.github.nyakojiru.llmusageoverlay\config.json` | Plain JSON with no secrets |

Removing an account deletes its key or its whole browser profile, which signs that session out of this app.

## Isolation

- Each plan account runs in its own window and WebView2 profile.
- Pages from claude.ai, chatgpt.com and opencode.ai can call exactly one command of the app, `report_web_usage`, and only from their own account's window while on their own site (`src-tauri/capabilities/web-sessions.json`, checked again in `web_session.rs`). They cannot read your keys, your other accounts or your settings.
- The overlay's own page has a strict Content Security Policy and loads nothing from the internet.

## Things outside our control

- **The providers' own sites** load their usual analytics inside their sign-in window, as in any browser. Rejecting their cookie banner limits it.
- **WebView2** is Microsoft Edge's engine and follows your Windows diagnostic-data settings (Settings → Privacy & security → Diagnostics & feedback).

## Reporting a problem

Open an issue. For something sensitive, use GitHub's private vulnerability reporting on this repository.
