const Task = require("../models/Task");
const User = require("../models/User");
const { todayKey } = require("./dates");

// Har doer ke aaj tak due pending tasks (overdue + aaj ke)
async function pendingByDoer() {
  const today = todayKey();
  const tasks = await Task.find({ status: "pending", plannedDay: { $lte: today } })
    .select("doer label plannedDay kind sheetRow")
    .sort({ plannedDay: 1 })
    .lean();

  const byDoer = new Map();
  for (const t of tasks) {
    const id = String(t.doer);
    if (!byDoer.has(id)) byDoer.set(id, []);
    byDoer.get(id).push(t);
  }

  const users = await User.find({ _id: { $in: [...byDoer.keys()] }, active: true })
    .select("name email phone")
    .lean();

  return users.map((u) => {
    const list = byDoer.get(String(u._id));
    return {
      doer: u,
      overdue: list.filter((t) => t.plannedDay < today).length,
      dueToday: list.filter((t) => t.plannedDay === today).length,
      tasks: list,
    };
  });
}

// "2026-09-16" -> "16/09/2026"
const showDay = (key) => key.split("-").reverse().join("/");

function messageFor(entry) {
  const lines = entry.tasks.slice(0, 30).map((t) => {
    const where = t.kind === "sheet" ? ` (sheet row ${t.sheetRow})` : "";
    return `- ${t.label}${where} | Planned: ${showDay(t.plannedDay)}`;
  });
  const more = entry.tasks.length > 30 ? `\n...aur ${entry.tasks.length - 30} task` : "";
  return (
    `Namaste ${entry.doer.name},\n\n` +
    `Aapke ${entry.tasks.length} task pending hain (${entry.overdue} overdue, ${entry.dueToday} aaj ke):\n` +
    lines.join("\n") +
    more +
    `\n\nKripya jaldi complete karein.\n- FMS BSM`
  );
}

function mailer() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const nodemailer = require("nodemailer");
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendEmailReminders() {
  const transport = mailer();
  if (!transport) return { sent: 0, skipped: 0, error: "Email (SMTP) set nahi hai - backend/.env dekhein" };

  const entries = await pendingByDoer();
  let sent = 0;
  let skipped = 0;
  const failed = [];
  for (const e of entries) {
    if (!e.doer.email) {
      skipped++;
      continue;
    }
    try {
      await transport.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: e.doer.email,
        subject: `FMS: ${e.tasks.length} task pending (${e.overdue} overdue)`,
        text: messageFor(e),
      });
      sent++;
    } catch (err) {
      failed.push(`${e.doer.name}: ${err.message}`);
    }
  }
  return { sent, skipped, failed };
}

module.exports = { pendingByDoer, messageFor, sendEmailReminders };
