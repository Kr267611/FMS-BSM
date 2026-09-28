const TOKEN_KEY = "fms_bsm_token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private window */
  }
}

export async function api(path, { method = "GET", body, query } = {}) {
  let url = "/api" + path;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    if ([...qs].length) url += "?" + qs;
  }
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = "Bearer " + token;

  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw new Error("The server is not available right now. Please refresh in a moment.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    setToken(null);
    window.location.href = "/login";
  }
  if (!res.ok) throw new Error(data.message || "Something went wrong. Please try again.");
  return data;
}

// ---- date helpers (IST) ----
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
export const todayKey = () => dayFmt.format(new Date());

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
