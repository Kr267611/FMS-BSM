import { useRef, useState } from "react";
import { api } from "../api";

// Shrink a phone photo to at most 1600 px and ~0.3 MB before upload
async function compress(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("This file is not an image"));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.75);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PhotoThumbs({ ids = [], onRemove }) {
  if (!ids.length) return null;
  return (
    <div className="thumbs">
      {ids.map((id) => (
        <span key={id} className="thumb">
          <a href={`/api/files/${id}`} target="_blank" rel="noreferrer" title="Open photo">
            <img src={`/api/files/${id}`} alt="" loading="lazy" />
          </a>
          {onRemove && (
            <button type="button" className="thumb-x" onClick={() => onRemove(id)} aria-label="Remove photo">
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

export default function PhotoInput({ value, onChange, max = 6, disabled }) {
  const ids = Array.isArray(value) ? value : value ? [value] : [];
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add(e) {
    const files = [...(e.target.files || [])].slice(0, max - ids.length);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      const added = [];
      for (const f of files) {
        const data = await compress(f);
        const r = await api("/files", { method: "POST", body: { data, name: f.name } });
        added.push(r.id);
      }
      onChange([...ids, ...added]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="photo-input">
      <PhotoThumbs ids={ids} onRemove={disabled ? null : (id) => onChange(ids.filter((x) => x !== id))} />
      {ids.length < max && !disabled && (
        <button type="button" className="btn ghost small" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : ids.length ? "+ Another photo" : "📷 Add photo"}
        </button>
      )}
      <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden onChange={add} />
      {error && <div className="error small">{error}</div>}
    </div>
  );
}
