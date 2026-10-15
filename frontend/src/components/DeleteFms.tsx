import { useEffect, useState } from "react";
import { api } from "../api";

// Delete an FMS (Master FMS list or the FMS itself): its entries count, a backup download, type DELETE.
// startOpen: shown open (the list opens it from its own Delete button); onCancel: closing it again.
export default function DeleteFms({ id, name, onDeleted, startOpen = false, onCancel }: { id: string; name: string; onDeleted: () => void; startOpen?: boolean; onCancel?: () => void }) {
  const [open, setOpen] = useState(startOpen);
  const [count, setCount] = useState(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) api("/jobs/count", { query: { process: id } }).then((r) => setCount(r.count)).catch(() => setCount(null));
  }, [open, id]);

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api(`/processes/${id}`, { method: "DELETE", body: { confirm } });
      onDeleted();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="danger-zone">
        <button type="button" className="btn ghost small danger" onClick={() => setOpen(true)}>
          Delete this FMS…
        </button>
      </div>
    );
  }
  return (
    <div className="card danger-zone open">
      <h3>Delete “{name}”</h3>
      <p>
        This removes the FMS from the software with <b>{count === null ? "…" : count} entr{count === 1 ? "y" : "ies"}</b>, all their steps, and its Auto
        Complete and reminder rules. Their scores leave the MIS. It cannot be undone.
      </p>
      <p className="muted small">Only the software's data is deleted. A Google Sheet this FMS was imported from is not changed.</p>
      {count > 0 && (
        <p>
          <a className="btn ghost small" href={`/api/jobs/export?process=${id}`}>
            Download a backup first (CSV)
          </a>
        </p>
      )}
      <div className="row wrap">
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          placeholder="Type DELETE to confirm"
          aria-label="Type DELETE to confirm"
        />
        <button type="button" className="btn primary danger-fill" disabled={confirm !== "DELETE" || busy} onClick={remove}>
          {busy ? "Deleting…" : "Delete FMS"}
        </button>
        <button type="button" className="btn ghost" onClick={() => (setOpen(false), setConfirm(""), onCancel?.())}>
          Cancel
        </button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
