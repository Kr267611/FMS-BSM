const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const connectDB = require("./config/db");
const User = require("./models/User");
const { startScheduler } = require("./services/scheduler");

if (!process.env.JWT_SECRET) {
  console.error("backend/.env me JWT_SECRET nahi hai. .env.example dekhein.");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/processes", require("./routes/processes"));
app.use("/api/jobs", require("./routes/jobs"));
app.use("/api/tasks", require("./routes/tasks"));
app.use("/api/sheets", require("./routes/sheets"));
app.use("/api/mis", require("./routes/mis"));
app.use("/api/reminders", require("./routes/reminders"));
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api", (req, res) => res.status(404).json({ message: "API nahi mili" }));

// Production me React ka build bhi yahi server deta hai (ek hi deploy)
const dist = path.join(__dirname, "..", "frontend", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, "index.html")));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.name === "CastError") return res.status(400).json({ message: "ID galat hai" });
  if (err.name === "ValidationError") return res.status(400).json({ message: err.message });
  console.error(err);
  res.status(500).json({ message: "Server error" });
});

// Pehli baar: koi admin nahi hai to .env ke ADMIN_USERNAME / ADMIN_PASSWORD se admin banao
async function ensureAdmin() {
  if (await User.exists({ role: "admin" })) return;
  const username = process.env.ADMIN_USERNAME || "admin";
  if (await User.exists({ username })) {
    console.error(`Koi admin nahi hai aur "${username}" username pehle se doer hai. .env me ADMIN_USERNAME badlein.`);
    process.exit(1);
  }
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error("Pehla admin banane ke liye backend/.env me ADMIN_PASSWORD daalein.");
    process.exit(1);
  }
  await User.create({ name: "Admin", username, password: await bcrypt.hash(password, 10), role: "admin" });
  console.log(`Admin user "${username}" bana diya (password backend/.env me hai)`);
}

async function start() {
  await connectDB();
  await ensureAdmin();
  const port = Number(process.env.PORT) || 5050;
  const server = app.listen(port, () => console.log(`FMS BSM server: http://localhost:${port}`));
  if (process.env.DISABLE_SCHEDULER !== "1") startScheduler();

  // Band karte waqt database ko araam se band karo (local dev data save rahe)
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    await connectDB.closeDB().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { app, start };
