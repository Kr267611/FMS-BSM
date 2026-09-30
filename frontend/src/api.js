// The session is an httpOnly cookie set by the server, so no token is stored in the browser.
// Clean up the token that older versions kept in localStorage.
try {
  localStorage.removeItem("fms_bsm_token");
} catch {
  /* private window */
}

const AUTH_PAGES = ["/login", "/forgot-password", "/reset-password"];

export async function api(path, { method = "GET", body, query } = {}) {
  let url = "/api" + path;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    if ([...qs].length) url += "?" + qs;
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw new Error("The server is not available right now. Please refresh in a moment.");
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
