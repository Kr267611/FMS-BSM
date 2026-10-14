import { useEffect, useMemo, useRef, useState } from "react";
import { api, isAdmin } from "../api";

let cache = null;
let loading = null; // one request for the whole page, however many selects ask at once

export function useUsers() {
  const [users, setUsers] = useState(cache || []);
  useEffect(() => {
    if (cache) return;
    loading ||= api("/users/list").then((u) => (cache = u)).finally(() => (loading = null));
    let alive = true;
    loading.then((u) => alive && setUsers(u)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return users;
}

export function clearUsersCache() {
  cache = null;
}

const labelOf = (u) => `${u.name}${u.department ? ` (${u.department})` : ""}`;
const SEARCH_FROM = 200; // with more people than this, type to find them instead of scrolling a long list
const SHOWN = 50;

export interface DoerSelectProps {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  required?: boolean;
  // only the people who audit (Auditor role, admins, "Make Auditor"); everyone when nobody is marked yet
  auditors?: boolean;
}

const canAudit = (u) => u.role === "auditor" || isAdmin(u) || u.isAuditor;

export default function DoerSelect({ value, onChange, placeholder = "Select doer", required, auditors }: DoerSelectProps) {
  const everyone = useUsers();
  const users = useMemo(() => {
    if (!auditors) return everyone;
    const list = everyone.filter((u) => canAudit(u) || u._id === value);
    return list.some((u) => !isAdmin(u) && canAudit(u)) ? list : everyone;
  }, [everyone, auditors, value]);
  if (users.length > SEARCH_FROM) return <PeopleSearch users={users} value={value} onChange={onChange} placeholder={placeholder} required={required} />;
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} required={required} aria-label={placeholder}>
      <option value="">{placeholder}</option>
      {users.map((u) => (
        <option key={u._id} value={u._id}>
          {labelOf(u)}
        </option>
      ))}
    </select>
  );
}

// Type a name or department; the first matches show, Enter or a click picks one
function PeopleSearch({ users, value, onChange, placeholder, required }: DoerSelectProps & { users: any[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const current = users.find((u) => u._id === value);
  const matches = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = words.length ? users.filter((u) => words.every((w) => labelOf(u).toLowerCase().includes(w))) : users;
    return list.slice(0, SHOWN);
  }, [q, users]);

  function pick(u) {
    onChange(u ? u._id : "");
    setOpen(false);
    setQ("");
  }
  function onKey(e) {
    if (e.key === "ArrowDown") (e.preventDefault(), setOpen(true), setActive((a) => Math.min(a + 1, matches.length - 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
    else if (e.key === "Enter" && open) (e.preventDefault(), matches[active] && pick(matches[active]));
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div className="people-search" ref={box}>
      <input
        role="combobox"
        aria-expanded={open}
        aria-label={placeholder}
        value={open ? q : current ? labelOf(current) : ""}
        placeholder={current ? labelOf(current) : placeholder}
        onFocus={() => (setOpen(true), setQ(""), setActive(0))}
        onChange={(e) => (setQ(e.target.value), setActive(0), setOpen(true))}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
        required={required && !value}
      />
      {open && (
        <ul className="people-search-list" role="listbox">
          {!required && (
            <li role="option" aria-selected={!value} className="muted" onMouseDown={() => pick(null)}>
              {placeholder}
            </li>
          )}
          {matches.map((u, i) => (
            <li key={u._id} role="option" aria-selected={u._id === value} className={i === active ? "active" : ""} onMouseDown={() => pick(u)} onMouseEnter={() => setActive(i)}>
              {u.name}
              {u.department && <span className="muted small"> · {u.department}</span>}
            </li>
          ))}
          {!matches.length && <li className="muted small">No one matches “{q}”</li>}
          {matches.length === SHOWN && <li className="muted small">Type more to narrow the list</li>}
        </ul>
      )}
    </div>
  );
}
