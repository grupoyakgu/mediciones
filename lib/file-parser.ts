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

  // PDF
  if (ext === "pdf" || mimeType === "application/pdf") {
    const raw = buffer.toString("latin1");
    const chunks: string[] = [];
    const regex = /\(([^\\)]{4,})\)/g;
    let match;
    while ((match = regex.exec(raw)) !== null) {
      const str = match[1].replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\/g, "");
      if (/[a-zA-ZÀ-ÿ]{3,}/.test(str)) chunks.push(str);
    }
    if (chunks.length > 0) return chunks.join("\n").trim();
    return "[PDF recibido pero no se pudo extraer texto. Por favor, envía el archivo en formato CSV o Excel.]";
  }

  throw new Error(`Formato no soportado: ${mimeType} (${fileName})`);
}
