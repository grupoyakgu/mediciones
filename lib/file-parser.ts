import * as XLSX from "xlsx";

const CSV_MIMES = ["text/csv", "text/plain"];
const EXCEL_MIMES = [
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const PDF_MIMES = ["application/pdf"];

export function isSupportedFile(mimeType: string, fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if ([...PDF_MIMES, ...CSV_MIMES, ...EXCEL_MIMES].includes(mimeType)) return true;
  return ["pdf", "csv", "xlsx", "xls"].includes(ext);
}

export async function parseFile(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  // Excel
  if (EXCEL_MIMES.includes(mimeType) || ext === "xlsx" || ext === "xls") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    return workbook.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
      return `=== Hoja / Sheet: ${name} ===\n${csv}`;
    }).join("\n\n").trim();
  }

  // CSV
  if (CSV_MIMES.includes(mimeType) || ext === "csv") {
    return buffer.toString("utf-8").trim();
  }

  // PDF — extract raw text bytes (works for text-based PDFs without native deps)
  if (PDF_MIMES.includes(mimeType) || ext === "pdf") {
    const raw = buffer.toString("latin1");
    // Extract readable ASCII text runs from the PDF byte stream
    const chunks: string[] = [];
    const regex = /\(([^\\)]{4,})\)/g;
    let match;
    while ((match = regex.exec(raw)) !== null) {
      const str = match[1].replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\\/g, "");
      if (/[a-zA-Zà-ÿ]{3,}/.test(str)) chunks.push(str);
    }
    if (chunks.length > 0) return chunks.join("\n").trim();
    return "[PDF recibido pero no se pudo extraer texto. Por favor, envía el archivo en formato CSV o Excel.]";
  }

  throw new Error(`Formato no soportado: ${mimeType} (${fileName})`);
}
