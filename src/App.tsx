import { useEffect, useMemo, useState } from "react";
import { PdfPreview } from "./components/PdfPreview";
import { createOutputFilename, processPdfInBrowser, templates } from "./pdf/processor";
import type { FormValues, PdfTemplate, ProcessedPdf, ProcessingOptions } from "./types";
import "./styles.css";

const today = new Date().toISOString().slice(0, 10);

const initialValues: FormValues = {
  customerName: "",
  managerName: "",
  managerCode: "",
  date: today,
};

const initialOptions: ProcessingOptions = {
  insertChecks: true,
  generateSignature: true,
  randomStyle: true,
};

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [templateId, setTemplateId] = useState(templates[0].id);
  const [values, setValues] = useState<FormValues>(initialValues);
  const [options, setOptions] = useState<ProcessingOptions>(initialOptions);
  const [result, setResult] = useState<ProcessedPdf | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState("");

  const selectedTemplate = useMemo<PdfTemplate>(() => templates.find((template) => template.id === templateId) ?? templates[0], [templateId]);
  const outputFilename = createOutputFilename(values);

  useEffect(() => {
    return () => {
      if (result?.blobUrl) URL.revokeObjectURL(result.blobUrl);
    };
  }, [result]);

  function acceptFile(nextFile: File | undefined) {
    if (!nextFile) return;
    if (nextFile.type !== "application/pdf" && !nextFile.name.toLowerCase().endsWith(".pdf")) {
      setMessage("PDF 파일만 선택할 수 있습니다.");
      return;
    }
    if (result?.blobUrl) URL.revokeObjectURL(result.blobUrl);
    setFile(nextFile);
    setResult(null);
    setMessage("");
  }

  async function handleProcess() {
    if (!file) {
      setMessage("먼저 PDF 파일을 선택하세요.");
      return;
    }
    if (!values.customerName.trim() || !values.managerName.trim() || !values.managerCode.trim()) {
      setMessage("고객명, 팀장명, 팀장코드를 입력하세요.");
      return;
    }
    setIsProcessing(true);
    setMessage("");
    try {
      if (result?.blobUrl) URL.revokeObjectURL(result.blobUrl);
      const processed = await processPdfInBrowser(file, selectedTemplate, values, options);
      setResult(processed);
      setMessage("PDF 처리가 완료되었습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PDF 처리 중 오류가 발생했습니다.");
    } finally {
      setIsProcessing(false);
    }
  }

  function updateValue(key: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function updateOption(key: keyof ProcessingOptions, value: boolean) {
    setOptions((current) => ({ ...current, [key]: value }));
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <h1>FaxSender</h1>
          <p>브라우저에서 PDF 동의서를 자동 처리합니다.</p>
        </div>
        <span className="privacy-badge">서버 업로드 없음</span>
      </header>

      <section className="workspace">
        <div className="control-column">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>PDF 업로드</h2>
                <p>선택한 파일은 브라우저 메모리에서만 처리됩니다.</p>
              </div>
            </div>
            <label
              className={`dropzone ${isDragging ? "dragging" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                acceptFile(event.dataTransfer.files[0]);
              }}
            >
              <input type="file" accept="application/pdf,.pdf" onChange={(event) => acceptFile(event.target.files?.[0])} />
              <strong>{file ? file.name : "PDF 파일을 여기에 끌어오거나 선택하세요."}</strong>
              <span>PDF만 지원합니다.</span>
            </label>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>템플릿</h2>
                <p>좌표는 PDF point 기준 하드코딩 JSON으로 시작합니다.</p>
              </div>
            </div>
            <label className="field-label">
              <span>템플릿 선택</span>
              <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="template-summary">
              <strong>{selectedTemplate.positions.length}개 합성 좌표</strong>
              <span>{selectedTemplate.description}</span>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>입력값</h2>
                <p>최종 파일명에도 사용됩니다.</p>
              </div>
            </div>
            <div className="form-grid">
              <label className="field-label">
                <span>고객명</span>
                <input value={values.customerName} onChange={(event) => updateValue("customerName", event.target.value)} placeholder="홍길동" />
              </label>
              <label className="field-label">
                <span>팀장명</span>
                <input value={values.managerName} onChange={(event) => updateValue("managerName", event.target.value)} placeholder="송미현" />
              </label>
              <label className="field-label">
                <span>팀장코드</span>
                <input value={values.managerCode} onChange={(event) => updateValue("managerCode", event.target.value)} placeholder="725000000" />
              </label>
              <label className="field-label">
                <span>날짜</span>
                <input type="date" value={values.date} onChange={(event) => updateValue("date", event.target.value)} />
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>옵션</h2>
                <p>체크와 서명 스타일을 브라우저에서 생성합니다.</p>
              </div>
            </div>
            <div className="option-list">
              <label>
                <input type="checkbox" checked={options.insertChecks} onChange={(event) => updateOption("insertChecks", event.target.checked)} />
                체크 자동 삽입
              </label>
              <label>
                <input type="checkbox" checked={options.generateSignature} onChange={(event) => updateOption("generateSignature", event.target.checked)} />
                서명 자동 생성
              </label>
              <label>
                <input type="checkbox" checked={options.randomStyle} onChange={(event) => updateOption("randomStyle", event.target.checked)} />
                랜덤 스타일 적용
              </label>
            </div>
          </section>

          <section className="action-panel">
            <button className="primary-action" type="button" onClick={handleProcess} disabled={isProcessing}>
              {isProcessing ? "처리 중..." : "PDF 처리하기"}
            </button>
            <a className={`download-action ${result ? "" : "disabled"}`} href={result?.blobUrl} download={result?.filename ?? outputFilename}>
              결과 PDF 다운로드
            </a>
            <p>{message || `예상 파일명: ${outputFilename}`}</p>
          </section>
        </div>

        <div className="preview-column">
          <PdfPreview title="업로드 PDF 미리보기" file={file} emptyText="PDF를 업로드하면 이곳에 표시됩니다." />
          <PdfPreview title="합성 결과 미리보기" bytes={result?.bytes ?? null} emptyText="PDF 처리 후 결과가 표시됩니다." />
        </div>
      </section>
    </main>
  );
}

export default App;
