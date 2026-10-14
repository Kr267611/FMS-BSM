// Page-level permissions, like MIDAP's add / list / edit / delete per module.
// Each role has defaults; an admin can override them per user (User.permissions).
// Which people an action reaches is the scope (services/scope.ts): their own people, or everyone for
// admins, auditors, HR and anyone given "Sees everyone".

const ACTIONS = ["view", "add", "edit", "delete"];

// One entry per menu page (or per area where one page has it all). Each tick is exactly one page.
const MODULES = {
  myAttendance: "My Attendance (punch in / out)",
  myLeave: "My Leave (apply)",
  myTickets: "My Tickets (raise)",
  checklist: "Checklists",
  delegation: "Delegations",
  fms: "List / Add Master FMS",
  fmsImport: "Import FMS from Sheet",
  doerConditions: "Doer Conditions",
  overrideTat: "Override TAT",
  autoCalc: "Auto-calculate Fields",
  autoComplete: "FMS Auto Complete",
  fmsBulk: "Bulk Delete / Download",
  fmsEntries: "FMS Entries",
  doerTasks: "List Doer Tasks",
  fmsTasks: "List FMS Tasks",
  misScore: "MIS Score",
  weeklyMis: "Weekly MIS Score",
  misMeeting: "Weekly MIS Meeting",
  performance: "Performance Score",
  auditorReport: "Auditor Report",
  effortReport: "List Effort Time",
  auditList: "Audit List",
  auditorSettings: "Auditor Settings",
  leave: "HRMS – Leave",
  attendance: "HRMS – Attendance",
  hrSetup: "HRMS – Setup",
  tickets: "Ticket List (manage)",
  ticketReport: "Ticket Report",
  ticketSetup: "Ticket Categories & settings",
  users: "Users",
  org: "Branches & departments",
  settings: "Settings (sheet links, reminders, calendar)",
  audit: "Audit log",
};

// What each action means in each module (only these can be given; the rest do not apply)
const MODULE_ACTIONS = {
  myAttendance: { view: "Punch in / out, see their own attendance, ask for corrections" },
  myLeave: { view: "Apply for leave, see their own balance" },
  myTickets: { view: "Raise help tickets and follow their own" },
  checklist: { view: "See checklists", add: "Create checklists", edit: "Change checklists", delete: "Delete checklists" },
  delegation: { view: "See all delegations of their people", add: "Assign delegations", edit: "Change / approve new deadlines", delete: "Delete delegations" },
  fms: { view: "See the Master FMS list", add: "Create an FMS (Add Master FMS)", edit: "Change an FMS and its rules", delete: "Delete an FMS" },
  fmsImport: { add: "Make an FMS from a Google Sheet tab" },
  doerConditions: { view: "See who does each step of every FMS" },
  overrideTat: { view: "See the TAT rules of every FMS" },
  autoCalc: { view: "See the auto-calculated fields of every FMS" },
  autoComplete: { view: "See the rules", add: "Add rules", edit: "Change rules", delete: "Delete rules" },
  fmsBulk: { view: "Download entries in bulk", delete: "Delete entries in bulk" },
  fmsEntries: { view: "See FMS entries", add: "Add an entry", edit: "Change entries, close / reopen, mark steps done for others", delete: "Delete entries" },
  doerTasks: { view: "See every checklist, delegation and FMS task of their people", edit: "Switch the doer of pending tasks", delete: "Delete checklist / delegation tasks" },
  fmsTasks: { view: "See every FMS step of their people", edit: "Switch the doer of pending steps" },
  misScore: { view: "Planned / actual / late / pending / score by doer" },
  weeklyMis: { view: "The week's score by doer" },
  misMeeting: { view: "The weekly MIS meeting report" },
  performance: { view: "Performance score by doer" },
  auditorReport: { view: "Audited / OK / Not OK by auditor and doer" },
  effortReport: { view: "Time spent on tasks" },
  auditList: { view: "See and audit the tasks they are the auditor of (with Make Auditor this is always on)" },
  auditorSettings: { edit: "Choose auditors and how much of each one's work is audited" },
  leave: { view: "See the Leave List of their people", add: "Apply leave for someone else", edit: "Approve / reject / cancel leave" },
  attendance: { view: "See the Attendance Register", add: "Upload the biometric file", edit: "Mark days by hand, approve correction requests" },
  hrSetup: { view: "See leave types, policies, shifts, policy assignment", edit: "Change them, give people policies / shifts", delete: "Delete leave types, policies, shifts" },
  tickets: { view: "See all tickets of their people", edit: "Assign / solve / cancel those tickets" },
  ticketReport: { view: "Tickets raised / solved / late by person and category" },
  ticketSetup: { edit: "Change ticket categories and settings" },
  users: { view: "See users", add: "Add users", edit: "Change users", delete: "Delete users" },
  org: { view: "See branches and departments", add: "Add them", edit: "Change them", delete: "Delete them" },
  settings: { view: "See the settings", edit: "Change sheet links, reminders, calendar, auditor and meeting settings" },
  audit: { view: "See the audit log" },
};

