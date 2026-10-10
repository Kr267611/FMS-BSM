import { useEffect, useState } from "react";
import { api } from "../api";

// The service account email every FMS sheet is shared with (Viewer), with a copy button
export default function ShareWith({ email: given }) {
  const [email, setEmail] = useState(given || "");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (given) return setEmail(given);
    api("/sheets").then((d) => setEmail(d.serviceAccountEmail || "")).catch(() => {});
  }, [given]);
  if (!email) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the email stays selectable */
    }
  }
  return (
    <div className="notice share-with">
      <div>
        Before reading a sheet, open it in Google Sheets → <b>Share</b> → add this email as <b>Viewer</b> (untick “Notify people”):
      </div>
      <div className="row">
        <code>{email}</code>
        <button type="button" className="btn ghost small" onClick={copy}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <div className="muted small">Viewer = the software can only read the sheet, never change it. Do this once per sheet.</div>
    </div>
  );
}
