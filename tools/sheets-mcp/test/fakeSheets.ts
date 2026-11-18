// An in-memory Google Sheet for tests: cells hold a value (as shown) and optionally a formula.
import a1 = require("../src/a1");
import type { SheetsApi } from "../src/types";

type Cell = { value: any; formula?: string };

function fakeSheets(spreadsheetId: string, title: string, tabs: Record<string, Record<string, Cell | string | number>>) {
  const grid: Record<string, Map<string, Cell>> = {};
  for (const [tab, cells] of Object.entries(tabs)) {
    grid[tab] = new Map(Object.entries(cells).map(([k, v]) => [k, typeof v === "object" ? (v as Cell) : { value: v }]));
  }
  const writes: { range: string; value: string }[] = [];
  const calls: string[] = [];

  function parse(range: string) {
    const m = range.match(/^'((?:[^']|'')+)'!([A-Z]+)(\d+):([A-Z]+)(\d+)$/) || range.match(/^'((?:[^']|'')+)'!([A-Z]+)(\d+)$/);
    if (!m) throw new Error(`fake: bad range ${range}`);
    const tab = m[1].replace(/''/g, "'");
    if (!grid[tab]) throw new Error("Tab or range not found");
    return { tab, c1: a1.colIndex(m[2]), r1: Number(m[3]), c2: a1.colIndex(m[4] || m[2]), r2: Number(m[5] || m[3]) };
  }

  const api: SheetsApi = {
    async meta(id) {
      if (id !== spreadsheetId) throw new Error("Sheet not found – check the URL or id");
      return { title, tabs: Object.keys(grid).map((name, i) => ({ name, gid: i, hidden: false, rows: 1000, cols: 40 })) };
    },
    async values(id, range, render) {
      calls.push(`${render} ${range}`);
      if (id !== spreadsheetId) throw new Error("Sheet not found – check the URL or id");
      const { tab, c1, r1, c2, r2 } = parse(range);
      const rows: any[][] = [];
      for (let r = r1; r <= r2; r++) {
        const row = [];
        for (let c = c1; c <= c2; c++) {
          const cell = grid[tab].get(`${a1.colLetter(c)}${r}`);
          row.push(!cell ? "" : render === "FORMULA" && cell.formula ? cell.formula : cell.value);
        }
        while (row.length && row[row.length - 1] === "") row.pop();
        rows.push(row);
      }
      while (rows.length && !rows[rows.length - 1].length) rows.pop(); // like Google: trailing empty rows left out
      return rows;
    },
    async write(id, data) {
      for (const d of data) {
        const { tab, c1, r1 } = parse(d.range);
        grid[tab].set(`${a1.colLetter(c1)}${r1}`, { value: d.value });
        writes.push(d);
      }
    },
  };
  return { api, grid, writes, calls, set: (tab: string, cell: string, v: Cell) => grid[tab].set(cell, v) };
}

export = { fakeSheets };
