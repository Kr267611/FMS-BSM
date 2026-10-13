// Shared bits of the attendance pages: what each day code means, and time formatting (IST)

export const STATUS: Record<string, { label: string; cls: string }> = {
  P: { label: "Present", cls: "att-p" },
  H: { label: "Half day", cls: "att-h" },
  A: { label: "Absent", cls: "att-a" },
  L: { label: "Leave", cls: "att-l" },
  WO: { label: "Week-off", cls: "att-off" },
  HO: { label: "Holiday", cls: "att-off" },
  MP: { label: "Missed punch", cls: "att-mp" },
  IN: { label: "Working now", cls: "att-in" },
  "": { label: "—", cls: "att-none" },
};

export interface DayCell {
  day: string;
  status: string;
  manual: boolean;
  firstIn: string | null;
  lastOut: string | null;
  punches: number;
  workMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  late: boolean;
  early: boolean;
  offDayWork: boolean;
  halfLeave: boolean;
  shift: string;
  note: string;
  before?: boolean; // before the person joined / attendance started
}

export interface MonthSummary {
  P: number;
  H: number;
  A: number;
  L: number;
  WO: number;
  HO: number;
  MP: number;
  late: number;
  early: number;
  workMinutes: number;
  presentDays: number;
  cutDays: number;
  marks: number;
}

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true });
export const showTime = (v?: string | number | Date | null): string => (v ? timeFmt.format(new Date(v)) : "");

// 545 -> "9h 05m"
export const hm = (minutes?: number): string => {
  const m = Math.max(0, Math.round(minutes || 0));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

// "2026-10" -> "October 2026"; and the month before / after
export const monthName = (m: string): string => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
export const shiftMonth = (m: string, n: number): string => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
export const weekdayOf = (day: string): number => new Date(day + "T00:00:00Z").getUTCDay();
export const fmtDays = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
