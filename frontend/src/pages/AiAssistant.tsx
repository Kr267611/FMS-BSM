import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import Markdown from "../components/Markdown";
import { useVoice, voiceSupported } from "../voice";

// AI Assistant: questions about the app's data, Google Sheets and company documents, in any language. It only reads –
// the server's tools see what the signed-in user may see, and in Google what their own connected account sees.
const STEP_LABEL = {
  find_people: "People",
  mis_scores: "MIS scores",
  list_tasks: "Tasks",
  fms_overview: "FMS overview",
  find_entries: "FMS entries",
  entry_detail: "Entry details",
  sheet_tabs: "Sheet tabs",
  sheet_describe_fms: "Sheet structure",
  sheet_read: "Sheet data",
  sheet_formulas: "Sheet formulas",
  sheet_find_rows: "Sheet search",
  sheet_fms_score: "Sheet FMS score",
  sheet_fms_health: "Sheet health check",
  drive_search: "Drive search",
  drive_list_folder: "Drive folder",
  drive_read: "Drive document",
  search_knowledge: "Knowledge base",
};
// "<link>" suggestions go into the box to be completed; the others are asked straight away
const SUGGESTIONS = [
  "Which tasks are overdue today?",
  "Who has the lowest MIS score this month?",
  "Which FMS has the most pending steps?",
  "Show the tasks completed late last week",
  "Summarise this Google Sheet: <link>",
  "Check this FMS sheet for problems: <link>",
  "MIS score of this FMS sheet this month: <link>",
];
// voice typing language, remembered on this device
const VOICE_LANG_KEY = "fms_ai_voice_lang";
const VOICE_LANGS = { "hi-IN": { short: "HI", name: "Hindi" }, "en-IN": { short: "EN", name: "English" } };
function savedVoiceLang(): string {
  try {
    const v = localStorage.getItem(VOICE_LANG_KEY);
    return v && VOICE_LANGS[v] ? v : "hi-IN";
  } catch {
    return "hi-IN";
  }
}
const istDate = (d) => new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

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
  const box = useRef<HTMLTextAreaElement>(null);
  // voice: the spoken words go after what was already typed, and stay in the box until Send
  const [canSpeak] = useState(voiceSupported);
  const [voiceLang, setVoiceLang] = useState(savedVoiceLang);
  const typedBefore = useRef("");
  const voice = useVoice((spoken) => setText((typedBefore.current ? `${typedBefore.current} ${spoken}` : spoken).slice(0, 4000)));

  function toggleMic() {
    if (voice.listening) return voice.stop();
    setError("");
    typedBefore.current = text.trim();
    voice.start(voiceLang);
  }

  function switchVoiceLang() {
    const next = voiceLang === "hi-IN" ? "en-IN" : "hi-IN";
    setVoiceLang(next);
    voice.clearError();
    try {
      localStorage.setItem(VOICE_LANG_KEY, next);
    } catch {
      /* private window: the choice lasts until the page closes */
    }
  }

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
        g === "connected"
          ? "Google account connected. The assistant can now read your Drive and Sheets (read-only)."
          : g === "denied"
            ? "Google access was not granted. You can connect at any time."
            : g === "off"
              ? "Google sign-in is not set up on the server yet."
              : `Could not connect Google: ${why || "please try again."}`
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
    if (!window.confirm("Delete this conversation?")) return;
    await api(`/ai/conversations/${id}`, { method: "DELETE" }).catch((e) => setError(e.message));
    if (id === chatId) newChat();
    loadChats();
  }

  async function disconnectGoogle() {
    if (!window.confirm("Disconnect your Google account? The assistant will no longer be able to read your Drive and Sheets.")) return;
    try {
      await api("/ai/google", { method: "DELETE" });
      setGoogleNote("Google account disconnected.");
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
      setKbNote(`${r.indexed} new or changed · ${r.skipped} unchanged · ${r.removed} removed${r.failed ? ` · ${r.failed} could not be read` : ""}${problems ? ` · Issues: ${problems}` : ""}`);
      setKb(await api("/ai/knowledge"));
    } catch (e) {
      setKbNote(e.message);
    } finally {
      setKbBusy(false);
    }
  }

  function suggest(s: string) {
    if (!s.includes("<link>")) return send(s);
    setText(s.replace("<link>", ""));
    box.current?.focus();
  }

  async function send(question = text) {
    const q = question.trim();
    if (!q || busy) return;
    voice.cancel(); // late words must not refill the box after it is sent
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

  const sources = (steps: Turn["steps"]) => [...new Set(steps.filter((s) => s.ok).map((s) => STEP_LABEL[s.tool] || s.tool))];

  return (
    <div className="ai-page">
      <div className="page-head">
        <h2>AI Assistant</h2>
        <div className="row">
          <button className="btn ghost small ai-list-toggle" onClick={() => setShowList(!showList)}>
            History ({chats.length})
          </button>
          <button className="btn small" onClick={newChat}>
            + New chat
          </button>
        </div>
      </div>

      {status && !status.enabled && (
        <div className="card ai-off">
          <b>The AI Assistant is not configured.</b>{" "}
          {status.admin ? (
            <>
              In Render → Environment, set <code>ANTHROPIC_API_KEY</code> for Claude, or <code>AI_PROVIDER</code> + <code>AI_API_KEY</code> + <code>AI_MODEL</code> for a free model.
            </>
          ) : (
            "Please contact your administrator."
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
              <b>Google Drive &amp; Sheets:</b>{" "}
              {status.google.connected ? (
                <>
                  Connected as <span className="ai-ok">{status.google.email}</span> – the assistant reads only what this account can see (read-only).
                </>
              ) : status.google.configured ? (
                status.google.fallback === "service" ? (
                  "Not connected. The assistant can read only files shared with the app. Connect your Google account to give it read-only access to your Drive and Sheets."
                ) : (
                  "Not connected. Connect your Google account to let the assistant read your Drive and Sheets (read-only)."
                )
              ) : (
                <span className="muted">Google sign-in is not set up on the server yet.</span>
              )}
            </div>
            {status.google.configured &&
              (status.google.connected ? (
                <button className="btn ghost small" onClick={disconnectGoogle}>
                  Disconnect
                </button>
              ) : (
                // a normal link: the browser goes to Google's sign-in page and comes back here
                <a className="btn small" href="/api/ai/google/connect">
                  Connect Google
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
          {status.admin && !!status.google.blocked?.length && (
            <p className="muted small ai-kb-note">Never visible to the assistant: files and tabs whose name contains "{status.google.blocked.join('", "')}".</p>
          )}
        </div>
      )}

      {kb && (
        <div className="card ai-kb">
          <div className="row between wrap">
            <div>
              <b>Knowledge base:</b> {kb.sources} documents · {kb.driveFiles} Google Drive files · {kb.chunks} sections
              {kb.lastIndexed && <span className="muted small"> · updated {istDate(kb.lastIndexed)}</span>}
              {kb.embedModel === "off" && <span className="muted small"> · keyword search only</span>}
            </div>
            {status?.admin && (
              <button className="btn ghost small" onClick={updateKnowledge} disabled={kbBusy}>
                {kbBusy ? "Refreshing…" : "Refresh"}
              </button>
            )}
          </div>
          {kbNote && <p className="small ai-kb-note">{kbNote}</p>}
          {!!kb.errors?.length && (
            <details className="small ai-kb-errors">
              <summary>{kb.errors.length} file(s) could not be read</summary>
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
          {!chats.length && <p className="muted small">No conversations yet.</p>}
          {chats.map((c) => (
            <div key={c._id} className={`ai-chat-item${c._id === chatId ? " active" : ""}`}>
              <button className="ai-chat-title" onClick={() => open(c._id)} title={c.title}>
                {c.title || "Conversation"}
              </button>
              <button className="ai-chat-del" onClick={() => remove(c._id)} aria-label="Delete conversation">
                ×
              </button>
            </div>
          ))}
        </aside>

        <section className="card ai-main">
          <div className="ai-messages">
            {!turns.length && (
              <div className="ai-empty">
                <p>Ask about tasks, MIS scores, FMS entries, Google Sheets or company documents – in any language. The assistant only reads data; it never changes anything.</p>
                <div className="ai-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="btn ghost small" disabled={!status?.enabled || busy} onClick={() => suggest(s)}>
                      {s.replace(": <link>", "…")}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`ai-msg ${t.role}`}>
                {t.role === "assistant" ? (
                  <div className="ai-bubble ai-answer">
                    <Markdown text={t.text} />
                  </div>
                ) : (
                  <div className="ai-bubble">{t.text}</div>
                )}
                {t.role === "assistant" && !!t.steps?.length && (
                  <div className="ai-sources">
                    {!!sources(t.steps).length && <>Based on: {sources(t.steps).join(" · ")}</>}
                    {t.steps.some((s) => !s.ok) && <span className="ai-source-bad"> · some data could not be read</span>}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="ai-msg assistant">
                <div className="ai-bubble ai-thinking" role="status" aria-label="Working on your request">
                  <span className="ai-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              </div>
            )}
            <div ref={end} />
          </div>

          {error && <div className="error">{error}</div>}
          {voice.error && <div className="error">{voice.error}</div>}
          <form
            className="ai-input"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              ref={box}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                voice.listening
                  ? `Listening (${VOICE_LANGS[voiceLang].name})… speak now, then press the mic again`
                  : status?.enabled
                    ? "Ask a question… (Enter to send, Shift+Enter for a new line)"
                    : "The assistant is not available"
              }
              rows={2}
              maxLength={4000}
              disabled={!status?.enabled || busy}
              // while listening the box shows the words as they come; stop the mic to edit them
              readOnly={voice.listening}
            />
            {canSpeak && (
              <>
                <button
                  type="button"
                  className="btn ghost ai-lang"
                  onClick={switchVoiceLang}
                  disabled={voice.listening}
                  title={`Voice language: ${VOICE_LANGS[voiceLang].name} – click to switch`}
                  aria-label={`Voice language ${VOICE_LANGS[voiceLang].name}, click to switch`}
                >
                  {VOICE_LANGS[voiceLang].short}
                </button>
                <button
                  type="button"
                  className={`btn ghost ai-mic${voice.listening ? " on" : ""}`}
                  onClick={toggleMic}
                  disabled={!status?.enabled || busy}
                  aria-pressed={voice.listening}
                  aria-label={voice.listening ? "Stop listening" : "Speak your question"}
                  title={voice.listening ? "Stop listening" : "Speak your question"}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8" />
                  </svg>
                </button>
              </>
            )}
            <button className="btn primary" disabled={!status?.enabled || busy || !text.trim()}>
              Send
            </button>
          </form>
          {status?.enabled && (
            <p className="muted small ai-foot">
              {status.usedToday || 0} of {status.dailyLimit} questions used today · The assistant can make mistakes – verify important figures in the app.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