// Areas, as in the menu, for showing the grid in groups
const MODULE_GROUPS = [
  ["Self service", ["myAttendance", "myLeave", "myTickets"]],
  ["Master Tasks", ["checklist", "delegation"]],
  ["FMS Manager", ["fms", "fmsImport", "doerConditions", "overrideTat", "autoCalc", "autoComplete", "fmsBulk", "fmsEntries"]],
  ["PC Reports", ["doerTasks", "fmsTasks", "misScore", "weeklyMis", "misMeeting", "performance", "auditorReport", "effortReport"]],
  ["Audit", ["auditList", "auditorSettings"]],
  ["HRMS", ["leave", "attendance", "hrSetup"]],
  ["Help Ticket", ["tickets", "ticketReport", "ticketSetup"]],
  ["Admin", ["users", "org", "settings", "audit"]],
];
// The PC Reports pages, and the FMS Manager lists that only show rules (they are changed in the FMS itself)
const REPORT_PAGES = MODULE_GROUPS.find(([g]) => g === "PC Reports")[1] as string[];
const FMS_LISTS = ["doerConditions", "overrideTat", "autoCalc"];
// Pages of the FMS Manager / PC Reports besides the Master FMS and the entries (for "may this user read FMS definitions")
const FMS_PAGES = [...FMS_LISTS, "autoComplete", "fmsBulk", "fmsImport"];

