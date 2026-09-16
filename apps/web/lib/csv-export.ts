/**
 * CSV export for the list screens. The rows come from the same list endpoints the tables
 * use, read page by page, so an export always matches what the workspace holds rather
 * than whichever page happened to be on screen.
 */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

/**
 * Quotes a cell when it has to, and defuses a leading `=` or `@` — a spreadsheet would
 * otherwise run the cell as a formula, and lead names come from outside the company.
 * `+` and `-` are left alone because every phone number starts with one.
 */
function cell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  return [
    columns.map((column) => cell(column.header)).join(","),
    ...rows.map((row) => columns.map((column) => cell(column.value(row))).join(",")),
  ].join("\r\n");
}

/** Reads every page of a paginated list endpoint, stopping at `limit` rows. */
export async function fetchAll<T>(
  fetchPage: (page: number) => Promise<{ data: T[]; totalPages: number }>,
  limit = 10_000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page += 1) {
    const result = await fetchPage(page);
    rows.push(...result.data);
    if (page >= result.totalPages || rows.length >= limit) break;
  }
  return rows.slice(0, limit);
}

/** Hands the browser a file. The BOM makes Excel read ₹ and non-Latin names correctly. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
