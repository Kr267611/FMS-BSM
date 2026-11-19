import { useEffect, useRef, useState } from "react";
import { api } from "../api";

// AI Assistant (admins only for now): asks the app's data in plain Hinglish. It only reads – the server's tools
// see what the signed-in user may see, and nothing is changed.
const STEP_LABEL = {
  find_people: "Log khoje",
  mis_scores: "MIS dekha",
  list_tasks: "Tasks dekhe",
  fms_overview: "FMS ka haal dekha",
  find_entries: "Entries khoji",
  entry_detail: "Entry kholi",
  sheet_tabs: "Sheet ke tabs dekhe",
  sheet_describe_fms: "Sheet ka FMS samjha",
  sheet_read: "Sheet padhi",
  sheet_formulas: "Formulas dekhe",
  sheet_find_rows: "Sheet me rows khoji",
  drive_search: "Drive me khoja",
  drive_list_folder: "Folder dekha",
  drive_read: "File padhi",
  search_knowledge: "Gyaan me khoja",
};
const SUGGESTIONS = [
  "Aaj kaun-kaun se kaam overdue hain?",
  "Is mahine sabse kharab MIS score kiska hai?",
  "Kaunse FMS me sabse zyada steps atke hain?",
  "Pichhle hafte late hue kaam dikhao",
  "Is Google Sheet ke tabs dikhao: <link>",
];

type Turn = { role: "user" | "assistant"; text: string; steps?: { tool: string; ok: boolean }[] };

