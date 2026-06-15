import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { FormValues, PdfTemplate, TemplateField, TemplatePosition } from "../types";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

type TextItemLike = {
  str: string;
  width: number;
  height: number;
  transform: number[];
};

type ExtractedValues = Partial<FormValues>;

const fieldKeyToFormField: Record<string, TemplateField> = {
  customer_name: "customerName",
  manager_name: "managerName",
  manager_code: "managerCode",
};

function isTextItem(item: unknown): item is TextItemLike {
  if (!item || typeof item !== "object") return false;
  const candidate = item as TextItemLike;
  return typeof candidate.str === "string" && Array.isArray(candidate.transform);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanCustomerName(value: string): string {
  const cleaned = normalizeText(value).replace(/님$/, "").trim();
  const nameMatch = cleaned.match(/[가-힣A-Za-z]{2,20}/);
  return (nameMatch?.[0] ?? cleaned)
    .replace(/[()]/g, "")
    .trim();
}

function parseManagerCode(value: string): string {
  const parenMatch = value.match(/\((\d{6,12})\)/);
  if (parenMatch) return parenMatch[1];
  const digitMatch = value.match(/\b\d{6,12}\b/);
  return digitMatch?.[0] ?? "";
}

function parseManagerName(value: string): string {
  const parenNameMatch = value.match(/([가-힣A-Za-z]{2,20})\s*\(\d{6,12}\)/);
  if (parenNameMatch) return parenNameMatch[1];

  const parts = value
    .split("/")
    .map((part) => normalizeText(part))
    .filter(Boolean);
  const lastPart = parts.length > 0 ? parts[parts.length - 1] : value;
  return lastPart.replace(/\(\d{6,12}\)/, "").trim();
}

function normalizeExtractedField(field: TemplateField, value: string, fallback: string): string {
  const cleaned = normalizeText(value);
  if (!cleaned) return fallback;
  if (field === "managerCode") return parseManagerCode(cleaned) || fallback;
  if (field === "managerName") return parseManagerName(cleaned) || fallback;
  if (field === "customerName") return cleanCustomerName(cleaned) || fallback;
  return cleaned || fallback;
}

function textItemIntersectsPosition(item: TextItemLike, position: TemplatePosition, viewport: pdfjs.PageViewport): boolean {
  const [pdfX, pdfY] = [item.transform[4], item.transform[5]];
  const [viewportX, viewportY] = viewport.convertToViewportPoint(pdfX, pdfY);
  const itemLeft = viewportX;
  const itemRight = viewportX + Math.max(item.width, 1);
  const itemTop = viewportY - Math.max(item.height, 1);
  const itemBottom = viewportY + Math.max(item.height, 1);
  const regionLeft = position.x;
  const regionRight = position.x + position.width;
  const regionTop = position.y;
  const regionBottom = position.y + position.height;

  return itemRight >= regionLeft && itemLeft <= regionRight && itemBottom >= regionTop && itemTop <= regionBottom;
}

function fieldForPosition(position: TemplatePosition): TemplateField | null {
  if (position.field) return position.field;
  if (position.fieldKey && fieldKeyToFormField[position.fieldKey]) return fieldKeyToFormField[position.fieldKey];
  return null;
}

export async function extractFormValuesFromPdf(file: File, template: PdfTemplate, fallback: FormValues): Promise<FormValues> {
  if (!file.name.toLowerCase().endsWith(".pdf")) return fallback;

  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    const extracted: ExtractedValues = {};
    const extractPositions = template.positions.filter((position) => position.type === "extract_text");

    for (const position of extractPositions) {
      const field = fieldForPosition(position);
      if (!field || position.page < 1 || position.page > pdf.numPages) continue;

      const page = await pdf.getPage(position.page);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const textItems = (textContent.items as unknown[]).filter(isTextItem);
      const rawText = textItems
        .filter((item) => textItemIntersectsPosition(item, position, viewport))
        .map((item) => item.str)
        .join(" ");

      const nextValue = normalizeExtractedField(field, rawText, fallback[field]);
      if (nextValue) extracted[field] = nextValue;
    }

    return { ...fallback, ...extracted };
  } catch {
    return fallback;
  }
}
