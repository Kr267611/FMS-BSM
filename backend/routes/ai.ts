import express = require("express");
import authLib = require("../middleware/auth");
const { auth, adminOnly, permit } = authLib;
import AiConversation = require("../models/AiConversation");
import agent = require("../services/ai/agent");
import knowledge = require("../services/ai/knowledge");
import googleAccess = require("../services/ai/googleAccess");
import permissionsLib = require("../services/permissions");
const { isAdmin } = permissionsLib;
import auditLib = require("../services/audit");
const { audit } = auditLib;

// AI assistant – for admins and the people an admin gives the "AI Assistant" tick (Users → Access).
// It only reads (see services/ai/tools.ts): in the app what the person may see, in Google what their own account sees.
const router = express.Router();
router.use(auth, permit("ai", "view"));

const DAILY_LIMIT = () => Number(process.env.AI_DAILY_LIMIT) || 200;
const MAX_TURNS = 40; // questions per conversation; then start a new one (keeps each request small)
const asked = new Map<string, { day: string; n: number }>();
const busy = new Set<string>();

function countToday(userId: string) {
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const c = asked.get(userId);
  const n = c && c.day === day ? c.n : 0;
  return { day, n };
}

const isId = (s) => /^[0-9a-f]{24}$/i.test(String(s || ""));

router.get("/status", async (req, res) => {
  // which model runs is not shown to users; it is kept in each saved answer and in the audit log
  const admin = isAdmin(req.user);
  res.json({
    enabled: agent.enabled(),
    problems: admin ? agent.setupProblems() : [],
    admin,
    dailyLimit: DAILY_LIMIT(),
    usedToday: countToday(String(req.user._id)).n,
    google: await googleAccess.status(req.user),
  });
});

// ---------- the person's own Google account (read-only Drive + Sheets for the AI) ----------

const back = (res, result: string, why = "") => res.redirect(302, `/ai?google=${result}${why ? `&why=${encodeURIComponent(why.slice(0, 200))}` : ""}`);

// A normal link (not a fetch): the session cookie comes along, then Google's sign-in page
router.get("/google/connect", (req, res) => {
  if (!googleAccess.configured()) return back(res, "off");
  res.redirect(302, googleAccess.authUrl(req.user));
});

// Google sends the person back here; the state must be the one this same person started
router.get("/google/callback", async (req, res) => {
  if (req.query.error) return back(res, "denied");
  try {
    const { email } = await googleAccess.finish(req.user, { code: req.query.code, state: req.query.state });
    audit(req, "ai.google_connect", { entity: "GoogleConnection", summary: `Connected Google account ${email} (read-only)` });
    back(res, "connected");
  } catch (err) {
    back(res, "failed", /^(The|Drive|Google|Only)\b/.test(err?.message || "") ? err.message : "Google sign-in failed – try again");
  }
});

router.delete("/google", async (req, res) => {
  const r = await googleAccess.disconnect(req.user);
  if (r.removed) audit(req, "ai.google_disconnect", { entity: "GoogleConnection", summary: "Removed the Google connection" });
  res.json({ ok: true });
});

// Knowledge (RAG): what is indexed, and a button (admins) to bring it up to date (Drive + the app's own text)
router.get("/knowledge", async (req, res) => res.json(await knowledge.stats()));
router.post("/knowledge/reindex", adminOnly, async (req, res) => {
  const result = await knowledge.reindex();
  audit(req, "ai.knowledge_reindex", { entity: "Knowledge", summary: `${result.indexed} indexed, ${result.skipped} unchanged, ${result.removed} removed, ${result.failed} failed` });
  res.json(result);
});

router.get("/conversations", async (req, res) => {
  const list = await AiConversation.find({ user: req.user._id }).select("title updatedAt").sort({ updatedAt: -1 }).limit(50).lean();
  res.json(list);
});

router.get("/conversations/:id", async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ message: "Conversation not found" });
  const c: any = await AiConversation.findOne({ _id: req.params.id, user: req.user._id }).select("title turns updatedAt").lean();
  if (!c) return res.status(404).json({ message: "Conversation not found" });
  res.json({ ...c, turns: c.turns.map(({ servedBy, ...t }) => t) });
});

router.delete("/conversations/:id", async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ message: "Conversation not found" });
  const r = await AiConversation.deleteOne({ _id: req.params.id, user: req.user._id });
  if (!r.deletedCount) return res.status(404).json({ message: "Conversation not found" });
  res.json({ ok: true });
});

router.post("/chat", async (req, res) => {
  if (!agent.enabled()) return res.status(503).json({ message: "AI is off: set ANTHROPIC_API_KEY, or AI_PROVIDER + AI_API_KEY + AI_MODEL for a free model, on the server (Render → Environment)." });
  const question = String(req.body?.message || "").trim();
  if (!question) return res.status(400).json({ message: "Type a question" });
  if (question.length > 4000) return res.status(400).json({ message: "Question is too long (max 4000 characters)" });
  const userId = String(req.user._id);
  const today = countToday(userId);
  if (today.n >= DAILY_LIMIT()) return res.status(429).json({ message: `Today's limit of ${DAILY_LIMIT()} questions is used up. Try again tomorrow.` });

  let convo;
  if (req.body?.conversationId) {
    if (!isId(req.body.conversationId)) return res.status(404).json({ message: "Conversation not found" });
    convo = await AiConversation.findOne({ _id: req.body.conversationId, user: req.user._id });
    if (!convo) return res.status(404).json({ message: "Conversation not found" });
    if (convo.turns.filter((t) => t.role === "user").length >= MAX_TURNS) return res.status(400).json({ message: "This chat is long – start a new chat" });
    // a chat keeps the message format of its kind of model: Claude, or the OpenAI-compatible chain (any of its models)
    const familyOf = (p) => (!p || p === "anthropic" ? "anthropic" : "openai");
    if (familyOf(convo.provider) !== agent.family()) return res.status(400).json({ message: "The AI model was changed – start a new chat" });
  } else {
    convo = new AiConversation({ user: req.user._id, provider: agent.family(), title: question.slice(0, 80), messages: [], turns: [] });
  }

  const key = String(convo._id);
  if (busy.has(key)) return res.status(409).json({ message: "Still answering the last question – wait a moment" });
  busy.add(key);
  try {
    const messages = [...convo.messages];
    const out = await agent.ask({ user: req.user, messages, question });
    asked.set(userId, { day: today.day, n: today.n + 1 });
    convo.messages = messages;
    convo.turns.push({ role: "user", text: question, at: new Date() }, { role: "assistant", text: out.text, steps: out.steps, servedBy: out.servedBy, at: new Date() });
    convo.usage = {
      input: (convo.usage?.input || 0) + out.usage.input,
      output: (convo.usage?.output || 0) + out.usage.output,
      cacheRead: (convo.usage?.cacheRead || 0) + out.usage.cacheRead,
    };
    convo.markModified("messages");
    await convo.save();
    audit(req, "ai.ask", { entity: "AiConversation", entityId: key, summary: `${out.steps.length} tool calls · ${out.stop} · ${out.servedBy.join(", ")}` });
    res.json({ conversationId: key, reply: out.text, steps: out.steps });
  } catch (err) {
    const status = err?.status;
    const message =
      status === 401 || status === 403 ? "AI key is not valid – check the key on the server" : status === 429 ? "AI is busy (rate limit) – try again in a minute" : status >= 500 ? "AI service had a problem – try again" : err?.message || "AI failed";
    res.status(status === 401 || status === 403 || status === 429 || status >= 500 ? 502 : 500).json({ message });
  } finally {
    busy.delete(key);
  }
});

export = router;
