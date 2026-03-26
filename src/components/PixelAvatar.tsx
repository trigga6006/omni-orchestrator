import { useEffect, useRef, useCallback } from "react";

interface PixelAvatarProps {
  /** Base color as hex (e.g. "#10b981") */
  color: string;
  /** Size in CSS pixels */
  size: number;
  /** Whether the pixel animation is active (agent is thinking/outputting) */
  active: boolean;
}

/* ------------------------------------------------------------------ */
/* Color helpers                                                       */
/* ------------------------------------------------------------------ */

function hexToHSL(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return [0, 0, l * 100];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

/* ------------------------------------------------------------------ */
/* 2D Perlin noise — organic flow without dependencies                 */
/* ------------------------------------------------------------------ */

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

// Seeded permutation table for deterministic noise
const P = new Uint8Array(512);
{
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  let seed = 42;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807 + 7) % 2147483647;
    const j = seed % (i + 1);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
}

function grad2d(hash: number, x: number, y: number): number {
  const h = hash & 3;
  const u = h < 2 ? x : -x;
  const v = h === 0 || h === 3 ? y : -y;
  return u + v;
}

function noise2d(x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);
  const aa = P[P[xi] + yi];
  const ab = P[P[xi] + yi + 1];
  const ba = P[P[xi + 1] + yi];
  const bb = P[P[xi + 1] + yi + 1];
  return lerp(
    lerp(grad2d(aa, xf, yf), grad2d(ba, xf - 1, yf), u),
    lerp(grad2d(ab, xf, yf - 1), grad2d(bb, xf - 1, yf - 1), u),
    v
  );
}

function fbm(x: number, y: number, octaves: number = 3): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * noise2d(x * freq, y * freq);
    amp *= 0.5;
    freq *= 2;
  }
  return val;
}

/* ------------------------------------------------------------------ */
/* Per-pixel persistent state                                          */
/* ------------------------------------------------------------------ */

const GRID = 12;

interface PixelState {
  hueOffset: number;
  baseLightness: number;
  baseSaturation: number;
  phase: number;
  currentHue: number;
  currentLightness: number;
  currentSaturation: number;
  offsetX: number;
  offsetY: number;
  targetOffsetX: number;
  targetOffsetY: number;
}

