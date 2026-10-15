import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ROLE_LABELS, api, can, isAdmin } from "./api";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import MyTasks from "./pages/MyTasks";
import Dashboard from "./pages/Dashboard";
import InstallApp from "./components/InstallApp";
import DoerTasks from "./pages/DoerTasks";
import WeeklyMis from "./pages/WeeklyMis";
import AuditorSettings from "./pages/AuditorSettings";
import Leaves from "./pages/Leaves";
import LeaveApply from "./pages/hr/LeaveApply";
import LeaveList from "./pages/hr/LeaveList";
import LeaveTypes from "./pages/hr/LeaveTypes";
import LeavePolicies from "./pages/hr/LeavePolicies";
import PolicyAssignment from "./pages/hr/PolicyAssignment";
import MyAttendance from "./pages/hr/MyAttendance";
import AttendanceRegister from "./pages/hr/AttendanceRegister";
import BiometricUpload from "./pages/hr/BiometricUpload";
import AttendanceSetup from "./pages/hr/AttendanceSetup";
import AttendanceRequests from "./pages/hr/AttendanceRequests";
import AccessOverview from "./pages/AccessOverview";
import RaiseTicket from "./pages/tickets/RaiseTicket";
import TicketList from "./pages/tickets/TicketList";
import TicketCategories from "./pages/tickets/TicketCategories";
import TicketReport from "./pages/tickets/TicketReport";
import MeetingReport from "./pages/MeetingReport";
import Performance from "./pages/Performance";
import FmsTasks from "./pages/FmsTasks";
import FmsRules from "./pages/FmsRules";
import AutoComplete from "./pages/AutoComplete";
import BulkFms from "./pages/BulkFms";
import SheetFmsImport from "./pages/SheetFmsImport";
import AuditList from "./pages/AuditList";
import AuditorReport from "./pages/AuditorReport";
import EffortReport from "./pages/EffortReport";
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
import UsersQuickEdit from "./pages/UsersQuickEdit";
import KraPolicies from "./pages/KraPolicies";
import KraScorecards from "./pages/KraScorecards";
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

type MenuItem = { to: string; label: string; end?: boolean; show?: boolean; soon?: boolean };

