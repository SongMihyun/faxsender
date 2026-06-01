export type SignatureStyle = {
  rotation: number;
  opacity: number;
  scale: number;
};

export function createRandomSignatureStyle(enabled: boolean): SignatureStyle {
  if (!enabled) {
    return { rotation: 0, opacity: 0.92, scale: 1 };
  }
  return {
    rotation: Math.random() * 7 - 3.5,
    opacity: 0.82 + Math.random() * 0.16,
    scale: 0.94 + Math.random() * 0.14,
  };
}

export async function createSignaturePng(name: string, style: SignatureStyle): Promise<ArrayBuffer> {
  const canvas = document.createElement("canvas");
  canvas.width = 620;
  canvas.height = 240;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("서명 이미지를 생성할 수 없습니다.");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((style.rotation * Math.PI) / 180);
  context.scale(style.scale, style.scale);
  context.translate(-canvas.width / 2, -canvas.height / 2);

  context.globalAlpha = style.opacity;
  context.fillStyle = "#101820";
  context.lineWidth = 2.2;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.font = "96px 'Segoe Script', 'Brush Script MT', 'Malgun Gothic', cursive";
  context.textBaseline = "middle";
  context.fillText(name || "서명", 42, 118);

  // Add a light manual underline so plain system fonts still feel handwritten.
  context.beginPath();
  context.moveTo(54, 165);
  context.bezierCurveTo(150, 184, 285, 176, 430, 158);
  context.strokeStyle = "rgba(16, 24, 32, 0.58)";
  context.stroke();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("서명 PNG 변환 실패"))), "image/png");
  });
  return blob.arrayBuffer();
}
