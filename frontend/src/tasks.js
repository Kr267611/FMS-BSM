// Shared words and helpers for checklists and delegations
import { istDay } from "./api";

export const PRIORITIES = [
  ["normal", "Normal"],
  ["high", "High"],
  ["critical", "Critical"],
];
export const priorityLabel = (p) => (PRIORITIES.find(([k]) => k === p) || [p, ""])[1];
// tag colour for a priority; normal gets no tag
export const priorityTone = (p) => (p === "critical" ? "red" : p === "high" ? "amber" : "");

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const FREQUENCY_TYPES = [
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["interval", "Every N days"],
];
export const MONTH_STEPS = [
  [1, "Every month"],
  [2, "Every 2 months"],
  [3, "Every 3 months (quarterly)"],
  [6, "Every 6 months"],
  [12, "Every year"],
];
export const HOLIDAY_RULES = [
  ["skip", "Skip that day"],
  ["next", "Move to the next working day"],
  ["previous", "Move to the previous working day"],
];

// Same words as the server: "Every day", "Every Mon, Thu", "Monthly on 1, last day"…
export function describeFrequency(f) {
  if (!f) return "";
  const dates = (f.dates || []).map((d) => (d === 31 ? "last day" : d)).join(", ");
  switch (f.type) {
    case "daily":
      return "Every day";
    case "weekly":
      return `Every ${(f.days || []).map((d) => WEEKDAYS[d]).join(", ")}`;
    case "monthly":
      return `${f.every > 1 ? `Every ${f.every} months` : "Monthly"} on ${dates}`;
    case "interval":
      return `Every ${f.every} days`;
    default:
      return "";
  }
}

// "1, 15, last" -> [1, 15, 31]
export function parseDates(text) {
  return [
    ...new Set(
      String(text || "")
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((d) => (/^last/i.test(d) ? 31 : Number(d)))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31)
    ),
  ].sort((a, b) => a - b);
}
export const showDates = (dates) => (dates || []).map((d) => (d === 31 ? "last" : d)).join(", ");

const DAY_MS = 86400000;
const dayDiff = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY_MS);

// How a deadline looks: overdue / due today / in N days / done on time / done late
export function deadlineState(task, today) {
  const planned = task.plannedDay || istDay(task.planned);
  if (task.status === "done") {
    const late = dayDiff(planned, task.actualDay || istDay(task.actual));
    return late > 0 ? { tone: "amber", text: `Done ${late}d late` } : { tone: "green", text: "Done on time" };
  }
  if (task.status === "expired") return { tone: "red", text: "Auto-closed · not done" };
  if (task.status === "na") return { tone: "gray", text: "Not required" };
  const d = dayDiff(today, planned);
  if (d < 0) return { tone: "red", text: `${-d}d overdue` };
  if (d === 0) return { tone: "amber", text: new Date(task.planned) < new Date() ? "Overdue today" : "Due today" };
  return { tone: "", text: `in ${d}d` };
}

export const pendingRevision = (task) => (task.revisions || []).find((r) => r.status === "pending");
export const approvedRevisions = (task) => (task.revisions || []).filter((r) => r.status === "approved").length;

// datetime-local value in IST ("YYYY-MM-DDTHH:mm") <-> ISO
export function splitIst(iso) {
  if (!iso) return { date: "", time: "18:00" };
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(d)
    .reduce((o, p) => ((o[p.type] = p.value), o), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}` };
}
export const joinIst = (date, time) => (date ? new Date(`${date}T${time || "18:00"}:00+05:30`).toISOString() : "");
