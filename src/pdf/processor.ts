import { degrees, PDFDocument, PDFImage, rgb, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import defaultTemplate from "../templates/default.json";
import type { FormValues, PdfTemplate, ProcessingOptions, ProcessedPdf, TemplatePosition } from "../types";
import { createRandomSignatureStyle, createSignaturePng } from "./signature";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export const templates: PdfTemplate[] = [defaultTemplate as PdfTemplate];

type PdfPage = ReturnType<PDFDocument["getPage"]>;

type GrayscalePage = {
  width: number;
  height: number;
  pngBytes: ArrayBuffer;
};

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

export function createBatchOutputFilename(valuesList: FormValues[]): string {
  const first = valuesList[0];
  if (!first) return createOutputFilename({ customerName: "unknown", managerName: "unknown", managerCode: "unknown", date: "" });
  if (valuesList.length <= 1) return createOutputFilename(first);
  return createOutputFilename({
    ...first,
    customerName: `${first.customerName}_외${valuesList.length - 1}명`,
  });
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

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("흑백 PDF 페이지 변환에 실패했습니다."))), "image/png");
  });
  return blob.arrayBuffer();
}

function convertCanvasToFaxGrayscale(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return;

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  for (let index = 0; index < pixels.length; index += 4) {
    const gray = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    const faxGray = gray > 238 ? 255 : Math.max(0, Math.min(255, (gray - 18) * 0.82));
    pixels[index] = faxGray;
    pixels[index + 1] = faxGray;
    pixels[index + 2] = faxGray;
    pixels[index + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
}

async function renderGrayscalePages(inputBytes: ArrayBuffer): Promise<GrayscalePage[]> {
  const renderScale = 2;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(inputBytes.slice(0)) });
  const sourcePdf = await loadingTask.promise;
  const pages: GrayscalePage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= sourcePdf.numPages; pageNumber += 1) {
      const sourcePage = await sourcePdf.getPage(pageNumber);
      const viewport = sourcePage.getViewport({ scale: renderScale });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("PDF 페이지를 렌더링할 수 없습니다.");

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await sourcePage.render({ canvasContext: context, viewport }).promise;
      convertCanvasToFaxGrayscale(canvas);

      pages.push({
        width: viewport.width / renderScale,
        height: viewport.height / renderScale,
        pngBytes: await canvasToPngBytes(canvas),
      });
    }
  } finally {
    await loadingTask.destroy();
  }

  return pages;
}

async function createFaxBasePdf(inputBytes: ArrayBuffer): Promise<PDFDocument> {
  const grayscalePages = await renderGrayscalePages(inputBytes);
  const pdfDoc = await PDFDocument.create();

  for (const grayscalePage of grayscalePages) {
    const page = pdfDoc.addPage([grayscalePage.width, grayscalePage.height]);
    const image = await pdfDoc.embedPng(grayscalePage.pngBytes);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: grayscalePage.width,
      height: grayscalePage.height,
    });
  }

  return pdfDoc;
}

function drawVectorCheck(page: PdfPage, template: PdfTemplate, position: TemplatePosition, randomStyle: boolean) {
  const { x, y } = positionOnPage(page, template, position, randomStyle);
  const color = rgb(0, 0, 0);
  const thickness = randomStyle ? 3 + Math.random() * 1.4 : 3.4;

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
    opacity: randomStyle ? 0.96 + Math.random() * 0.04 : 1,
    rotate: degrees(randomStyle ? jitter(true, 4) : 0),
  });
}

function groupCountForPdf(template: PdfTemplate, pageCount: number): number {
  const groupPageCount = Math.max(1, template.groupPageCount ?? pageCount);
  return Math.max(1, Math.ceil(pageCount / groupPageCount));
}

export async function processPdfInBrowser(file: File, template: PdfTemplate, values: FormValues | FormValues[], options: ProcessingOptions): Promise<ProcessedPdf> {
  const inputBytes = await file.arrayBuffer();
  const pdfDoc = await createFaxBasePdf(inputBytes);
  const pageCount = pdfDoc.getPageCount();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const checkImages = options.insertChecks ? await loadCheckImages(pdfDoc) : [];
  const valuesList = Array.isArray(values) ? values : [values];
  const groupPageCount = Math.max(1, template.groupPageCount ?? pageCount);
  const groupCount = groupCountForPdf(template, pageCount);

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const groupValues = valuesList[groupIndex] ?? valuesList[0];
    const pageOffset = groupIndex * groupPageCount;
    const signatureStyle = createRandomSignatureStyle(options.randomStyle);
    const signaturePngBytes = options.generateSignature ? await createSignaturePng(groupValues.customerName, signatureStyle) : null;
    const signatureImage = signaturePngBytes ? await pdfDoc.embedPng(signaturePngBytes) : null;

    for (const position of template.positions) {
      if (position.type === "extract_text") continue;
      const pageIndex = position.page - 1 + pageOffset;
      if (pageIndex < 0 || pageIndex >= pageCount) continue;
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
          opacity: 1,
          rotate: degrees(options.randomStyle ? signatureStyle.rotation : 0),
        });
        continue;
      }

      if (position.type === "name" || position.type === "date") {
        page.drawText(fieldValue(position, groupValues), {
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
    filename: createBatchOutputFilename(valuesList),
  };
}
