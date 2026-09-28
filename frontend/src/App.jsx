import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, getToken, setToken } from "./api";
import Login from "./pages/Login";
import MyTasks from "./pages/MyTasks";
import Jobs from "./pages/Jobs";
import Processes from "./pages/Processes";
import SheetLinks from "./pages/SheetLinks";
import Mis from "./pages/Mis";
import Reminders from "./pages/Reminders";
import Users from "./pages/Users";
import Account from "./pages/Account";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) return setReady(true);
    api("/auth/me")
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <div className="center muted">Loading…</div>;

  const login = (token, u) => {
    setToken(token);
    setUser(u);
  };
  const logout = () => {
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
        <Route path="/*" element={user ? <Shell /> : <Navigate to="/login" />} />
      </Routes>
    </AuthContext.Provider>
  );
}

function Shell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = user.role === "admin";

  const links = [
    ["/", "My Tasks"],
    ["/jobs", "FMS / Jobs"],
    ["/mis", "MIS Score"],
    ...(isAdmin
      ? [
          ["/processes", "FMS Builder"],
          ["/sheets", "Sheet Links"],
          ["/reminders", "Reminders"],
          ["/users", "Users"],
        ]
      : []),
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <button className="menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
          ☰
        </button>
        <div className="brand">FMS BSM</div>
        <nav className={menuOpen ? "nav open" : "nav"} onClick={() => setMenuOpen(false)}>
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="who">
          <NavLink to="/account" className="who-name" title="My account">
            <b className="avatar">
              {user.name
                .split(/\s+/)
                .map((w) => w[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </b>
            <span>{user.name}</span>
          </NavLink>
          <button
            className="btn ghost small"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            Logout
          </button>
        </div>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<MyTasks />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/mis" element={<Mis />} />
          <Route path="/account" element={<Account />} />
          {isAdmin && (
            <>
              <Route path="/processes" element={<Processes />} />
              <Route path="/sheets" element={<SheetLinks />} />
              <Route path="/reminders" element={<Reminders />} />
              <Route path="/users" element={<Users />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