export default function AiAssistant() {
  const [status, setStatus] = useState<any>(null);
  const [chats, setChats] = useState<any[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showList, setShowList] = useState(false);
  const [kb, setKb] = useState<any>(null);
  const [kbBusy, setKbBusy] = useState(false);
  const [kbNote, setKbNote] = useState("");
  const [googleNote, setGoogleNote] = useState("");
  const end = useRef<HTMLDivElement>(null);

  const loadChats = () => api("/ai/conversations").then(setChats).catch(() => {});
  const loadStatus = () => api("/ai/status").then(setStatus).catch((e) => setError(e.message));
  useEffect(() => {
    loadStatus();
    api("/ai/knowledge").then(setKb).catch(() => {});
    loadChats();
    // back from Google's sign-in page: say how it went, then clean the address bar
    const q = new URLSearchParams(window.location.search);
    const g = q.get("google");
    if (g) {
      const why = q.get("why");
      setGoogleNote(
        g === "connected" ? "Google jud gaya ✓ Ab AI tumhari Drive aur Sheets padh sakta hai (sirf padhna)." : g === "denied" ? "Google pe Allow nahi kiya gaya – jab chaho dobara jodo." : g === "off" ? "Google login abhi server pe set nahi hai." : `Google nahi juda: ${why || "dobara try karo"}`
      );
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  // braces: newer browsers return a Promise from scrollIntoView, and an effect must not return one
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function open(id: string) {
    setError("");
    setShowList(false);
    try {
      const c = await api(`/ai/conversations/${id}`);
      setChatId(id);
      setTurns(c.turns);
    } catch (e) {
      setError(e.message);
    }
  }

  function newChat() {
    setChatId(null);
    setTurns([]);
    setError("");
    setShowList(false);
  }

  async function remove(id: string) {
    if (!window.confirm("Ye chat delete karein?")) return;
    await api(`/ai/conversations/${id}`, { method: "DELETE" }).catch((e) => setError(e.message));
    if (id === chatId) newChat();
    loadChats();
  }

  async function disconnectGoogle() {
    if (!window.confirm("Google ka connection hatayein? AI tumhari Drive / Sheets padhna band kar dega.")) return;
    try {
      await api("/ai/google", { method: "DELETE" });
      setGoogleNote("Google hata diya. AI ab tumhari Drive nahi padhega.");
      loadStatus();
    } catch (e) {
      setGoogleNote(e.message);
    }
  }

  // Knowledge (RAG): re-read changed Drive files and the app's own text
  async function updateKnowledge() {
    setKbBusy(true);
    setKbNote("");
    try {
      const r = await api("/ai/knowledge/reindex", { method: "POST" });
      const problems = (r.errors || []).slice(0, 3).join(" · ");
      setKbNote(`${r.indexed} naye/badle, ${r.skipped} same, ${r.removed} hataye${r.failed ? `, ${r.failed} nahi padh paye` : ""}${problems ? ` · Dikkat: ${problems}` : ""}`);
      setKb(await api("/ai/knowledge"));
    } catch (e) {
      setKbNote(e.message);
    } finally {
      setKbBusy(false);
    }
  }

  async function send(question = text) {
    const q = question.trim();
    if (!q || busy) return;
    setError("");
    setBusy(true);
    setText("");
    setTurns((t) => [...t, { role: "user", text: q }]);
    try {
      const r = await api("/ai/chat", { method: "POST", body: { conversationId: chatId, message: q } });
      setChatId(r.conversationId);
      setTurns((t) => [...t, { role: "assistant", text: r.reply, steps: r.steps }]);
      setStatus((s) => (s ? { ...s, usedToday: (s.usedToday || 0) + 1 } : s));
      if (!chatId) loadChats();
    } catch (e) {
      setError(e.message);
      setTurns((t) => t.slice(0, -1));
      setText(q);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-page">
      <div className="page-head">
        <h2>AI Assistant</h2>
        <div className="row">
          <button className="btn ghost small ai-list-toggle" onClick={() => setShowList(!showList)}>
            Purani chats ({chats.length})
          </button>
          <button className="btn small" onClick={newChat}>
            + Nayi chat
          </button>
        </div>
      </div>

      {status && !status.enabled && (
        <div className="card ai-off">
          <b>AI abhi band hai.</b>{" "}
          {status.admin ? (
            <>
              Server pe (Render → Environment) Claude ke liye <code>ANTHROPIC_API_KEY</code>, ya free model ke liye <code>AI_PROVIDER</code> + <code>AI_API_KEY</code> + <code>AI_MODEL</code> lagana hai. Uske baad yahan sawaal pooch sakte ho.
            </>
          ) : (
            "Admin se bolo – server pe AI ki setting baaki hai."
          )}
          {!!status.problems?.length && (
            <ul className="ai-problems">
              {status.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {status?.google && (status.google.configured || status.admin) && (
        <div className="card ai-kb">
          <div className="row between wrap">
            <div>
              <b>Google Drive / Sheets:</b>{" "}
              {status.google.connected ? (
                <>
                  <span className="ai-ok">✓ {status.google.email}</span> se juda – AI wahi padhta hai jo is account ko dikhta hai (sirf padhna).
                </>
              ) : status.google.configured ? (
                status.google.fallback === "service" ? (
                  "Juda nahi – abhi AI sirf app ke saath share ki gayi files padhta hai. Apna Google jodo to poori Drive padh sakega."
                ) : (
                  "Juda nahi – apna Google account jodo, tab AI tumhari Drive aur Sheets padh sakega."
                )
              ) : (
                <span className="muted">Google login abhi server pe set nahi hai.</span>
              )}
            </div>
            {status.google.configured &&
              (status.google.connected ? (
                <button className="btn ghost small" onClick={disconnectGoogle}>
                  Hatao
                </button>
              ) : (
                // a normal link: the browser goes to Google's sign-in page and comes back here
                <a className="btn small" href="/api/ai/google/connect">
                  Google jodo
                </a>
              ))}
          </div>
          {googleNote && <p className="small ai-kb-note">{googleNote}</p>}
          {status.admin && !!status.google.problems?.length && (
            <ul className="ai-problems">
              {status.google.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {status.admin && !!status.google.blocked?.length && <p className="muted small ai-kb-note">AI ko kabhi nahi dikhega: naam me "{status.google.blocked.join('", "')}" wali files / tabs.</p>}
        </div>
      )}

      {kb && (
        <div className="card ai-kb">
          <div className="row between wrap">
            <div>
              <b>Gyaan (Knowledge):</b> {kb.sources} documents · {kb.driveFiles} Google Drive files · {kb.chunks} tukde
              {kb.lastIndexed && <span className="muted small"> · update {new Date(kb.lastIndexed).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}</span>}
              {kb.embedModel === "off" && <span className="muted small"> · sirf keyword search</span>}
            </div>
            {status?.admin && (
              <button className="btn ghost small" onClick={updateKnowledge} disabled={kbBusy}>
                {kbBusy ? "Padh raha hoon…" : "Update karo"}
              </button>
            )}
          </div>
          {kbNote && <p className="small ai-kb-note">{kbNote}</p>}
          {!!kb.errors?.length && (
            <details className="small ai-kb-errors">
              <summary>{kb.errors.length} file(s) me dikkat</summary>
              <ul>
                {kb.errors.map((e, i) => (
                  <li key={i}>
                    {e.title}: {e.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="ai-layout">
        <aside className={`card ai-chats${showList ? " open" : ""}`}>
          {!chats.length && <p className="muted small">Abhi koi chat nahi.</p>}
          {chats.map((c) => (
            <div key={c._id} className={`ai-chat-item${c._id === chatId ? " active" : ""}`}>
              <button className="ai-chat-title" onClick={() => open(c._id)} title={c.title}>
                {c.title || "Chat"}
              </button>
              <button className="ai-chat-del" onClick={() => remove(c._id)} aria-label="Delete chat">
                ×
              </button>
            </div>
          ))}
        </aside>

        <section className="card ai-main">
          <div className="ai-messages">
            {!turns.length && (
              <div className="ai-empty">
                <p>
                  Company ke kaam ke baare me Hinglish me poochho. AI sirf <b>padhta</b> hai – kuch badalta nahi.
                </p>
                <div className="ai-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="btn ghost small" disabled={!status?.enabled || busy} onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`ai-msg ${t.role}`}>
                {!!t.steps?.length && (
                  <div className="ai-steps">
                    {t.steps.map((s, j) => (
                      <span key={j} className={`ai-step${s.ok ? "" : " bad"}`}>
                        {s.ok ? "✓" : "!"} {STEP_LABEL[s.tool] || s.tool}
                      </span>
                    ))}
                  </div>
                )}
                <div className="ai-bubble">{t.text}</div>
              </div>
            ))}
            {busy && (
              <div className="ai-msg assistant">
                <div className="ai-bubble ai-thinking">Soch raha hoon, data dekh raha hoon…</div>
              </div>
            )}
            <div ref={end} />
          </div>

          {error && <div className="error">{error}</div>}
          <form
            className="ai-input"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={status?.enabled ? "Sawaal likho… (Enter = bhejo)" : "AI band hai"}
              rows={2}
              maxLength={4000}
              disabled={!status?.enabled || busy}
            />
            <button className="btn primary" disabled={!status?.enabled || busy || !text.trim()}>
              Bhejo
            </button>
          </form>
          {status?.enabled && (
            <p className="muted small ai-foot">
              Aaj {status.usedToday || 0} / {status.dailyLimit} sawaal · AI galti kar sakta hai – zaroori number app me check kar lo.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
