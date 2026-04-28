import { resizeCanvasToDisplaySize, setupCanvas } from "./canvas/setup";

const canvas = document.getElementById("game-canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Expected #game-canvas to be an HTMLCanvasElement");
}

const ctx = setupCanvas(canvas);

function frame(): void {
  resizeCanvasToDisplaySize(canvas);
  const { width, height } = canvas;
  ctx.fillStyle = "#2a2a32";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#888";
  ctx.font = `${Math.max(14, Math.min(width, height) * 0.06)}px system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Mastermind", width / 2, height / 2);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
