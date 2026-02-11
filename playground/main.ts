import { ZSplat } from "@/ZSplat";

const canvas = document.querySelector<HTMLCanvasElement>("#view");
const fileInput = document.querySelector<HTMLInputElement>("#file");
const urlInput = document.querySelector<HTMLInputElement>("#url");
const loadUrlButton = document.querySelector<HTMLButtonElement>("#loadUrl");
const statusEl = document.querySelector<HTMLDivElement>("#status");
const statsEl = document.querySelector<HTMLDivElement>("#stats");
const errorEl = document.querySelector<HTMLDivElement>("#error");

if (!canvas || !fileInput || !urlInput || !loadUrlButton || !statusEl || !statsEl || !errorEl) {
  throw new Error("Playground DOM not ready");
}

const splat = new ZSplat({ sizeScale: 1.2, backgroundColor: [0, 0, 0, 1] });

const state = {
  fps: 0,
  frames: 0,
  lastTime: performance.now()
};

const setStatus = (text: string) => {
  statusEl.textContent = text;
};

const setError = (text: string) => {
  errorEl.textContent = text;
  errorEl.hidden = !text;
};

const updateStats = () => {
  const now = performance.now();
  state.frames += 1;
  if (now - state.lastTime >= 500) {
    state.fps = Math.round((state.frames * 1000) / (now - state.lastTime));
    state.frames = 0;
    state.lastTime = now;
    const { splatCount } = splat.getStats();
    statsEl.textContent = `Splats: ${splatCount.toLocaleString()} | FPS: ${state.fps}`;
  }
};

const orbit = createOrbitControls(canvas, (camera) => {
  splat.setCamera(camera);
});

const start = async () => {
  try {
    await splat.init(canvas);
    setStatus("Ready");
    try {
      const sampleUrl = new URL("../motorbike.compressed.ply", import.meta.url);
      const sampleBuffer = await fetch(sampleUrl).then((res) => res.arrayBuffer());
      await loadBuffer(sampleBuffer);
    } catch {
      // Ignore if the sample file is not reachable.
    }
    const loop = () => {
      splat.render();
      updateStats();
      requestAnimationFrame(loop);
    };
    loop();
  } catch (error) {
    setError(error instanceof Error ? error.message : "Failed to initialize WebGPU");
  }
};

const loadBuffer = async (buffer: ArrayBuffer) => {
  setStatus("Loading PLY...");
  setError("");
  await splat.loadPly(buffer);
  setStatus("Loaded");
  orbit.reset(splat.getCamera());
};

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }
  const buffer = await file.arrayBuffer();
  await loadBuffer(buffer);
});

loadUrlButton.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!url) {
    return;
  }
  setStatus("Fetching PLY...");
  setError("");
  try {
    const buffer = await fetch(url).then((res) => res.arrayBuffer());
    await loadBuffer(buffer);
  } catch (error) {
    setError(error instanceof Error ? error.message : "Failed to fetch PLY");
  }
});

window.addEventListener("resize", () => splat.resize());

start();

function createOrbitControls(
  canvasEl: HTMLCanvasElement,
  onChange: (camera: { eye: [number, number, number]; target: [number, number, number]; up: [number, number, number] }) => void
) {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let azimuth = Math.PI / 4;
  let polar = Math.PI / 3;
  let radius = 3;
  const target: [number, number, number] = [0, 0, 0];

  const update = () => {
    const sinPolar = Math.sin(polar);
    const cosPolar = Math.cos(polar);
    const sinAzimuth = Math.sin(azimuth);
    const cosAzimuth = Math.cos(azimuth);
    const eye: [number, number, number] = [
      target[0] + radius * sinPolar * cosAzimuth,
      target[1] + radius * cosPolar,
      target[2] + radius * sinPolar * sinAzimuth
    ];
    onChange({ eye, target, up: [0, 1, 0] });
  };

  const onPointerDown = (event: PointerEvent) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) {
      return;
    }
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    azimuth -= dx * 0.005;
    polar = Math.min(Math.max(0.2, polar - dy * 0.005), Math.PI - 0.2);
    update();
  };

  const onPointerUp = () => {
    dragging = false;
  };

  const onWheel = (event: WheelEvent) => {
    radius *= event.deltaY > 0 ? 1.08 : 0.92;
    radius = Math.max(0.1, Math.min(50, radius));
    update();
  };

  canvasEl.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  canvasEl.addEventListener("wheel", onWheel, { passive: true });

  update();

  return {
    reset(camera: { eye: [number, number, number]; target: [number, number, number] }) {
      target[0] = camera.target[0];
      target[1] = camera.target[1];
      target[2] = camera.target[2];
      const dx = camera.eye[0] - target[0];
      const dy = camera.eye[1] - target[1];
      const dz = camera.eye[2] - target[2];
      radius = Math.hypot(dx, dy, dz) || 3;
      azimuth = Math.atan2(dz, dx);
      polar = Math.acos(dy / radius);
      update();
    }
  };
}
