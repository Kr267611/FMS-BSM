// CSV helpers for the bulk upload pages
// Which character splits the columns: comma, Tab (Excel "Text (Tab delimited)", copy from a sheet) or semicolon
// (Excel's CSV in some regions) – the one found most often in the header line, outside quotes
export function detectDelimiter(text: string): string {
  const counts = { ",": 0, "\t": 0, ";": 0 };
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) break;
    else if (!quoted && c in counts) counts[c]++;
  }
  return counts["\t"] > counts[","] && counts["\t"] >= counts[";"] ? "\t" : counts[";"] > counts[","] ? ";" : ",";
}

// Small CSV parser: quoted values, "" inside quotes, CRLF; columns split by commas, Tabs or semicolons (detected)
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const sep = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

export function toObjects(rows: string[][]): Record<string, string>[] {
  const [header, ...body] = rows;
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || "").trim()])));
}

export function download(name: string, text: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" }));
  a.download = name;
  a.click();
}

export const csvCell = (v: unknown): string => `"${String(v ?? "").replace(/"/g, '""')}"`;
