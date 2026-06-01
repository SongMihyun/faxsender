import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import defaultTemplate from "../templates/default.json";
import type { FormValues, PdfTemplate, ProcessingOptions, ProcessedPdf, TemplatePosition } from "../types";
import { createRandomSignatureStyle, createSignaturePng } from "./signature";

export const templates: PdfTemplate[] = [defaultTemplate as PdfTemplate];

function sanitizeFilenamePart(value: string): string {
  return (value || "unknown")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[\\/:*?"<>|]/g, "")
    .slice(0, 60);
}

export function createOutputFilename(values: FormValues): string {
  return `${sanitizeFilenamePart(values.managerCode)}_${sanitizeFilenamePart(values.managerName)}_${sanitizeFilenamePart(values.customerName)}.pdf`;
}

function fieldValue(position: TemplatePosition, values: FormValues): string {
  if (!position.field) return "";
  return values[position.field] ?? "";
}

function jitter(enabled: boolean, amount: number): number {
  return enabled ? Math.random() * amount * 2 - amount : 0;
}

function drawCheck(page: ReturnType<PDFDocument["getPage"]>, position: TemplatePosition, randomStyle: boolean) {
  const x = position.x + jitter(randomStyle, 1.5);
  const y = position.y + jitter(randomStyle, 1.5);
  const color = rgb(0.02, 0.25, 0.2);
  const thickness = randomStyle ? 2.2 + Math.random() * 1.4 : 2.8;

  page.drawLine({
    start: { x: x + position.width * 0.12, y: y + position.height * 0.52 },
    end: { x: x + position.width * 0.42, y: y + position.height * 0.2 },
    thickness,
    color,
  });
  page.drawLine({
    start: { x: x + position.width * 0.42, y: y + position.height * 0.2 },
    end: { x: x + position.width * 0.92, y: y + position.height * 0.88 },
    thickness,
    color,
  });
}

export async function processPdfInBrowser(file: File, template: PdfTemplate, values: FormValues, options: ProcessingOptions): Promise<ProcessedPdf> {
  const inputBytes = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(inputBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const signatureStyle = createRandomSignatureStyle(options.randomStyle);
  const signaturePngBytes = options.generateSignature ? await createSignaturePng(values.customerName, signatureStyle) : null;
  const signatureImage = signaturePngBytes ? await pdfDoc.embedPng(signaturePngBytes) : null;

  for (const position of template.positions) {
    const pageIndex = position.page - 1;
    if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;
    const page = pdfDoc.getPage(pageIndex);
    const x = position.x + jitter(options.randomStyle, 1.2);
    const y = position.y + jitter(options.randomStyle, 1.2);

    if (position.type === "check" && options.insertChecks) {
      drawCheck(page, position, options.randomStyle);
      continue;
    }

    if (position.type === "signature" && options.generateSignature && signatureImage) {
      page.drawImage(signatureImage, {
        x,
        y,
        width: position.width * signatureStyle.scale,
        height: position.height * signatureStyle.scale,
        opacity: signatureStyle.opacity,
        rotate: degrees(options.randomStyle ? signatureStyle.rotation : 0),
      });
      continue;
    }

    if (position.type === "name" || position.type === "date") {
      page.drawText(fieldValue(position, values), {
        x,
        y,
        size: position.type === "name" ? 12 : 10,
        font: position.type === "name" ? boldFont : font,
        color: rgb(0.05, 0.08, 0.1),
        opacity: options.randomStyle ? 0.9 + Math.random() * 0.1 : 1,
      });
    }
  }

  const bytes = await pdfDoc.save();
  const blobBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(blobBuffer).set(bytes);
  const blob = new Blob([blobBuffer], { type: "application/pdf" });
  return {
    bytes,
    blobUrl: URL.createObjectURL(blob),
    filename: createOutputFilename(values),
  };
}
