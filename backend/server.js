// Launcher. The backend is written in TypeScript (server.ts and the folders next to it);
// `npm run build` compiles it to dist/. This file lets `node server.js` and `npm start` keep working.
const fs = require("fs");
const path = require("path");

const built = path.join(__dirname, "dist", "server.js");
if (!fs.existsSync(built)) {
  console.log("dist/ not found - compiling the TypeScript first…");
  require("child_process").execSync("npx tsc -p .", { cwd: __dirname, stdio: "inherit" });
}
module.exports = require(built);