// Menu grouped the way MIDAP users know it. `soon` items are planned milestones, shown to admins only.
function menuFor(user) {
  const groups: { title: string; items: MenuItem[] }[] = [
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
        { to: "/fms/import-sheet", label: "Import FMS from Sheet", show: can(user, "fmsImport", "add") },
        { to: "/fms/doer-conditions", label: "Doer Conditions", show: can(user, "doerConditions") },
        { to: "/fms/override-tat", label: "Override TAT", show: can(user, "overrideTat") },
        { to: "/fms/auto-calculate", label: "Auto-calculate Fields", show: can(user, "autoCalc") },
        { to: "/fms/auto-complete", label: "FMS Auto Complete", show: can(user, "autoComplete") },
        { to: "/fms/bulk", label: "Bulk Delete/Download", show: can(user, "fmsBulk") || can(user, "fmsBulk", "delete") },
        { to: "/jobs", label: "FMS Entries", show: can(user, "fmsEntries") },
      ],
    },
    {
      title: "KRA / KPI",
      items: [
        { to: "/kra/me", label: "My Scorecard" },
        { to: "/kra/scorecards", label: "KRA Scorecards", show: can(user, "scorecards") },
        { to: "/kra/policies", label: "KRA Policies", show: can(user, "kraPolicies") },
      ],
    },
    { title: "Audit", items: [{ to: "/audits", label: "Audit List", show: can(user, "auditList") || Boolean(user.isAuditor) }, { to: "/audits/settings", label: "Auditor Settings", show: can(user, "auditorSettings", "edit") }] },
    {
      title: "PC Reports",
      items: [
        { to: "/reports/tasks", label: "List Doer Tasks", show: can(user, "doerTasks") },
        { to: "/reports/fms-tasks", label: "List FMS Tasks", show: can(user, "fmsTasks") },
        { to: "/mis", label: "MIS Score", end: true, show: can(user, "misScore") },
        { to: "/mis/weekly", label: "Weekly MIS Score", show: can(user, "weeklyMis") },
        { to: "/reports/meeting", label: "Weekly MIS Meeting", show: can(user, "misMeeting") },
        { to: "/mis/performance", label: "Performance Score", show: can(user, "performance") },
        { to: "/reports/auditor", label: "Auditor Report", show: can(user, "auditorReport") },
        { to: "/reports/effort", label: "List Effort Time", show: can(user, "effortReport") },
      ],
    },
    {
      title: "Help Ticket",
      items: [
        { to: "/tickets/new", label: "Raise Ticket", show: can(user, "myTickets") },
        { to: "/tickets/mine", label: "My Tickets", show: can(user, "myTickets") },
        { to: "/tickets", label: "Ticket List", end: true, show: can(user, "myTickets") || can(user, "tickets") },
        { to: "/tickets/report", label: "Ticket Report", show: can(user, "ticketReport") },
        { to: "/tickets/categories", label: "Ticket Categories", show: can(user, "ticketSetup", "edit") },
      ],
    },
    {
      title: "HRMS",
      items: [
        { to: "/hr/attendance", label: "My Attendance", end: true, show: can(user, "myAttendance") },
        { to: "/hr/leave/apply", label: "Leave Apply", show: can(user, "myLeave") || can(user, "leave", "add") },
        { to: "/hr/attendance/register", label: "Attendance Register", show: can(user, "attendance") },
        { to: "/hr/attendance/requests", label: "Attendance Requests", show: can(user, "attendanceRequests") },
        { to: "/hr/leave/list", label: "Leave List", show: can(user, "leave") },
        { to: "/hr/attendance/biometric", label: "Biometric Upload", show: can(user, "biometric", "add") },
        { to: "/hr/attendance/setup", label: "Shifts & Late Policy", show: can(user, "attendanceSetup") },
        { to: "/hr/leave/types", label: "Leave Types", show: can(user, "leaveTypes") },
        { to: "/hr/leave/policies", label: "Leave Policies", show: can(user, "leavePolicies") },
        { to: "/hr/leave/assignment", label: "Policy Assignment", show: can(user, "policyAssignment") },
      ],
    },
    {
      title: "Users & Org",
      items: [
        { to: "/users", label: "Users", show: can(user, "users") },
        { to: "/users/quick", label: "User List (Quick Edit)", show: can(user, "users", "edit") },
        { to: "/users/bulk", label: "Bulk Upload", show: can(user, "users", "add") },
        { to: "/org", label: "Branches & Departments", show: can(user, "org") },
        { to: "/users/leave", label: "Doer Leave", show: can(user, "doerLeave") },
        { to: "/users/access", label: "Access Overview", show: can(user, "accessOverview") },
      ],
    },
    {
      title: "Settings",
      items: [
        { to: "/calendar", label: "Working Calendar", show: can(user, "calendar") },
        { to: "/sheets", label: "Sheet Links", show: can(user, "sheetLinks", "edit") },
        { to: "/reminders", label: "Reminders", show: can(user, "reminders") },
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

// Phones: a tab bar at the bottom with the pages opened most (the first four of these the person may open), then the full menu
const QUICK: { to: string; label: string; icon: string; end?: boolean; show?: (u) => boolean }[] = [
  { to: "/", label: "Tasks", icon: "tasks", end: true },
  { to: "/dashboard", label: "Dashboard", icon: "grid" },
  { to: "/hr/attendance", label: "Attendance", icon: "clock", end: true, show: (u) => can(u, "myAttendance") },
  { to: "/jobs", label: "FMS", icon: "sheet", show: (u) => can(u, "fmsEntries") },
  { to: "/tickets/new", label: "Ticket", icon: "ticket", show: (u) => can(u, "myTickets") },
  { to: "/kra/me", label: "Scorecard", icon: "target" },
];
const ICONS = {
  tasks: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="m8 12.5 2.8 2.8L16.5 9" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  sheet: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M9.5 9.5v10" />
    </>
  ),
  ticket: <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
};
const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONS[name]}
  </svg>
);

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
  // The page's name in the top bar when the side menu is folded away (tablets, phones)
  const path = location.pathname;
  const here = groups
    .flatMap((g) => g.items)
    .filter((i) => i.to && (path === i.to || (i.to !== "/" && path.startsWith(i.to + "/"))))
    .sort((a, b) => b.to.length - a.to.length)[0];
  const pageTitle = here?.label || (path === "/account" ? "My account" : "FMS BSM");
  const quick = QUICK.filter((q) => !q.show || q.show(user)).slice(0, 4);
  const signOut = async () => {
    await logout();
    navigate("/login");
  };
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
        {/* phones: who is signed in, and Logout (the top bar has no room for it) */}
        <div className="side-foot">
          <NavLink to="/account" className="side-me">
            <b className="avatar">{initials(user.name)}</b>
            <span>
              {user.name}
              <small>{ROLE_LABELS[user.role] || user.role}</small>
            </span>
          </NavLink>
          <button type="button" className="btn ghost small" onClick={signOut}>
            Logout
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />

      <div className="main-col">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setOpen(!open)} aria-label="Menu">
            ☰
          </button>
          <div className="topbar-title">{pageTitle}</div>
          <div className="topbar-spacer" />
          <InstallApp />
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
          <button className="btn ghost small topbar-logout" onClick={signOut}>
            Logout
          </button>
        </header>
        <main className="page">
          <div key={location.pathname} className="page-anim">
          <Routes>
            <Route path="/" element={<MyTasks />} />
            <Route path="/account" element={<Account />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/mis/performance" element={guard(can(user, "performance"), <Performance />)} />
            <Route path="/reports/meeting" element={guard(can(user, "misMeeting"), <MeetingReport />)} />
            <Route path="/mis/weekly" element={guard(can(user, "weeklyMis"), <WeeklyMis />)} />
            <Route path="/fms/doer-conditions" element={guard(can(user, "doerConditions"), <FmsRules kind="doer" />)} />
            <Route path="/fms/override-tat" element={guard(can(user, "overrideTat"), <FmsRules kind="tat" />)} />
            <Route path="/fms/import-sheet" element={guard(can(user, "fmsImport", "add"), <SheetFmsImport />)} />
            <Route path="/fms/bulk" element={guard(can(user, "fmsBulk") || can(user, "fmsBulk", "delete"), <BulkFms />)} />
            <Route path="/fms/auto-complete" element={guard(can(user, "autoComplete"), <AutoComplete />)} />
            <Route path="/fms/auto-calculate" element={guard(can(user, "autoCalc"), <FmsRules kind="calc" />)} />
            <Route path="/audits" element={guard(can(user, "auditList") || Boolean(user.isAuditor), <AuditList />)} />
            <Route path="/audits/settings" element={guard(can(user, "auditorSettings", "edit"), <AuditorSettings />)} />
            <Route path="/reports/effort" element={guard(can(user, "effortReport"), <EffortReport />)} />
            <Route path="/reports/auditor" element={guard(can(user, "auditorReport"), <AuditorReport />)} />
            <Route path="/reports/fms-tasks" element={guard(can(user, "fmsTasks"), <FmsTasks />)} />
            <Route path="/reports/tasks" element={guard(can(user, "doerTasks"), <DoerTasks />)} />
            <Route path="/checklists" element={guard(can(user, "checklist"), <Checklists />)} />
            <Route path="/checklists/bulk" element={guard(can(user, "checklist", "add"), <ChecklistBulk />)} />
            <Route path="/delegations" element={<Delegations />} />
            <Route path="/jobs" element={guard(can(user, "fmsEntries"), <Jobs />)} />
            <Route path="/mis" element={guard(can(user, "misScore"), <Mis />)} />
            <Route path="/processes" element={guard(can(user, "fms"), <Processes />)} />
            <Route path="/processes/new" element={guard(can(user, "fms", "add"), <FmsBuilder />)} />
            <Route path="/processes/:id" element={guard(can(user, "fms", "edit"), <FmsBuilder />)} />
            <Route path="/calendar" element={guard(can(user, "calendar"), <CalendarSettings />)} />
            <Route path="/users" element={guard(can(user, "users"), <Users />)} />
            <Route path="/users/bulk" element={guard(can(user, "users", "add"), <BulkUsers />)} />
            <Route path="/users/quick" element={guard(can(user, "users", "edit"), <UsersQuickEdit />)} />
            <Route path="/kra/me" element={<KraScorecards mine />} />
            <Route path="/kra/scorecards" element={guard(can(user, "scorecards"), <KraScorecards />)} />
            <Route path="/kra/policies" element={guard(can(user, "kraPolicies"), <KraPolicies />)} />
            <Route path="/org" element={guard(can(user, "org"), <Org />)} />
            <Route path="/tickets/new" element={guard(can(user, "myTickets"), <RaiseTicket />)} />
            <Route path="/tickets/mine" element={guard(can(user, "myTickets"), <TicketList mode="mine" />)} />
            <Route path="/tickets" element={guard(can(user, "myTickets") || can(user, "tickets"), <TicketList mode="work" />)} />
            <Route path="/tickets/report" element={guard(can(user, "ticketReport"), <TicketReport />)} />
            <Route path="/tickets/categories" element={guard(can(user, "ticketSetup", "edit"), <TicketCategories />)} />
            <Route path="/hr/attendance" element={guard(can(user, "myAttendance"), <MyAttendance />)} />
            <Route path="/hr/attendance/register" element={guard(can(user, "attendance"), <AttendanceRegister />)} />
            <Route path="/hr/attendance/requests" element={guard(can(user, "attendanceRequests"), <AttendanceRequests />)} />
            <Route path="/hr/attendance/biometric" element={guard(can(user, "biometric", "add"), <BiometricUpload />)} />
            <Route path="/hr/attendance/setup" element={guard(can(user, "attendanceSetup"), <AttendanceSetup />)} />
            <Route path="/hr/leave/apply" element={guard(can(user, "myLeave") || can(user, "leave", "add"), <LeaveApply />)} />
            <Route path="/hr/leave/list" element={guard(can(user, "leave"), <LeaveList />)} />
            <Route path="/hr/leave/types" element={guard(can(user, "leaveTypes"), <LeaveTypes />)} />
            <Route path="/hr/leave/policies" element={guard(can(user, "leavePolicies"), <LeavePolicies />)} />
            <Route path="/hr/leave/assignment" element={guard(can(user, "policyAssignment"), <PolicyAssignment />)} />
            <Route path="/users/access" element={guard(can(user, "accessOverview"), <AccessOverview />)} />
            <Route path="/users/leave" element={guard(can(user, "doerLeave"), <Leaves />)} />
            <Route path="/sheets" element={guard(can(user, "sheetLinks", "edit"), <SheetLinks />)} />
            <Route path="/reminders" element={guard(can(user, "reminders"), <Reminders />)} />
            <Route path="/audit" element={guard(can(user, "audit"), <Audit />)} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
          </div>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Quick menu">
        {quick.map((q) => (
          <NavLink key={q.to} to={q.to} end={q.end} className="bn-item">
            <Icon name={q.icon} />
            <span>{q.label}</span>
          </NavLink>
        ))}
        <button type="button" className={"bn-item" + (open ? " active" : "")} onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name="menu" />
          <span>Menu</span>
        </button>
      </nav>
    </div>
  );
}

// Shown while the free server wakes up (see waitForServer in api.ts)
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
