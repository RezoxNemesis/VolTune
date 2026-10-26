/**
 * The "string": one line across the page that is plucked on arrival, hums while the
 * model is thinking, and traces the live waveform while a voice is speaking.
 */
export class VoiceString {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private raf = 0;
  private t0 = performance.now();
  private analyser: AnalyserNode | null = null;
  private data = new Uint8Array(0);
  private energy = 0; // smoothed 0..1 speech energy
  private pluck = 0; // decaying 0..1 impulse
  private pluckAt = 0.5;
  private mode: "idle" | "thinking" | "speaking" = "idle";
  private reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private color = "";
  private muted = "";
  private ro: ResizeObserver;
  private mq = matchMedia("(prefers-color-scheme: dark)");

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.mq.addEventListener("change", () => this.readColors());
    document.addEventListener("visibilitychange", () => (document.hidden ? this.halt() : this.start()));
    this.readColors();
    this.resize();
    this.start();
  }

  setAnalyser(a: AnalyserNode | null) {
    this.analyser = a;
    this.data = a ? new Uint8Array(a.fftSize) : new Uint8Array(0);
  }

  setMode(m: "idle" | "thinking" | "speaking") {
    this.mode = m;
  }

  /** Excite the string at a horizontal position (0..1). */
  strum(at = 0.5, force = 1) {
    this.pluckAt = at;
    this.pluck = Math.max(this.pluck, force);
  }

  destroy() {
    this.halt();
    this.ro.disconnect();
  }

  private readColors() {
    const s = getComputedStyle(document.documentElement);
    this.color = s.getPropertyValue("--accent").trim() || "#2b4bff";
    this.muted = s.getPropertyValue("--line").trim() || "#d3d9e3";
  }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw(performance.now());
  }

  private start() {
    if (this.raf) return;
    const loop = (now: number) => {
      this.draw(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private halt() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private draw(now: number) {
    const { ctx, w, h } = this;
    const t = (now - this.t0) / 1000;
    ctx.clearRect(0, 0, w, h);

    // Speech energy from the analyser (RMS of the time-domain signal).
    let target = 0;
    if (this.analyser && this.mode === "speaking") {
      this.analyser.getByteTimeDomainData(this.data as Uint8Array<ArrayBuffer>);
      let sum = 0;
      for (let i = 0; i < this.data.length; i++) {
        const v = (this.data[i]! - 128) / 128;
        sum += v * v;
      }
      target = Math.min(1, Math.sqrt(sum / this.data.length) * 5.5);
    } else if (this.mode === "thinking") {
      target = 0.16 + 0.06 * Math.sin(t * 3.2);
    }
    this.energy += (target - this.energy) * 0.18;
    this.pluck *= 0.965;
    if (this.pluck < 0.002) this.pluck = 0;

    const mid = h / 2;
    const amp = h * 0.42;
    const steps = Math.max(64, Math.floor(w / 3));
    const moving = this.energy > 0.004 || this.pluck > 0;

    // Resting line
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.muted;
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(w, mid + 0.5);
    ctx.stroke();

    if (!moving || this.reduced) {
      if (this.reduced && this.energy > 0.02) this.drawLine(steps, mid, amp * this.energy * 0.6, t, 0);
      return;
    }
    this.drawLine(steps, mid, amp, t, this.pluck);
  }

  private drawLine(steps: number, mid: number, amp: number, t: number, pluck: number) {
    const { ctx, w } = this;
    const live = this.analyser && this.mode === "speaking" && this.data.length > 0;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = this.color;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const x = i / steps;
      // Fixed ends, like a string held at both sides.
      const env = Math.sin(Math.PI * x) ** 1.4;
      let y = 0;
      if (live) {
        const idx = Math.floor(x * (this.data.length - 1));
        y = ((this.data[idx]! - 128) / 128) * 1.6;
      } else {
        y = Math.sin(x * 9 + t * 5.5) * 0.5 + Math.sin(x * 17 - t * 3.1) * 0.25;
      }
      const wave = y * this.energy;
      const d = Math.abs(x - this.pluckAt);
      const pl = pluck * Math.exp(-d * 4) * Math.sin(x * 14 + t * 22) * env;
      const py = mid + (wave * env + pl) * amp;
      if (i === 0) ctx.moveTo(x * w, py);
      else ctx.lineTo(x * w, py);
    }
    ctx.stroke();
  }
}
