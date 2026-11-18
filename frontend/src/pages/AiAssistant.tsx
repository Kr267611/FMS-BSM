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
  const end = useRef<HTMLDivElement>(null);

  const loadChats = () => api("/ai/conversations").then(setChats).catch(() => {});
  useEffect(() => {
    api("/ai/status").then(setStatus).catch((e) => setError(e.message));
    loadChats();
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
          <b>AI abhi band hai.</b> Server pe (Render → Environment) Claude ke liye <code>ANTHROPIC_API_KEY</code>, ya free model ke liye <code>AI_PROVIDER</code> + <code>AI_API_KEY</code> + <code>AI_MODEL</code> lagana hai. Uske baad yahan sawaal pooch sakte ho.
          {!!status.problems?.length && (
            <ul className="ai-problems">
              {status.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
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
