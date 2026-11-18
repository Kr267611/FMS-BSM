import express = require("express");
import authLib = require("../middleware/auth");
const { auth, adminOnly } = authLib;
import AiConversation = require("../models/AiConversation");
import agent = require("../services/ai/agent");
import auditLib = require("../services/audit");
const { audit } = auditLib;

// AI assistant – admins only for now. It only reads (see services/ai/tools.ts).
const router = express.Router();
router.use(auth, adminOnly);

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

router.get("/status", (req, res) => {
  res.json({ enabled: agent.enabled(), provider: agent.providerName(), model: agent.model(), dailyLimit: DAILY_LIMIT(), usedToday: countToday(String(req.user._id)).n });
});

router.get("/conversations", async (req, res) => {
  const list = await AiConversation.find({ user: req.user._id }).select("title updatedAt").sort({ updatedAt: -1 }).limit(50).lean();
  res.json(list);
});

router.get("/conversations/:id", async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ message: "Conversation not found" });
  const c = await AiConversation.findOne({ _id: req.params.id, user: req.user._id }).select("title turns updatedAt").lean();
  if (!c) return res.status(404).json({ message: "Conversation not found" });
  res.json(c);
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
    if ((convo.provider || "anthropic") !== agent.providerName()) return res.status(400).json({ message: "The AI model was changed – start a new chat" });
  } else {
    convo = new AiConversation({ user: req.user._id, provider: agent.providerName(), title: question.slice(0, 80), messages: [], turns: [] });
  }

  const key = String(convo._id);
  if (busy.has(key)) return res.status(409).json({ message: "Still answering the last question – wait a moment" });
  busy.add(key);
  try {
    const messages = [...convo.messages];
    const out = await agent.ask({ user: req.user, messages, question });
    asked.set(userId, { day: today.day, n: today.n + 1 });
    convo.messages = messages;
    convo.turns.push({ role: "user", text: question, at: new Date() }, { role: "assistant", text: out.text, steps: out.steps, at: new Date() });
    convo.usage = {
      input: (convo.usage?.input || 0) + out.usage.input,
      output: (convo.usage?.output || 0) + out.usage.output,
      cacheRead: (convo.usage?.cacheRead || 0) + out.usage.cacheRead,
    };
    convo.markModified("messages");
    await convo.save();
    audit(req, "ai.ask", { entity: "AiConversation", entityId: key, summary: `${out.steps.length} tool calls · ${out.stop}` });
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
