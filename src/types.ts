export type TemplatePositionType = "check" | "name" | "date" | "signature";

export type TemplateField = "customerName" | "managerName" | "managerCode" | "date";

export type TemplatePosition = {
  id: string;
  type: TemplatePositionType;
  field?: TemplateField;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfTemplate = {
  id: string;
  name: string;
  description: string;
  positions: TemplatePosition[];
};

export type FormValues = {
  customerName: string;
  managerName: string;
  managerCode: string;
  date: string;
};

export type ProcessingOptions = {
  insertChecks: boolean;
  generateSignature: boolean;
  randomStyle: boolean;
};

export type ProcessedPdf = {
  bytes: Uint8Array;
  blobUrl: string;
  filename: string;
};
