// The session is an httpOnly cookie set by the server, so no token is stored in the browser.
// Clean up the token that older versions kept in localStorage.
try {
  localStorage.removeItem("fms_bsm_token");
} catch {
  /* private window */
}

const AUTH_PAGES = ["/login", "/forgot-password", "/reset-password"];

const DOWN = [502, 503, 504];
let waking = null;
// Polls /api/health for up to ~90 s; tells the page (WakeBanner) while it waits
function waitForServer() {
  if (!waking) {
    window.dispatchEvent(new CustomEvent("fms:waking", { detail: true }));
    waking = (async () => {
      for (let i = 0; i < 30; i++) {
        const r = await fetch("/api/health", { cache: "no-store" }).catch(() => null);
        if (r && r.ok) return true;
        await new Promise((ok) => setTimeout(ok, 3000));
      }
      return false;
    })().finally(() => {
      waking = null;
      window.dispatchEvent(new CustomEvent("fms:waking", { detail: false }));
    });
  }
  return waking;
}

export async function api(path, { method = "GET", body, query } = {}) {
  let url = "/api" + path;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    if ([...qs].length) url += "?" + qs;
  }

  const send = () =>
    fetch(url, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
  let res = await send();
  if (!res || DOWN.includes(res.status)) {
    // The free server sleeps after 15 idle minutes and needs up to a minute to wake up.
    // Wait for it, then repeat reads and sign-in. Other changes are not repeated, because the first try
    // may have reached the server and repeating it could save the same thing twice.
    if (!(await waitForServer())) throw new Error("The server is not available right now. Please refresh in a moment.");
    if (method !== "GET" && path !== "/auth/login") throw new Error("The server was starting up. Please try again now.");
    res = await send();
    if (!res) throw new Error("Could not reach the server. Check your connection and try again.");
    if (DOWN.includes(res.status)) throw new Error("The server is not available right now. Please refresh in a moment.");
  }
  const data = await res.json().catch(() => ({}));
  // Session ended (expired, password changed, deactivated): back to sign-in, except on the sign-in pages themselves
  if (res.status === 401 && path !== "/auth/me" && !AUTH_PAGES.includes(window.location.pathname)) {
    window.location.href = "/login";
  }
  if (!res.ok) throw new Error(data.message || "Something went wrong. Please try again.");
  return data;
}

// Permission check for showing menu items and buttons (the server enforces the same rules)
export function can(user, module, action = "view") {
  return Boolean(user?.permissions?.[module]?.includes(action));
}

export const ROLE_LABELS = { admin: "Admin", hod: "HOD", pc: "PC", tl: "Team Leader", auditor: "Auditor", doer: "Doer" };

// ---- date helpers (IST) ----
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
export const todayKey = () => dayFmt.format(new Date());
// Date -> "YYYY-MM-DD" in IST
export const istDay = (d) => (d ? dayFmt.format(new Date(d)) : "");

export function addDays(key, n) {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "2026-09-28" -> "28/09/2026"
export function showDay(key) {
  if (!key) return "";
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

const dtFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});
export function showDateTime(value) {
  if (!value) return "";
  return dtFmt.format(new Date(value));
}
