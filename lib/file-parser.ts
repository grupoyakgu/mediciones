import * as XLSX from "xlsx";

const SUPPORTED_EXTENSIONS = ["pdf", "csv", "xlsx", "xls"];

export function isSupportedFile(_mimeType: string, fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_EXTENSIONS.includes(ext);
}

export async function parseFile(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  // Excel
  if (ext === "xlsx" || ext === "xls" || mimeType.includes("excel") || mimeType.includes("spreadsheet")) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    return workbook.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
      return `=== Hoja / Sheet: ${name} ===\n${csv}`;
    }).join("\n\n").trim();
  }

  // CSV
  if (ext === "csv" || mimeType.includes("csv") || mimeType === "text/plain") {
    return buffer.toString("utf-8").trim();
  }

  // PDF — use unpdf (PDF.js based, handles compressed/signed PDFs)
  if (ext === "pdf" || mimeType === "application/pdf") {
    try {
      const { extractText } = await import("unpdf");
      const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
      if (text && text.trim().length > 0) return text.trim();
    } catch (e) {
      console.error("unpdf error:", e);
    }
    return "[PDF received but text could not be extracted. Please try sending as CSV or Excel instead.]";
  }

  throw new Error(`Unsupported format: ${mimeType} (${fileName})`);
}
