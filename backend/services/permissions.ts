// Page-level permissions, like MIDAP's add / list / edit / delete per module.
// Each role has defaults; an admin can override them per user (User.permissions).
// Which people an action reaches is the scope (services/scope.ts): their own people, or everyone for
// admins, auditors, HR and anyone given "Sees everyone".

const ACTIONS = ["view", "add", "edit", "delete"];

const MODULES = {
  myAttendance: "My Attendance (punch in / out)",
  myLeave: "My Leave (apply)",
  myTickets: "My Tickets (raise)",
  fms: "FMS Manager (Master FMS)",
  fmsEntries: "FMS entries",
  checklist: "Checklists",
  delegation: "Delegations",
  reports: "PC reports & MIS",
  leave: "HRMS – Leave",
  attendance: "HRMS – Attendance",
  hrSetup: "HRMS – Setup",
  tickets: "Help Ticket – Manage",
  ticketSetup: "Help Ticket – Setup",
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
  fms: { view: "See the Master FMS list", add: "Create an FMS / import from a sheet", edit: "Change an FMS and its rules", delete: "Delete an FMS" },
  fmsEntries: { view: "See FMS entries", add: "Add an entry", edit: "Change entries, close / reopen", delete: "Delete entries" },
  checklist: { view: "See checklists", add: "Create checklists", edit: "Change checklists", delete: "Delete checklists" },
  delegation: { view: "See all delegations of their people", add: "Assign delegations", edit: "Change / approve new deadlines", delete: "Delete delegations" },
  reports: { view: "See MIS, doer / FMS task lists and reports", edit: "Switch the doer of pending tasks (task lists)", delete: "Delete checklist / delegation tasks (task lists)" },
  leave: { view: "See the Leave List of their people", add: "Apply leave for someone else", edit: "Approve / reject / cancel leave" },
  attendance: { view: "See the Attendance Register", add: "Upload the biometric file", edit: "Mark days by hand, approve correction requests" },
  hrSetup: { view: "See leave types, policies, shifts, policy assignment", edit: "Change them, give people policies / shifts", delete: "Delete leave types, policies, shifts" },
  tickets: { view: "See all tickets of their people and the Ticket Report", edit: "Assign / solve / cancel those tickets" },
  ticketSetup: { edit: "Change ticket categories and settings" },
  users: { view: "See users", add: "Add users", edit: "Change users", delete: "Delete users" },
  org: { view: "See branches and departments", add: "Add them", edit: "Change them", delete: "Delete them" },
  settings: { view: "See the settings", edit: "Change sheet links, reminders, calendar, auditor and meeting settings" },
  audit: { view: "See the audit log" },
};

// Areas, for showing the grid in groups
const MODULE_GROUPS = [
  ["Self service", ["myAttendance", "myLeave", "myTickets"]],
  ["Work", ["fms", "fmsEntries", "checklist", "delegation", "reports"]],
  ["HRMS", ["leave", "attendance", "hrSetup"]],
  ["Help Ticket", ["tickets", "ticketSetup"]],
  ["Admin", ["users", "org", "settings", "audit"]],
];

const allOf = (m) => Object.keys(MODULE_ACTIONS[m]);
// everyone can punch, apply for leave and raise tickets unless an admin takes it away (user or department)
const SELF = { myAttendance: ["view"], myLeave: ["view"], myTickets: ["view"] };
const EVERYTHING = Object.fromEntries(Object.keys(MODULES).map((m) => [m, allOf(m)]));
const ROLE_DEFAULTS = {
  admin: EVERYTHING,
  // Developer: everything an admin has (keeps the software running)
  developer: EVERYTHING,
  hod: {
    ...SELF,
    fms: ["view"],
    fmsEntries: ["view", "add", "edit"],
    checklist: ["view", "add", "edit"],
    delegation: ["view", "add", "edit"],
    reports: ["view", "edit"],
    leave: ["view", "add", "edit"],
    attendance: ["view", "edit"],
    tickets: ["view", "edit"],
    users: ["view"],
    org: ["view"],
  },
  pc: {
    ...SELF,
    fms: ["view"],
    fmsEntries: ["view", "add", "edit"],
    checklist: ["view", "add", "edit"],
    delegation: ["view", "add", "edit"],
    reports: ["view", "edit"],
    leave: ["view", "add", "edit"],
    attendance: ["view", "edit"],
    tickets: ["view", "edit"],
    users: ["view"],
  },
  // Team Leader: follows up and assigns work for the people who have them as team leader
  tl: {
    ...SELF,
    fmsEntries: ["view", "add", "edit"],
    checklist: ["view", "add", "edit"],
    delegation: ["view", "add", "edit"],
    reports: ["view", "edit"],
    leave: ["view", "add", "edit"],
    attendance: ["view", "edit"],
    tickets: ["view", "edit"],
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
    fmsEntries: ["view"],
    checklist: ["view"],
    delegation: ["view"],
    reports: ["view"],
  },
  doer: {
    ...SELF,
    fmsEntries: ["view", "add"],
    reports: ["view"],
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

export = { ACTIONS, MODULES, MODULE_ACTIONS, MODULE_GROUPS, ROLES, FULL_ROLES, ADMIN_ONLY_ROLES, ROLE_DEFAULTS, isAdmin, permissionsFor, can, cleanOverrides };
