// Page-level permissions, like MIDAP's add / list / edit / delete per module.
// Each role has defaults; an admin can override them per user (User.permissions).

const ACTIONS = ["view", "add", "edit", "delete"];

const MODULES = {
  fms: "FMS Manager (Master FMS)",
  fmsEntries: "FMS entries",
  checklist: "Checklists",
  delegation: "Delegations",
  reports: "PC reports & MIS",
  users: "Users",
  org: "Branches & departments",
  settings: "Settings (sheet links, reminders)",
  audit: "Audit log",
};

const ALL = [...ACTIONS];
const ROLE_DEFAULTS = {
  admin: Object.fromEntries(Object.keys(MODULES).map((m) => [m, ALL])),
  hod: {
    fms: ["view"],
    fmsEntries: ["view", "add", "edit"],
    checklist: ["view", "add", "edit"],
    delegation: ["view", "add", "edit"],
    reports: ["view"],
    users: ["view"],
    org: ["view"],
  },
  pc: {
    fms: ["view"],
    fmsEntries: ["view", "add", "edit"],
    checklist: ["view", "add", "edit"],
    delegation: ["view", "add", "edit"],
    reports: ["view"],
    users: ["view"],
  },
  auditor: {
    fms: ["view"],
    fmsEntries: ["view"],
    checklist: ["view"],
    delegation: ["view"],
    reports: ["view"],
  },
  doer: {
    fmsEntries: ["view", "add"],
    reports: ["view"],
  },
};

const ROLES = {
  admin: "Admin",
  hod: "HOD",
  pc: "PC (Process Coordinator)",
  auditor: "Auditor",
  doer: "Doer",
};

// The effective { module: [actions] } map for a user
function permissionsFor(user) {
  if (!user) return {};
  if (user.role === "admin") return ROLE_DEFAULTS.admin; // admins cannot lock themselves out
  const base = ROLE_DEFAULTS[user.role] || ROLE_DEFAULTS.doer;
  const out = { ...base };
  for (const [mod, acts] of Object.entries(user.permissions || {})) {
    if (!MODULES[mod] || !Array.isArray(acts)) continue;
    out[mod] = acts.filter((a) => ACTIONS.includes(a));
  }
  return out;
}

function can(user, module, action) {
  return (permissionsFor(user)[module] || []).includes(action);
}

// Only keep valid modules/actions from an admin's override form
function cleanOverrides(input) {
  if (!input || typeof input !== "object") return undefined;
  const out = {};
  for (const [mod, acts] of Object.entries(input)) {
    if (MODULES[mod] && Array.isArray(acts)) out[mod] = [...new Set(acts.filter((a) => ACTIONS.includes(a)))];
  }
  return Object.keys(out).length ? out : undefined;
}

module.exports = { ACTIONS, MODULES, ROLES, ROLE_DEFAULTS, permissionsFor, can, cleanOverrides };
