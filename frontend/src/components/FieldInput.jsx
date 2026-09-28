import { useId } from "react";
import DoerSelect from "./DoerSelect";
import PhotoInput, { PhotoThumbs } from "./PhotoInput";
import { showDay, showDateTime } from "../api";

// datetime-local wants "YYYY-MM-DDTHH:mm" in local (IST) time
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// One input for a field definition (entry form and step form)
export default function FieldInput({ field, value, onChange, disabled }) {
  const listId = useId();
  const req = field.required;
  switch (field.type) {
    case "longtext":
      return <textarea rows={3} value={value || ""} onChange={(e) => onChange(e.target.value)} required={req} disabled={disabled} />;
    case "number":
      return <input type="number" step="any" value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={req} disabled={disabled} />;
    case "date":
      return <input type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} required={req} disabled={disabled} />;
    case "datetime":
      return (
        <input
          type="datetime-local"
          value={toLocalInput(value)}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : "")}
          required={req}
          disabled={disabled}
        />
      );
    case "select":
      return (
        <select value={value || ""} onChange={(e) => onChange(e.target.value)} required={req} disabled={disabled}>
          <option value="">—</option>
          {(field.options || []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    case "yesno":
      return (
        <div className="seg" role="radiogroup">
          {["Yes", "No"].map((o) => (
            <button type="button" key={o} className={value === o ? "active" : ""} onClick={() => onChange(value === o ? "" : o)} disabled={disabled} aria-pressed={value === o}>
              {o}
            </button>
          ))}
        </div>
      );
    case "user":
      return <DoerSelect value={value} onChange={onChange} placeholder="Choose person" required={req} />;
    case "link":
      return <input type="url" placeholder="https://…" value={value || ""} onChange={(e) => onChange(e.target.value)} required={req} disabled={disabled} />;
    case "photo":
      return <PhotoInput value={value} onChange={onChange} disabled={disabled} />;
    default:
      return (
        <>
          <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={req} disabled={disabled} list={field.options?.length ? listId : undefined} />
          {field.options?.length > 0 && (
            <datalist id={listId}>
              {field.options.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          )}
        </>
      );
  }
}

// A stored value, formatted for reading
export function FieldValue({ field, value, userName }) {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) return <span className="muted">—</span>;
  switch (field?.type) {
    case "date":
      return showDay(value);
    case "datetime":
      return showDateTime(value);
    case "photo":
      return <PhotoThumbs ids={Array.isArray(value) ? value : [value]} />;
    case "link":
      return (
        <a href={value} target="_blank" rel="noreferrer">
          Open link ↗
        </a>
      );
    case "user":
      return userName ? userName(value) : value;
    case "number":
      return Number(value).toLocaleString("en-IN");
    default:
      return String(value);
  }
}
