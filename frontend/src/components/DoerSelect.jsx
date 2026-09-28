import { useEffect, useState } from "react";
import { api } from "../api";

let cache = null;

export function useUsers() {
  const [users, setUsers] = useState(cache || []);
  useEffect(() => {
    if (cache) return;
    api("/users/list").then((u) => {
      cache = u;
      setUsers(u);
    });
  }, []);
  return users;
}

export function clearUsersCache() {
  cache = null;
}

export default function DoerSelect({ value, onChange, placeholder = "Select doer", required }) {
  const users = useUsers();
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} required={required}>
      <option value="">{placeholder}</option>
      {users.map((u) => (
        <option key={u._id} value={u._id}>
          {u.name}
          {u.department ? ` (${u.department})` : ""}
        </option>
      ))}
    </select>
  );
}