function createPixelGrid(): PixelState[][] {
  return Array.from({ length: GRID }, () =>
    Array.from({ length: GRID }, () => ({
      hueOffset: (Math.random() - 0.5) * 40, // ±20° — stays in color family
      baseLightness: 32 + Math.random() * 28, // 32-60%
      baseSaturation: 55 + Math.random() * 35, // 55-90%
      phase: Math.random() * Math.PI * 2,
      currentHue: 0,
      currentLightness: 42,
      currentSaturation: 70,
      offsetX: 0,
      offsetY: 0,
      targetOffsetX: 0,
      targetOffsetY: 0,
    }))
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function PixelAvatar({ color, size, active }: PixelAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelGrid = useRef<PixelState[][] | null>(null);
  const activityRef = useRef(0);
  const lastTimeRef = useRef(0);
  const morphTimerRef = useRef(0);
  const aliveRef = useRef(false); // true while the animation loop is running

  // Store props in refs so draw() reads latest values without recreation.
  const activeRef = useRef(active);
  activeRef.current = active;
  const colorRef = useRef(color);
  colorRef.current = color;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  if (!pixelGrid.current) {
    pixelGrid.current = createPixelGrid();
  }

  // Stable scheduling helper — cancels any pending tick and schedules a new one.
  // Returns a cleanup function. Tracks its own timer ID internally.
  const timerRef = useRef<{ id: number; type: "raf" | "timeout" }>({ id: 0, type: "raf" });

  const cancelTick = useCallback(() => {
    const t = timerRef.current;
    if (t.type === "raf") cancelAnimationFrame(t.id);
    else clearTimeout(t.id);
  }, []);

  const scheduleNextTick = useCallback((fn: () => void, useRaf: boolean) => {
    cancelTick();
    if (useRaf) {
      timerRef.current = { id: requestAnimationFrame(fn), type: "raf" };
    } else {
      timerRef.current = { id: window.setTimeout(fn, 250) as unknown as number, type: "timeout" };
    }
  }, [cancelTick]);

  const draw = useCallback(() => {
    if (!aliveRef.current) return; // component unmounted

    const canvas = canvasRef.current;
    if (!canvas || !canvas.getContext) {
      // Canvas not ready yet — retry next frame (don't let the loop die)
      scheduleNextTick(draw, true);
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      scheduleNextTick(draw, true);
      return;
    }

    const now = performance.now();
    const dt = Math.min((now - (lastTimeRef.current || now)) / 1000, 0.05);
    lastTimeRef.current = now;

    // Read latest props from refs (not closure)
    const isActive = activeRef.current;

    // Smooth activity ramp — fast attack, slow release
    const targetActivity = isActive ? 1 : 0;
    const easeSpeed = isActive ? 4.0 : 0.8;
    activityRef.current += (targetActivity - activityRef.current) * easeSpeed * dt;
    activityRef.current = Math.max(0, Math.min(1, activityRef.current));
    const act = activityRef.current;

    const dpr = window.devicePixelRatio || 1;
    const currentSize = sizeRef.current;
    const canvasSize = Math.round(currentSize * dpr);
    if (canvas.width !== canvasSize || canvas.height !== canvasSize) {
      canvas.width = canvasSize;
      canvas.height = canvasSize;
    }
    ctx.imageSmoothingEnabled = false;

    const [baseHue] = hexToHSL(colorRef.current);
    const pw = canvasSize / GRID;
    const radius = canvasSize / 2;
    const gap = pw * 0.05;
    const time = now / 1000;
    const grid = pixelGrid.current!;

    ctx.clearRect(0, 0, canvasSize, canvasSize);
    ctx.save();
    ctx.beginPath();
    ctx.arc(radius, radius, radius - 0.5, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    // --- Pixel position morphing (active: jitter / idle: settle) ---
    morphTimerRef.current += dt;
    if (morphTimerRef.current > 0.35 && act > 0.25) {
      morphTimerRef.current = 0;
      for (let i = 0; i < GRID; i++) {
        for (let j = 0; j < GRID; j++) {
          const p = grid[i][j];
          // Use noise-based displacement for organic movement (not pure random)
          const noiseX = noise2d(i * 0.7 + time * 2, j * 0.7);
          const noiseY = noise2d(i * 0.7, j * 0.7 + time * 2);
          const strength = act * 0.25 * pw;
          p.targetOffsetX = noiseX * strength;
          p.targetOffsetY = noiseY * strength;
        }
      }
    }
    if (act < 0.05) {
      for (let i = 0; i < GRID; i++) {
        for (let j = 0; j < GRID; j++) {
          grid[i][j].targetOffsetX = 0;
          grid[i][j].targetOffsetY = 0;
        }
      }
    }

    // --- Draw pixels ---
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const p = grid[i][j];

        // Smooth position interpolation (frame-rate independent)
        const morphRate = 1 - Math.pow(0.015, dt);
        p.offsetX += (p.targetOffsetX - p.offsetX) * morphRate;
        p.offsetY += (p.targetOffsetY - p.offsetY) * morphRate;

        const nx = i / GRID;
        const ny = j / GRID;
        const cx = nx - 0.5;
        const cy = ny - 0.5;
        const dist = Math.sqrt(cx * cx + cy * cy);
        const angle = Math.atan2(cy, cx);

        // --- Layer 1: Noise flow field (organic color drift) ---
        const noiseSpeed = 0.06 + act * 0.3;
        const noiseVal = fbm(nx * 2.8 + time * noiseSpeed, ny * 2.8 + time * (noiseSpeed * 0.8), 3);

        // --- Layer 2: Concentric ripple (radial wave from center) ---
        const rippleFreq = 5.0 + act * 6.0;
        const rippleSpeed = 1.5 + act * 5.0;
        const ripple = Math.sin(dist * rippleFreq - time * rippleSpeed + p.phase) * 0.5 + 0.5;

        // --- Layer 3: Spiral vortex (rotation visible when active) ---
        // The spiral term twists the angle by distance, creating a pinwheel
        const spiralTightness = 4.0 + act * 4.0;
        const spiralSpeed = 1.5 + act * 3.5;
        const spiral = Math.sin(angle * 2 + dist * spiralTightness - time * spiralSpeed) * 0.5 + 0.5;

        // --- Layer 4: Diagonal sweep (shimmer band that moves across) ---
        const sweep = Math.sin((nx + ny) * 4.0 - time * (0.8 + act * 2.5) + p.phase * 0.5) * 0.5 + 0.5;

        // --- Layer 5: Idle breathing ---
        const breathe = Math.sin(time * 0.5 + p.phase) * 0.5 + 0.5;
        const idleWave = Math.sin(time * 0.8 + i * 1.3 + j * 1.7) * 0.5 + 0.5;

        // --- Composite hue ---
        // Idle: tight hue range. Active: wider shifts from ripple + spiral
        const hueFromNoise = noiseVal * (8 + act * 18);
        const hueFromSpiral = spiral * act * 10;
        const hueFromSweep = sweep * act * 6;
        const hue = (baseHue + p.hueOffset + hueFromNoise + hueFromSpiral + hueFromSweep + 360) % 360;

        // --- Composite lightness ---
        const idleLightness = p.baseLightness + breathe * 3 + idleWave * 2;
        const activeLightness =
          28 +
          ripple * 28 +      // strong light/dark bands from ripple
          spiral * 12 +      // spiral creates brighter arcs
          noiseVal * 8 +
          sweep * 6 +
          Math.sin(time * 3.0 + p.phase) * 5;
        const lightness = lerp(idleLightness, activeLightness, act);

        // --- Composite saturation ---
        const idleSat = p.baseSaturation + breathe * 2;
        const activeSat = 55 + ripple * 30 + spiral * 10;
        const saturation = lerp(idleSat, activeSat, act);

        // Smooth color interpolation
        const colorRate = 1 - Math.pow(0.003, dt);
        p.currentHue += (hue - p.currentHue) * colorRate;
        p.currentLightness += (lightness - p.currentLightness) * colorRate;
        p.currentSaturation += (saturation - p.currentSaturation) * colorRate;

        const x = i * pw + gap + p.offsetX;
        const y = j * pw + gap + p.offsetY;
        const w = pw - gap * 2;

        ctx.fillStyle = `hsl(${p.currentHue}, ${Math.max(0, Math.min(100, p.currentSaturation))}%, ${Math.max(6, Math.min(80, p.currentLightness))}%)`;
        ctx.fillRect(x, y, w, w);
      }
    }

    ctx.restore();

    // Performance: active/transitioning avatars at full framerate,
    // fully settled idle avatars at ~4fps for subtle breathing.
    scheduleNextTick(draw, act > 0.02);
  }, [scheduleNextTick]); // stable — reads all changing values from refs

  // Start the loop on mount, kill it on unmount.
  useEffect(() => {
    aliveRef.current = true;
    lastTimeRef.current = 0;
    scheduleNextTick(draw, true);
    return () => {
      aliveRef.current = false;
      cancelTick();
    };
  }, [draw, scheduleNextTick, cancelTick]);

  // When `active` flips to true, kick the loop out of slow-tick mode immediately.
  // Without this, a settled idle avatar in the 250ms setTimeout path would take
  // up to 250ms to notice it should start animating.
  useEffect(() => {
    if (active && aliveRef.current) {
      scheduleNextTick(draw, true);
    }
  }, [active, draw, scheduleNextTick]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        imageRendering: "pixelated",
      }}
    />
  );
}
