// UI strings. "auto" follows the Windows display language (WebView2 reports it
// as navigator.language); Spanish is Latin American, with tú.
const STRINGS = {
  en: {
    title: "LLM usage",
    "btn.compact": "Compact / full (double-click the header)",
    "btn.refresh": "Refresh now",
    "btn.settings": "Accounts and settings",
    "btn.hide": "Hide (Ctrl+Alt+H)",
    grip: "Resize",
    accounts: "Accounts",
    "accounts.none": "None yet.",
    remove: "Remove",
    "add.title": "Add account",
    "add.provider": "Provider",
    "add.label": "Name",
    "add.label.ph": "e.g. Personal Max",
    "add.key": "Admin key",
    "add.budget": "Monthly budget, USD (optional)",
    "add.submit": "Add",
    "p.claude_web": "Claude plan (Pro/Max)",
    "p.chatgpt_web": "ChatGPT plan (Plus/Pro)",
    "p.opencode_web": "OpenCode (Go / Zen)",
    "p.anthropic": "Anthropic API spend",
    "p.openai": "OpenAI API spend",
    "tag.claude_web": "Claude plan",
    "tag.chatgpt_web": "ChatGPT plan",
    "tag.opencode_web": "OpenCode",
    "tag.anthropic": "Anthropic API",
    "tag.openai": "OpenAI API",
    "hint.signin": "A {site} window opens: sign in there and it closes by itself. Your session stays in this app's own private profile. Nothing else needs to be installed.",
    "hint.claude_web": "Account-wide limits (5 h, weekly), counting all your devices.",
    "hint.chatgpt_web": "Your plan's Codex limits (5 h, weekly).",
    "hint.opencode_web": "Go / Go Plus limits (5 h, weekly, monthly) and your Zen balance.",
    "hint.anthropic": "Organization spend in USD. Needs an Admin key (sk-ant-admin…) from Console → Settings → Admin keys.",
    "hint.openai": "Organization spend in USD. Needs an Admin key from platform.openai.com → Organization → Admin keys.",
    alerts: "Notify me at 80 % / 95 % of a limit, when I'm on pace to hit one, and at 80 % / 100 % of a budget",
    "alerts.test": "Send a test notification",
    "alerts.test.body": "Notifications work. You'll hear from it only when a limit or budget needs attention.",
    autostart: "Start with Windows",
    language: "Language",
    "language.auto": "Automatic (Windows)",
    refresh: "Refresh every",
    shortcuts: "Ctrl+Alt+U: click-through on/off · Ctrl+Alt+H: show/hide",
    empty: "No accounts yet.",
    "empty.add": "Add one",
    updating: "updating…",
    "status.periods": "UTC periods",
    error: "error",
    "signin.link": "Sign in to {site}",
    resetting: "resetting",
    "resets.in": "resets in {d}",
    idle: "idle",
    "pace.at_reset": "on pace for {p}% at reset",
    "pace.limit_in": "limit in {d} at this pace",
    today: "Today",
    week: "Week",
    month: "Month",
    "spend.pace": "On pace for {v} this month",
    "spend.budget": " (budget {v})",
    "win.month": "month",
    "alert.at": "{label}: {win} at {p}%",
    "alert.pace.body": "before it {reset}",
    "alert.budget": "{label}: {p}% of the monthly budget",
    "alert.budget.body": "{v} of {b}",
    "dur.dh": "{d}d {h}h",
    "dur.hm": "{h}h {m}m",
    "dur.m": "{m}m",
    "tray.show": "Show / hide  (Ctrl+Alt+H)",
    "tray.ghost": "Click-through  (Ctrl+Alt+U)",
    "tray.quit": "Quit",
    "signin.title": "Sign in to {site} - LLM Usage Overlay",
  },
  es: {
    title: "Uso de IA",
    "btn.compact": "Compacto / completo (doble clic en la barra)",
    "btn.refresh": "Actualizar ahora",
    "btn.settings": "Cuentas y ajustes",
    "btn.hide": "Ocultar (Ctrl+Alt+H)",
    grip: "Cambiar tamaño",
    accounts: "Cuentas",
    "accounts.none": "Todavía no hay ninguna.",
    remove: "Quitar",
    "add.title": "Agregar cuenta",
    "add.provider": "Proveedor",
    "add.label": "Nombre",
    "add.label.ph": "p. ej. Max personal",
    "add.key": "Clave de administrador",
    "add.budget": "Presupuesto mensual en USD (opcional)",
    "add.submit": "Agregar",
    "p.claude_web": "Plan de Claude (Pro/Max)",
    "p.chatgpt_web": "Plan de ChatGPT (Plus/Pro)",
    "p.opencode_web": "OpenCode (Go / Zen)",
    "p.anthropic": "Gasto en la API de Anthropic",
    "p.openai": "Gasto en la API de OpenAI",
    "tag.claude_web": "Plan Claude",
    "tag.chatgpt_web": "Plan ChatGPT",
    "tag.opencode_web": "OpenCode",
    "tag.anthropic": "API Anthropic",
    "tag.openai": "API OpenAI",
    "hint.signin": "Se abre una ventana de {site}: inicia sesión ahí y se cierra sola. Tu sesión queda en un perfil privado de esta app. No necesitas instalar nada más.",
    "hint.claude_web": "Límites de toda tu cuenta (5 h y semanal), sumando todos tus dispositivos.",
    "hint.chatgpt_web": "Los límites de Codex de tu plan (5 h y semanal).",
    "hint.opencode_web": "Límites de Go / Go Plus (5 h, semanal y mensual) y tu saldo de Zen.",
    "hint.anthropic": "Gasto de la organización en USD. Necesitas una Admin key (sk-ant-admin…) de Console → Settings → Admin keys.",
    "hint.openai": "Gasto de la organización en USD. Necesitas una Admin key de platform.openai.com → Organization → Admin keys.",
    alerts: "Avísame al 80 % / 95 % de un límite, cuando vaya camino de agotarlo, y al 80 % / 100 % de un presupuesto",
    "alerts.test": "Enviar una notificación de prueba",
    "alerts.test.body": "Las notificaciones funcionan. Solo te avisará cuando un límite o un presupuesto necesite tu atención.",
    autostart: "Iniciar con Windows",
    language: "Idioma",
    "language.auto": "Automático (Windows)",
    refresh: "Actualizar cada",
    shortcuts: "Ctrl+Alt+U: activar o desactivar el clic a través · Ctrl+Alt+H: mostrar u ocultar",
    empty: "Todavía no tienes cuentas.",
    "empty.add": "Agrega una",
    updating: "actualizando…",
    "status.periods": "periodos UTC",
    error: "error",
    "signin.link": "Iniciar sesión en {site}",
    resetting: "reiniciándose",
    "resets.in": "se reinicia en {d}",
    idle: "sin actividad",
    "pace.at_reset": "a este ritmo, {p} % al reiniciarse",
    "pace.limit_in": "a este ritmo, llegas al límite en {d}",
    today: "Hoy",
    week: "Semana",
    month: "Mes",
    "spend.pace": "A este ritmo, {v} este mes",
    "spend.budget": " (presupuesto {v})",
    "win.month": "mes",
    "alert.at": "{label}: {win} al {p} %",
    "alert.pace.body": "antes de que {reset}",
    "alert.budget": "{label}: {p} % del presupuesto mensual",
    "alert.budget.body": "{v} de {b}",
    "dur.dh": "{d} d {h} h",
    "dur.hm": "{h} h {m} min",
    "dur.m": "{m} min",
    "tray.show": "Mostrar / ocultar  (Ctrl+Alt+H)",
    "tray.ghost": "Clic a través  (Ctrl+Alt+U)",
    "tray.quit": "Salir",
    "signin.title": "Inicia sesión en {site} - LLM Usage Overlay",
  },
};

