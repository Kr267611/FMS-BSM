import { useEffect, useState } from "react";

// "1:30" <-> 90 minutes. Also takes plain minutes ("45") or hours with a dot ("1.5").
export const toHM = (min) => (min ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}` : "");
export function parseHM(text) {
  const s = String(text || "").trim();
  if (!s) return 0;
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  if (/^\d+(\.\d+)?$/.test(s)) return s.includes(".") ? Math.round(Number(s) * 60) : Number(s);
  return null;
}

// MIDAP "effort time": how long a task's work takes, typed as H:MM
export default function EffortInput({ value, onChange }) {
  const [text, setText] = useState(toHM(value));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(toHM(value)), [value]);
  return (
    <input
      value={text}
      placeholder="H:MM, e.g. 0:30"
      className={bad ? "bad-input" : ""}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const m = parseHM(text);
        setBad(m === null);
        if (m !== null) onChange(Math.min(24 * 60, m));
      }}
    />
  );
}
