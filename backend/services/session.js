const jwt = require("jsonwebtoken");

// Sessions live in an httpOnly cookie, so page scripts can never read the token.
const COOKIE = "fms_session";
const LONG_MS = 7 * 24 * 60 * 60 * 1000; // "Remember me"
const SHORT = "12h"; // browser-session cookie

const hosted = () => Boolean(process.env.RENDER || process.env.VERCEL || process.env.NODE_ENV === "production");

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieString(value, maxAgeMs) {
  const parts = [`${COOKIE}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (hosted()) parts.push("Secure");
  if (maxAgeMs !== undefined) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  return parts.join("; ");
}

// The token carries tokenVersion; a password change bumps it and ends every other session.
function startSession(res, user, remember) {
  const token = jwt.sign({ id: user._id, tv: user.tokenVersion || 0, r: remember ? 1 : 0 }, process.env.JWT_SECRET, {
    expiresIn: remember ? "7d" : SHORT,
  });
  res.setHeader("Set-Cookie", cookieString(token, remember ? LONG_MS : undefined));
  return token;
}

function endSession(res) {
  res.setHeader("Set-Cookie", cookieString("", 0));
}

// Cookie first; a Bearer header is still accepted for scripts and tests.
function readToken(req) {
  const fromCookie = parseCookies(req.headers.cookie)[COOKIE];
  if (fromCookie) return fromCookie;
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

// Tiny in-memory limiter per client IP (the API runs as a single instance).
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || now > entry.reset) hits.set(key, { count: 1, reset: now + windowMs });
    else if (++entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.reset - now) / 1000));
      return res.status(429).json({ message });
    }
    if (hits.size > 10000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    next();
  };
}

module.exports = { startSession, endSession, readToken, rateLimit, COOKIE };
