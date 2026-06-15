import { useEffect, useMemo, useState } from "react";
import { PdfPreview } from "./components/PdfPreview";
import { createOutputFilename, processPdfInBrowser, templates } from "./pdf/processor";
import type { FormValues, ProcessedPdf, ProcessingOptions } from "./types";
import "./styles.css";

type StepStatus = "idle" | "running" | "done" | "failed";

type FaxStep = {
  key: string;
  label: string;
  status: StepStatus;
};

const today = new Date().toISOString().slice(0, 10);

const initialSteps: FaxStep[] = [
  { key: "upload", label: "파일 업로드", status: "idle" },
  { key: "convert", label: "PDF 변환", status: "idle" },
  { key: "extract", label: "정보 추출", status: "idle" },
  { key: "check", label: "체크 합성", status: "idle" },
  { key: "signature", label: "서명 합성", status: "idle" },
  { key: "final", label: "최종 PDF 생성", status: "idle" },
];

const options: ProcessingOptions = {
  insertChecks: true,
  generateSignature: true,
  randomStyle: true,
};

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function stepLabel(status: StepStatus) {
  if (status === "running") return "진행중";
  if (status === "done") return "완료";
  if (status === "failed") return "실패";
  return "대기";
}

function inferValues(file: File | null): FormValues {
  const stem = file?.name.replace(/\.[^.]+$/, "").trim() || "고객";
  return {
    customerName: stem || "고객",
    managerName: "담당자",
    managerCode: "000000000",
    date: today,
  };
}

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [steps, setSteps] = useState<FaxStep[]>(initialSteps);
  const [result, setResult] = useState<ProcessedPdf | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const values = useMemo(() => inferValues(file), [file]);
  const outputFilename = createOutputFilename(values);
  const selectedTemplate = templates[0];

  useEffect(() => {
    return () => {
      if (result?.blobUrl) URL.revokeObjectURL(result.blobUrl);
    };
  }, [result]);

  function setStepStatus(index: number, status: StepStatus) {
    setSteps((current) => current.map((step, stepIndex) => (stepIndex === index ? { ...step, status } : step)));
  }

  function reset() {
    if (result?.blobUrl) URL.revokeObjectURL(result.blobUrl);
    setFile(null);
    setResult(null);
    setSteps(initialSteps);
    setMessage("");
    setIsProcessing(false);
  }

  async function runProcess(nextFile: File) {
    setIsProcessing(true);
    setMessage("");
    setSteps(initialSteps);
    setResult(null);

    try {
      for (let index = 0; index < initialSteps.length; index += 1) {
        setStepStatus(index, "running");
        await delay(index === initialSteps.length - 1 ? 180 : 120);

        if (index === 1 && nextFile.name.toLowerCase().endsWith(".ozd")) {
          throw new Error("GitHub Pages 버전은 서버 변환이 없어 PDF만 처리할 수 있습니다.");
        }

        setStepStatus(index, "done");
      }

      const processed = await processPdfInBrowser(nextFile, selectedTemplate, inferValues(nextFile), options);
      setResult(processed);
      setMessage("최종 PDF 생성이 완료되었습니다.");
    } catch (error) {
      setSteps((current) => {
        const runningIndex = current.findIndex((step) => step.status === "running");
        if (runningIndex < 0) {
          return current.map((step, index) => (index === current.length - 1 ? { ...step, status: "failed" } : step));
        }
        return current.map((step, index) => (index === runningIndex ? { ...step, status: "failed" } : step));
      });
      setMessage(error instanceof Error ? error.message : "PDF 처리 중 오류가 발생했습니다.");
    } finally {
      setIsProcessing(false);
    }
  }

  function acceptFile(nextFile: File | undefined) {
    if (!nextFile) return;
    const lowerName = nextFile.name.toLowerCase();
    if (!lowerName.endsWith(".pdf") && !lowerName.endsWith(".ozd")) {
      setMessage("OZD 또는 PDF 파일만 선택할 수 있습니다.");
      return;
    }
    if (result?.blobUrl) URL.revokeObjectURL(result.blobUrl);
    setFile(nextFile);
    void runProcess(nextFile);
  }

  return (
    <main className="fax-page">
      <header className="fax-title">
        <h1>자동팩스 원큐 처리</h1>
        <p>OZD 또는 PDF 파일을 업로드하면 자동으로 최종 동의서 PDF를 생성합니다.</p>
      </header>

      <section className="fax-panel upload-panel">
        <div className="panel-topline">
          <div>
            <h2>파일 업로드</h2>
            <p>업로드 후 체크와 서명을 합성해 최종 PDF를 생성합니다.</p>
          </div>
          {(file || result) && (
            <button className="subtle-button" type="button" onClick={reset} disabled={isProcessing}>
              다시 업로드
            </button>
          )}
        </div>

        <label
          className={`fax-dropzone ${isDragging ? "dragging" : ""}`}
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
          <input type="file" accept=".ozd,.pdf,application/pdf" onChange={(event) => acceptFile(event.target.files?.[0])} />
          <span className="upload-symbol" aria-hidden="true">
            ⇧
          </span>
          <strong>OZD/PDF 파일을 여기에 끌어오거나 선택하세요.</strong>
          <span>허용 확장자: .ozd, .pdf</span>
          <span className="select-button">파일 선택</span>
        </label>

        {file && <p className="selected-file">선택 파일: {file.name}</p>}
        {message && <p className={`message ${result ? "success" : "notice"}`}>{message}</p>}
      </section>

      <section className="fax-panel status-panel">
        <div className="panel-topline">
          <div>
            <h2>자동 처리 진행 상태</h2>
            <p>백엔드 처리 결과에 따라 최종 완성본 PDF를 미리보기로 표시합니다.</p>
          </div>
        </div>

        <div className="step-grid">
          {steps.map((step, index) => (
            <article className={`step-card ${step.status}`} key={step.key}>
              <span className="step-number">{index + 1}</span>
              <strong>{step.label}</strong>
              <span className="step-badge">{stepLabel(step.status)}</span>
            </article>
          ))}
        </div>
      </section>

      {result && (
        <section className="fax-panel result-panel">
          <div className="panel-topline">
            <div>
              <h2>최종 완성본 미리보기</h2>
              <p>브라우저에서 합성한 결과 PDF입니다.</p>
            </div>
            <div className="result-actions">
              <a className="primary-button" href={result.blobUrl} download={result.filename || outputFilename}>
                PDF로 저장하기
              </a>
              <button className="subtle-button" type="button" onClick={() => window.alert("팩스 발송 기능은 로컬 백엔드 버전에서 지원됩니다.")}>
                팩스 발송
              </button>
              <button className="subtle-button" type="button" onClick={() => window.alert("카카오톡 발송 기능은 로컬 백엔드 버전에서 지원됩니다.")}>
                나에게 카톡 발송
              </button>
            </div>
          </div>
          <PdfPreview title="최종 완성본" bytes={result.bytes} emptyText="PDF 처리 후 결과가 표시됩니다." />
        </section>
      )}
    </main>
  );
}

export default App;
