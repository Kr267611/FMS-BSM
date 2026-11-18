// Proposals waiting for approval, and the audit log of every write – kept as files in the data folder
// so they survive a restart and can be read by a person.
import fs = require("fs");
import path = require("path");
import crypto = require("crypto");
import type { Proposal } from "./types";

function makeStore(dataDir: string) {
  const file = path.join(dataDir, "proposals.json");
  const auditFile = path.join(dataDir, "audit.jsonl");
  const ensure = () => fs.mkdirSync(dataDir, { recursive: true });

  function all(): Proposal[] {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return [];
    }
  }

  // Applied or old proposals are kept for 7 days, then dropped from the file (the audit log keeps the history)
  function save(list: Proposal[], now: Date) {
    ensure();
    const keep = list.filter((p) => p.status === "pending" || now.getTime() - Date.parse(p.createdAt) < 7 * 86400000);
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(keep, null, 2));
    fs.renameSync(tmp, file);
  }

  return {
    newId: () => "p-" + crypto.randomBytes(5).toString("hex"),
    get: (id: string) => all().find((p) => p.id === id) || null,
    list: () => all(),
    put(p: Proposal, now = new Date()) {
      const list = all().filter((x) => x.id !== p.id);
      list.push(p);
      save(list, now);
    },
    audit(entry: Record<string, any>) {
      ensure();
      fs.appendFileSync(auditFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
    },
    auditFile,
  };
}

export = { makeStore };
