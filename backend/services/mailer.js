// Shared SMTP transport for reminders and password reset emails.
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

function fromAddress() {
  return process.env.MAIL_FROM || process.env.SMTP_USER;
}

module.exports = { mailer, fromAddress };
