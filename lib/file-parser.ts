import * as XLSX from "xlsx";

const SUPPORTED_EXTENSIONS = ["pdf", "csv", "xlsx", "xls"];
const MAX_CONTENT_CHARS = 15000;

export function isSupportedFile(_mimeType: string, fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_EXTENSIONS.includes(ext);
}

export async function parseFile(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  // Excel
  if (ext === "xlsx" || ext === "xls" || mimeType.includes("excel") || mimeType.includes("spreadsheet")) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const text = workbook.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
      return `=== Hoja / Sheet: ${name} ===\n${csv}`;
    }).join("\n\n").trim();
    return text.slice(0, MAX_CONTENT_CHARS);
  }

  // CSV
  if (ext === "csv" || mimeType.includes("csv") || mimeType === "text/plain") {
    return buffer.toString("utf-8").trim().slice(0, MAX_CONTENT_CHARS);
  }

  // PDF — fast extraction first, unpdf fallback for compressed/signed PDFs
  if (ext === "pdf" || mimeType === "application/pdf") {
    const raw = buffer.toString("latin1");
    const fastChunks: string[] = [];
    const fastRegex = /BT[\s\S]*?ET/g;
    let fm;
    while ((fm = fastRegex.exec(raw)) !== null && fastChunks.join("").length < MAX_CONTENT_CHARS) {
      const inner = fm[0].replace(/\/F\d+\s+[\d.]+\s+Tf/g, "").replace(/Td|Tm|Tf|TJ|Tj|T\*/g, " ");
      const strings = inner.match(/\(([^)]{2,})\)/g) ?? [];
      for (const s of strings) fastChunks.push(s.slice(1, -1));
    }
    const fastText = fastChunks.join(" ").replace(/\\n/g, "\n").replace(/\\/g, "").trim();
    if (fastText.length > 100) return fastText.slice(0, MAX_CONTENT_CHARS);

    try {
      const { extractText } = await import("unpdf");
      const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
      if (text && text.trim().length > 0) return text.trim().slice(0, MAX_CONTENT_CHARS);
    } catch (e) {
      console.error("unpdf error:", String(e));
    }

    return "[PDF received but text could not be extracted. The file may be image-based or heavily encrypted. Please try sending as CSV or Excel instead.]";
  }

  throw new Error(`Unsupported format: ${mimeType} (${fileName})`);
}
