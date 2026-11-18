export type Render = "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";

export interface Tab {
  name: string;
  gid: number;
  hidden: boolean;
  rows: number;
  cols: number;
}

export interface SheetsApi {
  meta(spreadsheetId: string): Promise<{ title: string; tabs: Tab[] }>;
  values(spreadsheetId: string, range: string, render: Render): Promise<any[][]>;
  // each range is one cell, e.g. "'SPARE PART'!AI12"
  write(spreadsheetId: string, data: { range: string; value: string }[]): Promise<void>;
}

// Where the AI may write: one spreadsheet tab, some columns, from a row on. Nothing else is writable.
export interface WriteRule {
  spreadsheetId: string;
  tab: string;
  columns: string[];
  firstRow: number;
  lastRow?: number;
  note?: string;
}

export interface Config {
  write: WriteRule[];
  dataDir: string;
  maxCellsPerProposal: number;
  proposalMinutes: number;
}

export interface CellChange {
  cell: string; // "AI12"
  value: string;
}

export interface Proposal {
  id: string;
  spreadsheetId: string;
  tab: string;
  changes: CellChange[];
  reason: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "applied" | "cancelled" | "failed";
  appliedAt?: string;
  error?: string;
}
