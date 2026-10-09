import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ROLE_LABELS, api, can } from "./api";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import MyTasks from "./pages/MyTasks";
import Dashboard from "./pages/Dashboard";
import DoerTasks from "./pages/DoerTasks";
import WeeklyMis from "./pages/WeeklyMis";
import Performance from "./pages/Performance";
import FmsTasks from "./pages/FmsTasks";
import FmsRules from "./pages/FmsRules";
import AutoComplete from "./pages/AutoComplete";
import Checklists from "./pages/Checklists";
import ChecklistBulk from "./pages/ChecklistBulk";
import Delegations from "./pages/Delegations";
import Jobs from "./pages/Jobs";
import Processes from "./pages/Processes";
import FmsBuilder from "./pages/FmsBuilder";
import CalendarSettings from "./pages/CalendarSettings";
import SheetLinks from "./pages/SheetLinks";
import Mis from "./pages/Mis";
import Reminders from "./pages/Reminders";
import Users from "./pages/Users";
import BulkUsers from "./pages/BulkUsers";
import Org from "./pages/Org";
import Audit from "./pages/Audit";
import Account from "./pages/Account";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api("/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return (
    <>
      <WakeBanner />
      <div className="center muted">Loading…</div>
    </>
  );

  const login = (u) => setUser(u);
  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, setUser }}>
      <WakeBanner />
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/*" element={user ? <Shell /> : <Navigate to="/login" />} />
      </Routes>
    </AuthContext.Provider>
  );
}

// Menu grouped the way MIDAP users know it. `soon` items are planned milestones, shown to admins only.
function menuFor(user) {
  const groups = [
    { title: "My Work", items: [{ to: "/dashboard", label: "Dashboard" }, { to: "/", label: "My Tasks", end: true }] },
    {
      title: "Master Tasks",
      items: [
        { to: "/checklists", label: "Checklists", show: can(user, "checklist") },
        { to: "/delegations", label: "Delegations", show: can(user, "delegation") || can(user, "delegation", "add") },
      ],
    },
    {
      title: "FMS Manager",
      items: [
        { to: "/processes", label: "List Master FMS", end: true, show: can(user, "fms") },
        { to: "/processes/new", label: "Add Master FMS", show: can(user, "fms", "add") },
        { to: "/fms/doer-conditions", label: "Doer Conditions", show: can(user, "fms") },
        { to: "/fms/override-tat", label: "Override TAT", show: can(user, "fms") },
        { to: "/fms/auto-calculate", label: "Auto-calculate Fields", show: can(user, "fms") },
        { to: "/fms/auto-complete", label: "FMS Auto Complete", show: can(user, "fms") },
        { to: "/jobs", label: "FMS Entries", show: can(user, "fmsEntries") },
      ],
    },
    {
      title: "PC Reports",
      items: [
        { to: "/reports/tasks", label: "Doer Tasks", show: can(user, "reports") && user.role !== "doer" },
        { to: "/reports/fms-tasks", label: "FMS Tasks", show: can(user, "reports") && user.role !== "doer" },
        { to: "/mis", label: "MIS Score", end: true, show: can(user, "reports") },
        { to: "/mis/weekly", label: "Weekly MIS Score", show: can(user, "reports") },
        { to: "/mis/performance", label: "Performance Score", show: can(user, "reports") },
      ],
    },
    {
      title: "Users & Org",
      items: [
        { to: "/users", label: "Users", show: can(user, "users") },
        { to: "/users/bulk", label: "Bulk Upload", show: can(user, "users", "add") },
        { to: "/org", label: "Branches & Departments", show: can(user, "org") },
      ],
    },
    {
      title: "Settings",
      items: [
        { to: "/calendar", label: "Working Calendar", show: can(user, "settings") || can(user, "fms") },
        { to: "/sheets", label: "Sheet Links", show: can(user, "settings", "edit") },
        { to: "/reminders", label: "Reminders", show: can(user, "settings") },
        { to: "/audit", label: "Audit Log", show: can(user, "audit") },
      ],
    },
  ];
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show !== false) }))
    .filter((g) => g.items.length);
}

const initials = (name) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const MENU_KEY = "fms_bsm_menu";

function Shell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location.pathname]);

  const groups = menuFor(user);
  const guard = (ok, el) => (ok ? el : <Navigate to="/" />);

  // Collapsible menu groups (+ / −), like MIDAP. The group of the open page is always expanded;
  // the groups a user opened are remembered in this browser.
  const [expanded, setExpanded] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(MENU_KEY)) || ["My Work"];
    } catch {
      return ["My Work"];
    }
  });
  const isHere = (i) => i.to && (i.end ? location.pathname === i.to : location.pathname === i.to || location.pathname.startsWith(i.to + "/"));
  const activeGroup = groups.find((g) => g.items.some(isHere))?.title;
  function toggleGroup(title) {
    setExpanded((prev) => {
      const next = prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title];
      try {
        localStorage.setItem(MENU_KEY, JSON.stringify(next));
      } catch {
        /* private window */
      }
      return next;
    });
  }

  return (
    <div className={open ? "app menu-open" : "app"}>
      <aside className="sidebar">
        <div className="brand">FMS BSM</div>
        <nav className="side-nav">
          {groups.map((g) => {
            const isOpen = expanded.includes(g.title) || g.title === activeGroup;
            return (
            <div key={g.title} className={"side-group" + (isOpen ? " open" : "")}>
              <button type="button" className="side-title" onClick={() => toggleGroup(g.title)} aria-expanded={isOpen}>
                <span>{g.title}</span>
                <span className="side-toggle" aria-hidden="true" />
              </button>
              <div className="side-items">
                <div>
              {g.items.map((i) =>
                i.soon ? (
                  <span key={i.label} className="side-link soon" title="Coming in the next milestone">
                    {i.label} <em>soon</em>
                  </span>
                ) : (
                  <NavLink key={i.to} to={i.to} end={i.end} className="side-link" tabIndex={isOpen ? undefined : -1}>
                    {i.label}
                  </NavLink>
                )
              )}
                </div>
              </div>
            </div>
            );
          })}
        </nav>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />

      <div className="main-col">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setOpen(!open)} aria-label="Menu">
            ☰
          </button>
          <div className="topbar-spacer" />
          <NavLink to="/account" className="who-name" title="My account">
            <b className="avatar">{initials(user.name)}</b>
            <span>
              {user.name}
              <small>
                {ROLE_LABELS[user.role] || user.role}
                {user.department ? ` · ${user.department}` : ""}
              </small>
            </span>
          </NavLink>
          <button
            className="btn ghost small"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            Logout
          </button>
        </header>
        <main className="page">
          <div key={location.pathname} className="page-anim">
          <Routes>
            <Route path="/" element={<MyTasks />} />
            <Route path="/account" element={<Account />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/mis/performance" element={guard(can(user, "reports"), <Performance />)} />
            <Route path="/mis/weekly" element={guard(can(user, "reports"), <WeeklyMis />)} />
            <Route path="/fms/doer-conditions" element={guard(can(user, "fms"), <FmsRules kind="doer" />)} />
            <Route path="/fms/override-tat" element={guard(can(user, "fms"), <FmsRules kind="tat" />)} />
            <Route path="/fms/auto-complete" element={guard(can(user, "fms"), <AutoComplete />)} />
            <Route path="/fms/auto-calculate" element={guard(can(user, "fms"), <FmsRules kind="calc" />)} />
            <Route path="/reports/fms-tasks" element={guard(can(user, "reports"), <FmsTasks />)} />
            <Route path="/reports/tasks" element={guard(can(user, "reports"), <DoerTasks />)} />
            <Route path="/checklists" element={guard(can(user, "checklist"), <Checklists />)} />
            <Route path="/checklists/bulk" element={guard(can(user, "checklist", "add"), <ChecklistBulk />)} />
            <Route path="/delegations" element={<Delegations />} />
            <Route path="/jobs" element={guard(can(user, "fmsEntries"), <Jobs />)} />
            <Route path="/mis" element={guard(can(user, "reports"), <Mis />)} />
            <Route path="/processes" element={guard(can(user, "fms"), <Processes />)} />
            <Route path="/processes/new" element={guard(can(user, "fms", "add"), <FmsBuilder />)} />
            <Route path="/processes/:id" element={guard(can(user, "fms", "edit"), <FmsBuilder />)} />
            <Route path="/calendar" element={guard(can(user, "settings") || can(user, "fms"), <CalendarSettings />)} />
            <Route path="/users" element={guard(can(user, "users"), <Users />)} />
            <Route path="/users/bulk" element={guard(can(user, "users", "add"), <BulkUsers />)} />
            <Route path="/org" element={guard(can(user, "org"), <Org />)} />
            <Route path="/sheets" element={guard(can(user, "settings", "edit"), <SheetLinks />)} />
            <Route path="/reminders" element={guard(can(user, "settings"), <Reminders />)} />
            <Route path="/audit" element={guard(can(user, "audit"), <Audit />)} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

// Shown while the free server wakes up (see waitForServer in api.js)
function WakeBanner() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const h = (e) => setOn(e.detail);
    window.addEventListener("fms:waking", h);
    return () => window.removeEventListener("fms:waking", h);
  }, []);
  if (!on) return null;
  return <div className="wake-banner">The server is waking up – this can take up to a minute. Please wait…</div>;
}
