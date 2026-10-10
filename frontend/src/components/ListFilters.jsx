import { useEffect, useState } from "react";
import { addDays, api, todayKey } from "../api";
import DoerSelect from "./DoerSelect";

// MIDAP list filters shared by List Doer Tasks, List FMS Tasks and the Audit List

// "Mode": a quick date range – Today, This week, This month, 1st–4th week of this month, This year, Last month
export const RANGES = [
  ["", "Custom dates"],
  ["today", "Today"],
  ["week", "This week"],
  ["lastweek", "Last week"],
  ["month", "This month"],
  ["w1", "1st week of month"],
  ["w2", "2nd week of month"],
  ["w3", "3rd week of month"],
  ["w4", "4th week of month"],
  ["lastmonth", "Last month"],
  ["year", "This year"],
];
export function rangeOf(key, today = todayKey()) {
  const dow = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7;
  const monday = addDays(today, -dow);
  const first = today.slice(0, 8) + "01";
  const lastOfMonth = addDays(addDays(first, 32).slice(0, 8) + "01", -1);
  switch (key) {
    case "today":
      return [today, today];
    case "week":
      return [monday, addDays(monday, 6)];
    case "lastweek":
      return [addDays(monday, -7), addDays(monday, -1)];
    case "month":
      return [first, lastOfMonth];
    case "w1":
    case "w2":
    case "w3":
    case "w4": {
      // days 1-7, 8-14, 15-21, 22-end of the month
      const n = Number(key[1]);
      const from = addDays(first, (n - 1) * 7);
      return [from, n === 4 ? lastOfMonth : addDays(from, 6)];
    }
    case "lastmonth": {
      const end = addDays(first, -1);
      return [end.slice(0, 8) + "01", end];
    }
    case "year":
      return [today.slice(0, 4) + "-01-01", today.slice(0, 4) + "-12-31"];
    default:
      return null;
  }
}

export function RangeSelect({ value, onChange, label = "Mode" }) {
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value, rangeOf(e.target.value))} aria-label={label} title={label}>
      {RANGES.map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </select>
  );
}

export const STATUSES = [
  ["", "Any status"],
  ["pending", "Pending"],
  ["pending_late", "Pending · delayed"],
  ["done_ontime", "Completed on time"],
  ["done_late", "Completed · delayed"],
  ["na", "Not required"],
  ["expired", "Auto-closed"],
];
export const PRIORITY_OPTIONS = [
  ["", "Any priority"],
  ["normal", "Normal"],
  ["high", "High"],
  ["critical", "Critical"],
];

let orgCache = null;
function useOrg() {
  const [org, setOrg] = useState(orgCache || { departments: [], branches: [], groups: [] });
  useEffect(() => {
    if (orgCache) return;
    Promise.all([api("/org/departments").catch(() => []), api("/org/branches").catch(() => []), api("/checklists/groups").catch(() => [])]).then(([departments, branches, groups]) => {
      orgCache = { departments, branches, groups };
      setOrg(orgCache);
    });
  }, []);
  return org;
}

// The extra filters behind "More filters". show: which ones this list offers
export function MoreFilters({ f, set, show = ["priority", "department", "branch", "group", "assignedBy", "pc", "auditor"] }) {
  const org = useOrg();
  const has = (k) => show.includes(k);
  const sel = (key, options, placeholder) => (
    <select value={f[key] || ""} onChange={(e) => set({ [key]: e.target.value })} aria-label={placeholder}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o._id} value={o._id}>
          {o.name}
        </option>
      ))}
    </select>
  );
  return (
    <div className="row wrap filters more-filters">
      {has("priority") && (
        <select value={f.priority || ""} onChange={(e) => set({ priority: e.target.value })} aria-label="Priority">
          {PRIORITY_OPTIONS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      )}
      {has("department") && sel("department", org.departments, "All departments")}
      {has("branch") && org.branches.length > 1 && sel("branch", org.branches, "All branches")}
      {has("group") && org.groups.length > 0 && sel("group", org.groups, "All checklist groups")}
      {has("assignedBy") && (
        <label className="inline small">
          Assigned by <DoerSelect value={f.assignedBy} onChange={(v) => set({ assignedBy: v })} placeholder="Anyone" />
        </label>
      )}
      {has("pc") && (
        <label className="inline small">
          PC <DoerSelect value={f.pc} onChange={(v) => set({ pc: v })} placeholder="Any" />
        </label>
      )}
      {has("auditor") && (
        <label className="inline small">
          Auditor <DoerSelect value={f.auditor} onChange={(v) => set({ auditor: v })} placeholder="Any" />
        </label>
      )}
    </div>
  );
}

// How many of the "More filters" are set, for the button label
export const moreCount = (f, keys = ["priority", "department", "branch", "group", "assignedBy", "pc", "auditor"]) => keys.filter((k) => f[k]).length;
