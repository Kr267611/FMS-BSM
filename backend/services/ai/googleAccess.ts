// Which Google account the AI assistant's Sheets and Drive tools read with.
//   - A person can connect their own Google account on the AI page (OAuth, read-only Drive scope). The AI then reads
//     with that account and sees exactly what that person sees in Google – nothing more.
//   - An admin who has not connected falls back to the app's service account (files shared with it).
//   - Anyone else must connect first: they never read through the service account.
// Files and tabs whose name contains a blocked word (AI_GOOGLE_BLOCK, comma separated, default "inventory") are never read.
// Refresh tokens are stored encrypted (AES-256-GCM, key from AI_TOKEN_SECRET or JWT_SECRET) and never leave the server.
import crypto = require("crypto");
import { AsyncLocalStorage } from "async_hooks";
import GoogleConnection = require("../../models/GoogleConnection");
import permissionsLib = require("../permissions");
const { isAdmin } = permissionsLib;

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const SCOPES = ["openid", "email", DRIVE_SCOPE];
const STATE_MS = 10 * 60 * 1000;

function fail(message: string): never {
  throw new Error(message);
}

const env = (name: string) =>
  String(process.env[name] ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();

function config() {
  const app = env("APP_URL").replace(/\/+$/, "");
  return {
    clientId: env("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirect: env("GOOGLE_OAUTH_REDIRECT_URL") || (app ? `${app}/api/ai/google/callback` : ""),
    domain: env("AI_GOOGLE_DOMAIN").toLowerCase().replace(/^@/, ""),
  };
}

// Setting names only, never values
function setupProblems() {
  const c = config();
  const out = [];
  if (!c.clientId) out.push("GOOGLE_OAUTH_CLIENT_ID is empty or missing");
  if (!c.clientSecret) out.push("GOOGLE_OAUTH_CLIENT_SECRET is empty or missing");
  if (!c.redirect) out.push("APP_URL (or GOOGLE_OAUTH_REDIRECT_URL) is empty or missing");
  return out;
}
const configured = () => setupProblems().length === 0;

// ---------- block list ----------

// empty or missing = "inventory" (an empty line in .env must not open everything); "none" = no block list
function blockWords() {
  const raw = env("AI_GOOGLE_BLOCK") || "inventory";
  if (raw.toLowerCase() === "none") return [];
  return raw
    .split(",")
    .map((w) => w.trim().replace(/^["']|["']$/g, "").trim().toLowerCase())
    .filter(Boolean);
}
const isBlocked = (name: any) => {
  const n = String(name || "").toLowerCase();
  return blockWords().some((w) => n.includes(w));
};
const BLOCKED = "This file is blocked for the AI by the admin";

// ---------- encryption and the sign-in state ----------

const keyFor = (label: string) => crypto.createHash("sha256").update(`${label}:${env("AI_TOKEN_SECRET") || process.env.JWT_SECRET || ""}`).digest();

function seal(text: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyFor("google-token"), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
function unseal(sealed: string) {
  const [v, iv, tag, data] = String(sealed || "").split(".");
  if (v !== "v1" || !iv || !tag || !data) fail("Unknown token format");
  const d = crypto.createDecipheriv("aes-256-gcm", keyFor("google-token"), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

// The state sent to Google and back: signed, names the user who started, expires in 10 minutes.
// The callback also needs that same user's session, so a link started by someone else cannot connect your account to theirs.
const sign = (body: string) => crypto.createHmac("sha256", keyFor("google-state")).update(body).digest("base64url");
function makeState(userId, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ u: String(userId), e: now + STATE_MS, n: crypto.randomBytes(9).toString("base64url") })).toString("base64url");
  return `${body}.${sign(body)}`;
}
function checkState(state, userId, now = Date.now()) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) return false;
  const want = sign(body);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return s.u === String(userId) && Number(s.e) > now;
  } catch {
    return false;
  }
}

// ---------- Google clients (replaceable in tests) ----------

let oauthFactory = null;
let clientsFactory = null;
function oauth() {
  if (oauthFactory) return oauthFactory();
  const c = config();
  const { google } = require("googleapis");
  return new google.auth.OAuth2(c.clientId, c.clientSecret, c.redirect);
}
function clientsFor(auth) {
  if (clientsFactory) return clientsFactory(auth);
  const { google } = require("googleapis");
  return { drive: google.drive({ version: "v3", auth }), sheets: google.sheets({ version: "v4", auth }) };
}

// ---------- connect / disconnect ----------

function authUrl(user) {
  const c = config();
  return oauth().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES, state: makeState(user._id), include_granted_scopes: false, ...(c.domain ? { hd: c.domain } : {}) });
}

const cache = new Map<string, { stamp: number; drive: any; sheets: any }>();

