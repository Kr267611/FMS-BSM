// The session is an httpOnly cookie set by the server, so no token is stored in the browser.
// Clean up the token that older versions kept in localStorage.
try {
  localStorage.removeItem("fms_bsm_token");
} catch {
  /* private window */
}

const AUTH_PAGES = ["/login", "/forgot-password", "/reset-password"];

const DOWN = [502, 503, 504];
let waking: Promise<boolean> | null = null;
// Polls /api/health for up to ~90 s; tells the page (WakeBanner) while it waits
function waitForServer(): Promise<boolean> {
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
  return waking!;
}

type Query = Record<string, string | number | boolean | null | undefined>;
export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
}

// Every backend call. T is the shape of the answer; it is `any` until a page says more.
export async function api<T = any>(path: string, { method = "GET", body, query }: ApiOptions = {}): Promise<T> {
  let url = "/api" + path;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]));
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
  return data as T;
}

// Permission check for showing menu items and buttons (the server enforces the same rules)
export type Role = "admin" | "developer" | "hod" | "pc" | "tl" | "hr" | "auditor" | "doer";
export type Action = "view" | "add" | "edit" | "delete" | "done";
export interface SessionUser {
  _id: string;
  name: string;
  username?: string;
  email?: string;
  role: Role;
  permissions?: Record<string, Action[] | string[]>;
  [key: string]: any;
}

// The page ticks a server from before "one tick per page" sends under one name (Vercel can be live before Render):
// read those until the server sends the page's own tick
const OLD_TICK: Record<string, string> = {
  doerTasks: "reports", fmsTasks: "reports", misScore: "reports", weeklyMis: "reports", misMeeting: "reports", performance: "reports", auditorReport: "reports", effortReport: "reports",
  doerConditions: "fms", overrideTat: "fms", autoCalc: "fms", autoComplete: "fms", fmsImport: "fms", fmsBulk: "fmsEntries",
  auditorSettings: "settings", ticketReport: "tickets",
  attendanceRequests: "attendance", biometric: "attendance", attendanceSetup: "hrSetup", leaveTypes: "hrSetup", leavePolicies: "hrSetup", policyAssignment: "hrSetup",
  doerLeave: "users", calendar: "settings", sheetLinks: "settings", reminders: "settings",
};

export function can(user: SessionUser | null | undefined, module: string, action: Action = "view"): boolean {
  const p = user?.permissions;
  if (!p) return false;
  const oldServer = p.reports !== undefined || p.hrSetup !== undefined; // a new server never sends these
  if (oldServer && p[module] === undefined && (module === "auditList" || module === "accessOverview")) {
    return user.role === "admin" || (module === "auditList" && user.role === "auditor");
  }
  if (p[module] === undefined && OLD_TICK[module] && p[OLD_TICK[module]] !== undefined) {
    if (user.role === "doer" && ["doerTasks", "fmsTasks", "misMeeting", "auditorReport", "fmsBulk"].includes(module)) return false; // hidden from doers then
    const old = p[OLD_TICK[module]] as string[];
    if (module === "fmsImport") return old.includes("add") && Boolean((p.settings as string[] | undefined)?.includes("edit"));
    if (module === "sheetLinks" || module === "auditorSettings") return old.includes("edit");
    if (module === "biometric") return old.includes("add");
    return old.includes(action);
  }
  // a server before the Done ticks had one "Done for others" row for all three pages
  if (action === "done" && ["checklist", "delegation", "fmsEntries"].includes(module) && (p.doneForOthers as string[] | undefined)?.includes("edit")) return true;
  return Boolean((p[module] as string[] | undefined)?.includes(action));
}

// Admin and Developer: every permission, the whole company and the admin-only screens
export const isAdmin = (user: { role?: string } | null | undefined): boolean => user?.role === "admin" || user?.role === "developer";

export const ROLE_LABELS: Record<string, string> = { admin: "Admin", developer: "Developer", hod: "HOD", pc: "PC", tl: "Team Leader", hr: "HR", auditor: "Auditor", doer: "Doer" };

// ---- date helpers (IST) ----
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
export const todayKey = (): string => dayFmt.format(new Date());
// Date -> "YYYY-MM-DD" in IST
export const istDay = (d?: string | number | Date | null): string => (d ? dayFmt.format(new Date(d)) : "");

export function addDays(key: string, n: number): string {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "2026-09-28" -> "28/09/2026"
export function showDay(key?: string | null): string {
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
export function showDateTime(value?: string | number | Date | null): string {
  if (!value) return "";
  return dtFmt.format(new Date(value));
}