// Messages that come from the Rust side or the site probes, in English.
const BACKEND_ES = [
  [/^not signed in to (.+)$/, "no has iniciado sesión en $1"],
  [/^(.+) did not answer \(offline, or still loading\)$/, "$1 no respondió (sin conexión o aún cargando)"],
  [/^missing admin key$/, "falta la clave de administrador"],
  [/^this provider needs an admin key$/, "este proveedor necesita una clave de administrador"],
  [/^no organization on this claude\.ai account$/, "esta cuenta de claude.ai no tiene organización"],
  [/^no limit windows in the claude\.ai response.*$/, "claude.ai no devolvió límites (¿plan gratuito o formato nuevo?)"],
  [/^no Codex limits in the ChatGPT response.*$/, "ChatGPT no devolvió límites de Codex (¿plan gratuito o formato nuevo?)"],
  [/^no opencode\.ai workspace found$/, "no se encontró ningún espacio de trabajo en opencode.ai"],
  [/^no Go subscription or Zen balance on this workspace$/, "este espacio de trabajo no tiene Go ni saldo de Zen"],
  [/^ChatGPT (\w+) · Codex limits$/, "ChatGPT $1 · límites de Codex"],
  [/^Codex limits$/, "límites de Codex"],
  [/^Zen balance /, "Saldo de Zen "],
  [/^OpenAI cost data can lag by hours$/, "el costo de OpenAI puede llegar con horas de retraso"],
];

let LANG = "en";

function detectLang(pref) {
  if (pref === "en" || pref === "es") return pref;
  const sys = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
  return sys.toLowerCase().startsWith("es") ? "es" : "en";
}

function t(key, vars) {
  let s = (STRINGS[LANG] && STRINGS[LANG][key]) ?? STRINGS.en[key] ?? key;
  for (const [k, v] of Object.entries(vars || {})) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Translate a message produced by the backend (errors, notes). */
function tb(msg) {
  if (LANG !== "es" || !msg) return msg;
  return msg
    .split(" · ")
    .map((part) => {
      for (const [re, rep] of BACKEND_ES) if (re.test(part)) return part.replace(re, rep);
      return part;
    })
    .join(" · ");
}

/** Fill every element marked with data-i18n / data-i18n-title / data-i18n-ph. */
function applyStatic() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-title]").forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
}