async function finish(user, { code, state }) {
  if (!checkState(state, user._id)) fail("The Google sign-in expired or was started by someone else – press Connect Google again");
  if (!code) fail("Google did not send a sign-in code");
  const client = oauth();
  const { tokens } = await client.getToken(String(code));
  const granted = String(tokens?.scope || "").split(/\s+/).filter(Boolean);
  if (!granted.includes(DRIVE_SCOPE)) fail("Drive permission was not given – connect again and allow \"See and download your Google Drive files\"");
  if (!tokens.refresh_token) fail("Google did not give a lasting key – connect again");
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config().clientId });
  const p = ticket.getPayload() || {};
  const email = String(p.email || "").toLowerCase();
  if (!email || p.email_verified === false) fail("Google did not confirm the account's email");
  const domain = config().domain;
  if (domain && !email.endsWith("@" + domain)) fail(`Only @${domain} Google accounts can be connected`);
  await GoogleConnection.updateOne({ user: user._id }, { $set: { email, refreshToken: seal(tokens.refresh_token), scopes: granted, connectedAt: new Date() } }, { upsert: true });
  cache.delete(String(user._id));
  return { email };
}

async function disconnect(user) {
  const conn: any = await GoogleConnection.findOne({ user: user._id }).lean();
  if (!conn) return { removed: false };
  await GoogleConnection.deleteOne({ _id: conn._id });
  cache.delete(String(user._id));
  try {
    await oauth().revokeToken(unseal(conn.refreshToken)); // also removes the app from the person's Google account
  } catch {
    // already revoked or unreadable: the stored key is gone either way
  }
  return { removed: true };
}

async function status(user) {
  const conn: any = await GoogleConnection.findOne({ user: user._id }).select("email connectedAt").lean();
  return {
    configured: configured(),
    connected: Boolean(conn),
    email: conn?.email || null,
    connectedAt: conn?.connectedAt || null,
    // what the AI reads with when not connected
    fallback: isAdmin(user) ? "service" : "none",
    ...(isAdmin(user) ? { problems: setupProblems(), blocked: blockWords() } : {}),
  };
}

// ---------- which account a tool call reads with ----------

type Access = { mode: "user" | "service" | "none"; email?: string; drive?: any; sheets?: any; note?: string };
const als = new AsyncLocalStorage<Access>();

async function accessFor(user): Promise<Access> {
  const conn: any = await GoogleConnection.findOne({ user: user._id }).lean();
  if (conn) {
    const id = String(user._id);
    const stamp = new Date(conn.connectedAt).getTime();
    let c = cache.get(id);
    if (!c || c.stamp !== stamp) {
      let refresh;
      try {
        refresh = unseal(conn.refreshToken);
      } catch {
        refresh = null; // the secret changed: the stored key cannot be read
      }
      if (refresh) {
        const auth = oauth();
        auth.setCredentials({ refresh_token: refresh });
        c = { stamp, ...clientsFor(auth) };
        cache.set(id, c);
      }
    }
    if (c) return { mode: "user", email: conn.email, drive: c.drive, sheets: c.sheets };
    if (!isAdmin(user)) return { mode: "none", note: "Your Google connection cannot be read any more – press Connect Google again on the AI page" };
  }
  return isAdmin(user) ? { mode: "service" } : { mode: "none" };
}

const NOT_CONNECTED = "Google is not connected for you – press \"Connect Google\" on the AI page first. The AI then reads your own Drive and Sheets (read-only).";

// Runs a Sheets / Drive tool with the person's account
async function withAccess<T>(user, fn: () => Promise<T>): Promise<T> {
  const access = await accessFor(user);
  if (access.mode === "none") fail(access.note || NOT_CONNECTED);
  return als.run(access, fn);
}
const current = (): Access | null => als.getStore() || null;
const viaUser = () => current()?.mode === "user";
const who = () => (viaUser() ? `your Google account (${current().email})` : "the app's service account");

// Errors from Google when reading with the person's own account, in plain words (null = not one of these)
function userError(err): string | null {
  if (!viaUser()) return null;
  const msg = err?.errors?.[0]?.message || err?.response?.data?.error?.message || err?.response?.data?.error || err?.message || String(err);
  if (/invalid_grant|invalid_token|token has been expired or revoked/i.test(String(msg))) return "Your Google connection has expired or was removed – press Connect Google again on the AI page";
  if (/has not been used|is disabled|accessNotConfigured/i.test(msg)) return "The Google API is off in the app's Google Cloud project – an admin must turn on the Google Drive API and Google Sheets API";
  if (err?.code === 404 || /not found/i.test(msg)) return `Not found – check the link, or ${who()} cannot see this file`;
  if (err?.code === 403 || /permission|insufficient/i.test(msg)) return `No access – ${who()} cannot open this file. Ask its owner to share it with you.`;
  return null;
}

export = {
  SCOPES,
  configured,
  setupProblems,
  isBlocked,
  BLOCKED,
  authUrl,
  finish,
  disconnect,
  status,
  accessFor,
  withAccess,
  current,
  viaUser,
  who,
  userError,
  seal,
  unseal,
  makeState,
  checkState,
  setOAuthForTests: (f) => {
    oauthFactory = f;
    cache.clear();
  },
  setClientsForTests: (f) => {
    clientsFactory = f;
    cache.clear();
  },
};
