// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js");
import * as XLSX from "xlsx";

export type SupportedMime =
  | "application/pdf"
  | "text/csv"
  | "application/vnd.ms-excel"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const PDF_MIMES = ["application/pdf"];
const CSV_MIMES = ["text/csv", "text/plain"];
const EXCEL_MIMES = [
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

export function isSupportedFile(mimeType: string, fileName: string): boolean {
  if ([...PDF_MIMES, ...CSV_MIMES, ...EXCEL_MIMES].includes(mimeType)) return true;
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ["pdf", "csv", "xlsx", "xls"].includes(ext ?? "");
}

export async function parseFile(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  const ext = fileName.split(".").pop()?.toLowerCase();

  if (PDF_MIMES.includes(mimeType) || ext === "pdf") {
    const data = await pdfParse(buffer);
    return data.text.trim();
  }

  if (CSV_MIMES.includes(mimeType) || ext === "csv") {
    return buffer.toString("utf-8").trim();
  }

  if (EXCEL_MIMES.includes(mimeType) || ext === "xlsx" || ext === "xls") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    return workbook.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
      return `=== Hoja / Sheet: ${name} ===\n${csv}`;
    }).join("\n\n").trim();
  }

  throw new Error(`Unsupported file type: ${mimeType} (${fileName})`);
}