const allOf = (m) => Object.keys(MODULE_ACTIONS[m]);
// everyone can punch, apply for leave and raise tickets unless an admin takes it away (user or department)
const SELF = { myAttendance: ["view"], myLeave: ["view"], myTickets: ["view"] };
const EVERYTHING = Object.fromEntries(Object.keys(MODULES).map((m) => [m, allOf(m)]));
const view = (keys) => Object.fromEntries(keys.map((k) => [k, ["view"]]));
// What HOD / PC / Team Leader see of the PC Reports, and what a doer sees (their own score pages)
const STAFF_REPORTS = { ...view(REPORT_PAGES), doerTasks: ["view", "edit"], fmsTasks: ["view", "edit"] };
const DOER_REPORTS = view(["misScore", "weeklyMis", "performance", "effortReport"]);
const ROLE_DEFAULTS = {
  admin: EVERYTHING,
  // Developer: everything an admin has (keeps the software running)
  developer: EVERYTHING,
  hod: {
    ...SELF,
    fms: ["view"],
    ...view([...FMS_LISTS, "autoComplete", "fmsBulk"]),
    fmsEntries: ["view", "add", "edit"],
    checklist: ["view", "add", "edit"],
    delegation: ["view", "add", "edit"],
    ...STAFF_REPORTS,
    leave: ["view", "add", "edit"],
    attendance: ["view", "edit"],
    tickets: ["view", "edit"],
    ticketReport: ["view"],
    users: ["view"],
    org: ["view"],
  },
  pc: {
    ...SELF,
    fms: ["view"],
    ...view([...FMS_LISTS, "autoComplete", "fmsBulk"]),
    fmsEntries: ["view", "add", "edit"],
    checklist: ["view", "add", "edit"],
    delegation: ["view", "add", "edit"],
    ...STAFF_REPORTS,
    leave: ["view", "add", "edit"],
    attendance: ["view", "edit"],
    tickets: ["view", "edit"],
    ticketReport: ["view"],
    users: ["view"],
  },
  // Team Leader: follows up and assigns work for the people who have them as team leader
  tl: {
    ...SELF,
    fmsBulk: ["view"],
    fmsEntries: ["view", "add", "edit"],
    checklist: ["view", "add", "edit"],
    delegation: ["view", "add", "edit"],
    ...STAFF_REPORTS,
    leave: ["view", "add", "edit"],
    attendance: ["view", "edit"],
    tickets: ["view", "edit"],
    ticketReport: ["view"],
    users: ["view"],
  },
  // HR: all of HRMS for the whole company, and keeps the employee list
  hr: {
    ...SELF,
    leave: ["view", "add", "edit"],
    attendance: ["view", "add", "edit"],
    hrSetup: ["view", "edit", "delete"],
    users: ["view", "add", "edit"],
    org: ["view"],
  },
  auditor: {
    ...SELF,
    fms: ["view"],
    ...view([...FMS_LISTS, "autoComplete", "fmsBulk"]),
    fmsEntries: ["view"],
    checklist: ["view"],
    delegation: ["view"],
    ...view(REPORT_PAGES),
    auditList: ["view"],
  },
  doer: {
    ...SELF,
    fmsEntries: ["view", "add"],
    ...DOER_REPORTS,
  },
};

const ROLES = {
  admin: "Admin",
  developer: "Developer",
  hod: "HOD",
  pc: "PC (Process Coordinator)",
  tl: "Team Leader",
  hr: "HR",
  auditor: "Auditor",
  doer: "Doer",
};
// Roles with every permission, the whole company and the admin-only actions
const FULL_ROLES = ["admin", "developer"];
const isAdmin = (user) => FULL_ROLES.includes(user?.role);
// Roles only an admin (or developer) may give: they reach the whole company
const ADMIN_ONLY_ROLES = ["admin", "developer", "hr"];

const keep = (mod, acts) => [...new Set<any>(acts.filter((a) => MODULE_ACTIONS[mod]?.[a]))];

// The effective { module: [actions] } map for a user:
//   the role's defaults, then their department's access (set by an admin), then the user's own – each module
//   set at a later level replaces the earlier one. user.deptPermissions is attached when the user is loaded.
function permissionsFor(user) {
  if (!user) return {};
  if (isAdmin(user)) return EVERYTHING; // admins and developers cannot lock themselves out
  const base = ROLE_DEFAULTS[user.role] || ROLE_DEFAULTS.doer;
  const out: Record<string, any> = { ...base };
  for (const layer of [user.deptPermissions, user.permissions]) {
    for (const [mod, acts] of Object.entries<any>(layer || {})) {
      if (!MODULES[mod] || !Array.isArray(acts)) continue;
      out[mod] = keep(mod, acts);
    }
  }
  return out;
}

function can(user, module, action) {
  return (permissionsFor(user)[module] || []).includes(action);
}

// Only keep valid modules/actions from an admin's override form
function cleanOverrides(input) {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, any> = {};
  for (const [mod, acts] of Object.entries<any>(input)) {
    if (MODULES[mod] && Array.isArray(acts)) out[mod] = keep(mod, acts);
  }
  return Object.keys(out).length ? out : undefined;
}

export = { ACTIONS, MODULES, MODULE_ACTIONS, MODULE_GROUPS, ROLES, FULL_ROLES, ADMIN_ONLY_ROLES, ROLE_DEFAULTS, REPORT_PAGES, FMS_LISTS, FMS_PAGES, isAdmin, permissionsFor, can, cleanOverrides };
