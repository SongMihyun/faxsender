import { degrees, PDFDocument, PDFImage, rgb, StandardFonts } from "pdf-lib";
import defaultTemplate from "../templates/default.json";
import type { FormValues, PdfTemplate, ProcessingOptions, ProcessedPdf, TemplatePosition } from "../types";
import { createRandomSignatureStyle, createSignaturePng } from "./signature";

export const templates: PdfTemplate[] = [defaultTemplate as PdfTemplate];

type PdfPage = ReturnType<PDFDocument["getPage"]>;

const checkManifestUrl = `${import.meta.env.BASE_URL}assets/checks/manifest.json`;

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

function positionOnPage(page: PdfPage, template: PdfTemplate, position: TemplatePosition, randomStyle: boolean) {
  const x = position.x + jitter(randomStyle, 1.2);
  const baseY =
    template.coordinateOrigin === "top_left"
      ? page.getHeight() - position.y - position.height
      : position.y;
  const y = baseY + jitter(randomStyle, 1.2);
  return { x, y };
}

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

async function loadCheckImages(pdfDoc: PDFDocument): Promise<PDFImage[]> {
  try {
    const manifestResponse = await fetch(checkManifestUrl);
    if (!manifestResponse.ok) return [];

    const filenames = (await manifestResponse.json()) as string[];
    const images = await Promise.all(
      filenames.map(async (filename) => {
        const assetResponse = await fetch(`${import.meta.env.BASE_URL}assets/checks/${filename}`);
        if (!assetResponse.ok) return null;
        const bytes = await assetResponse.arrayBuffer();
        return pdfDoc.embedPng(bytes);
      }),
    );

    return images.filter((image): image is PDFImage => Boolean(image));
  } catch {
    return [];
  }
}

function drawVectorCheck(page: PdfPage, template: PdfTemplate, position: TemplatePosition, randomStyle: boolean) {
  const { x, y } = positionOnPage(page, template, position, randomStyle);
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

function drawCheck(page: PdfPage, template: PdfTemplate, position: TemplatePosition, checkImages: PDFImage[], randomStyle: boolean) {
  const image = pickRandom(checkImages);
  if (!image) {
    drawVectorCheck(page, template, position, randomStyle);
    return;
  }
  const { x, y } = positionOnPage(page, template, position, randomStyle);

  page.drawImage(image, {
    x,
    y,
    width: position.width * (randomStyle ? 0.92 + Math.random() * 0.16 : 1),
    height: position.height * (randomStyle ? 0.92 + Math.random() * 0.16 : 1),
    opacity: randomStyle ? 0.82 + Math.random() * 0.16 : 0.95,
    rotate: degrees(randomStyle ? jitter(true, 4) : 0),
  });
}

function resolvePageIndexes(template: PdfTemplate, pageCount: number, position: TemplatePosition): number[] {
  const firstPageIndex = position.page - 1;
  if (!template.groupPageCount || template.groupPageCount <= 0) {
    return firstPageIndex >= 0 && firstPageIndex < pageCount ? [firstPageIndex] : [];
  }

  const indexes: number[] = [];
  for (let offset = 0; offset < pageCount; offset += template.groupPageCount) {
    const pageIndex = firstPageIndex + offset;
    if (pageIndex >= 0 && pageIndex < pageCount) indexes.push(pageIndex);
  }
  return indexes;
}

export async function processPdfInBrowser(file: File, template: PdfTemplate, values: FormValues, options: ProcessingOptions): Promise<ProcessedPdf> {
  const inputBytes = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(inputBytes);
  const pageCount = pdfDoc.getPageCount();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const checkImages = options.insertChecks ? await loadCheckImages(pdfDoc) : [];
  const signatureStyle = createRandomSignatureStyle(options.randomStyle);
  const signaturePngBytes = options.generateSignature ? await createSignaturePng(values.customerName, signatureStyle) : null;
  const signatureImage = signaturePngBytes ? await pdfDoc.embedPng(signaturePngBytes) : null;

  for (const position of template.positions) {
    if (position.type === "extract_text") continue;

    const pageIndexes = resolvePageIndexes(template, pageCount, position);
    for (const pageIndex of pageIndexes) {
      const page = pdfDoc.getPage(pageIndex);
      const { x, y } = positionOnPage(page, template, position, options.randomStyle);

      if (position.type === "check" && options.insertChecks) {
        drawCheck(page, template, position, checkImages, options.randomStyle);
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
