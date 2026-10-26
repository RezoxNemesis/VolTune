import "./styles/main.css";
import { Capacitor } from "@capacitor/core";
import { SpeechEngine, isSupported } from "./engine/client";
import { Player } from "./engine/player";
import { toFloat32 } from "./engine/audio";
import { MAX_CHARS, estimateSeconds } from "./engine/text";
import { autoAssignVoices, parseScript } from "./engine/dialogue";
import { DEFAULT_VOICE, VOICES, isVoiceId } from "./engine/voices";
import { buildPlan, type PlanItem } from "./engine/plan";
import { hashPlan, openStore, secs, type ClipMeta, type ClipStore } from "./engine/store";
import { rechunk, wavPieces, buildWavBlob } from "./engine/export";
import { FileSaver } from "./native/plugins";
import { VoiceString } from "./ui/string";

type Mode = "speak" | "dialogue";

interface Saved {
  mode: Mode;
  texts: Record<Mode, string>;
  voice: string;
  pace: number;
  rhythm: number;
  cast: Record<string, string>;
}

const STORE = "voltune.v1";
const WARM = "voltune.warm";
const SAMPLE_DIALOGUE = "Maya: Did you hear that?\nJon: Hear what? I was reading.\nMaya: Listen. It stopped, just now.\nJon: Maya, it's an old house. It's allowed to make noise.";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

const els = {
  tabs: $("tabs"),
  load: $("load"),
  text: $<HTMLTextAreaElement>("text"),
  cast: $("cast"),
  editor: $("editor"),
  stage: $("stage"),
  status: $("status"),
  count: $("count"),
  voice: $<HTMLSelectElement>("voice"),
  voiceField: $("voice-field"),
  pace: $<HTMLInputElement>("pace"),
  paceOut: $("pace-out"),
  rhythm: $<HTMLSelectElement>("rhythm"),
  speak: $<HTMLButtonElement>("speak"),
  play: $<HTMLButtonElement>("play"),
  save: $<HTMLButtonElement>("save"),
  edit: $<HTMLButtonElement>("edit"),
  panel: $("panel"),
};

/* ---------- persisted settings ---------- */

function loadSaved(): Saved {
  const base: Saved = { mode: "speak", texts: { speak: "", dialogue: "" }, voice: DEFAULT_VOICE, pace: 1, rhythm: 1, cast: {} };
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return base;
    const s = JSON.parse(raw) as Partial<Saved>;
    return {
      mode: s.mode === "dialogue" ? "dialogue" : "speak",
      texts: { speak: String(s.texts?.speak ?? "").slice(0, MAX_CHARS), dialogue: String(s.texts?.dialogue ?? "").slice(0, MAX_CHARS) },
      voice: typeof s.voice === "string" && isVoiceId(s.voice) ? s.voice : DEFAULT_VOICE,
      pace: typeof s.pace === "number" && s.pace >= 0.7 && s.pace <= 1.3 ? s.pace : 1,
      rhythm: s.rhythm === 0.7 || s.rhythm === 1.35 ? s.rhythm : 1,
      cast: Object.fromEntries(Object.entries(s.cast ?? {}).filter(([, v]) => typeof v === "string" && isVoiceId(v))),
    };
  } catch {
    return base;
  }
}

const state = loadSaved();
let persistTimer = 0;
function persist() {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(state));
    } catch {
      /* storage unavailable: settings simply will not persist */
    }
  }, 250);
}

/* ---------- engine ---------- */

const engine = new SpeechEngine();
const player = new Player();
const string = new VoiceString($<HTMLCanvasElement>("string"));

let phase: "idle" | "loading" | "generating" | "ready" = "idle";
let plan: PlanItem[] = [];
let metas: ClipMeta[] = [];
let spans: HTMLElement[] = [];
let raf = 0;
let runToken = 0;
let store: ClipStore | null = null;
let jobId = "";
let lastActive = -1;
let wake: { release(): Promise<void> } | null = null;

async function getStore(): Promise<ClipStore> {
  if (!store) store = (await openStore()).store;
  return store;
}

/* ---------- helpers ---------- */

function setStatus(text: string, tone: "info" | "error" = "info") {
  els.status.textContent = text;
  els.status.dataset.tone = tone;
}

function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function transition(fn: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) doc.startViewTransition(fn);
  else fn();
}

function autosize() {
  const t = els.text;
  t.style.height = "auto";
  t.style.height = `${Math.max(220, t.scrollHeight)}px`;
}

function updateCount() {
  const n = els.text.value.length;
  const secs = estimateSeconds(els.text.value, state.pace);
  els.count.textContent = n === 0 ? "" : `${n.toLocaleString()} / ${MAX_CHARS.toLocaleString()} · about ${fmt(secs)}`;
}

/* ---------- voices ---------- */

function voiceOptions(select: HTMLSelectElement, selected: string) {
  select.replaceChildren();
  for (const lang of ["en", "hi"] as const) {
    for (const gender of ["Female", "Male"] as const) {
      const list = VOICES.filter((x) => x.lang === lang && x.gender === gender);
      if (list.length === 0) continue;
      const group = document.createElement("optgroup");
      group.label = `${lang === "hi" ? "Hindi · हिन्दी" : "English"} · ${gender}`;
      for (const v of list) {
        const o = document.createElement("option");
        o.value = v.id;
        o.textContent = `${v.name} · ${v.accent} · ${v.tone}`;
        group.append(o);
      }
      select.append(group);
    }
  }
  select.value = selected;
}

function renderCast() {
  const { speakers } = parseScript(els.text.value);
  state.cast = autoAssignVoices(speakers, state.cast);
  els.cast.replaceChildren();
  for (const name of speakers) {
    const row = document.createElement("div");
    row.className = "cast-row";
    const label = document.createElement("strong");
    label.textContent = name;
    const wrap = document.createElement("div");
    wrap.className = "select";
    const sel = document.createElement("select");
    sel.setAttribute("aria-label", `Voice for ${name}`);
    voiceOptions(sel, state.cast[name] ?? DEFAULT_VOICE);
    sel.addEventListener("change", () => {
      state.cast[name] = sel.value;
      persist();
    });
    wrap.append(sel);
    row.append(label, wrap);
    els.cast.append(row);
  }
  els.cast.hidden = state.mode !== "dialogue" || speakers.length === 0;
}

/* ---------- stage (read-along view) ---------- */

function renderStage() {
  els.stage.replaceChildren();
  spans = [];
  let turnEl: HTMLElement | null = null;
  let turnId = -1;
  const frag = document.createDocumentFragment();
  plan.forEach((item, i) => {
    if (item.turn !== turnId || !turnEl) {
      turnId = item.turn;
      turnEl = document.createElement("div");
      turnEl.className = "turn";
      if (item.speaker) {
        const who = document.createElement("span");
        who.className = "who";
        who.textContent = item.speaker;
        turnEl.append(who);
      }
      frag.append(turnEl);
    }
    const s = document.createElement("span");
    s.className = "s pending";
    s.textContent = item.text;
    s.tabIndex = -1;
    s.addEventListener("click", () => seekTo(i));
    s.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        seekTo(i);
      }
    });
    turnEl.append(s, document.createTextNode(" "));
    spans.push(s);
  });
  els.stage.append(frag);
}

function seekTo(i: number) {
  const m = metas[i];
  if (!m) return;
  player.seek(secs(m.startSample));
  if (player.state !== "playing") player.toggle();
}

function showStage(show: boolean) {
  transition(() => {
    els.stage.hidden = !show;
    els.editor.hidden = show;
    els.edit.hidden = !show;
  });
}

/** Index of the clip playing at `pos` seconds (binary search; stays fast for thousands of clips). */
function activeAt(pos: number): number {
  let lo = 0;
  let hi = metas.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (secs(metas[mid]!.startSample) <= pos + 0.02) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

let shownReady = 0;
let shownActive = -2;
let shownState = "";

function tick() {
  const st = player.state;
  const live = st === "playing" || st === "paused";
  const active = live ? activeAt(player.position) : -1;
  if (active !== shownActive || st !== shownState || metas.length !== shownReady) {
    const from = Math.max(0, Math.min(shownActive < 0 ? 0 : shownActive - 1, active < 0 ? 0 : active - 1));
    const lo = shownState !== st || shownReady === 0 ? 0 : Math.max(0, from - 1);
    const hi = shownState !== st ? spans.length : Math.min(spans.length, Math.max(metas.length, active + 2));
    for (let i = lo; i < hi; i++) {
      const s = spans[i]!;
      const ready = i < metas.length;
      s.classList.toggle("pending", !ready);
      s.classList.toggle("active", live && i === active);
      s.classList.toggle("played", ready && (st === "ended" || (live && i < active)));
      if (ready && s.tabIndex !== 0) s.tabIndex = 0;
    }
    shownReady = metas.length;
    shownActive = active;
    shownState = st;
  }
  if (st === "playing" && active !== lastActive) {
    lastActive = active;
    const el = spans[active];
    if (el) el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  raf = requestAnimationFrame(tick);
}

/* ---------- keep the screen awake during long renders ---------- */

async function holdAwake() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
    if (!wake && nav.wakeLock) wake = await nav.wakeLock.request("screen");
  } catch {
    wake = null;
  }
}

function letSleep() {
  void wake?.release().catch(() => {});
  wake = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && phase === "generating") void holdAwake();
});

/* ---------- actions ---------- */

function resetAudio() {
  player.stop();
  metas = [];
  plan = [];
  spans = [];
  shownReady = 0;
  shownActive = -2;
  shownState = "";
  cancelAnimationFrame(raf);
  letSleep();
  els.save.disabled = true;
  els.play.disabled = true;
  els.play.dataset.playing = "false";
}

function setPhase(p: typeof phase) {
  phase = p;
  const busy = p === "loading" || p === "generating";
  els.speak.textContent = busy ? "Stop" : "Speak";
  els.speak.dataset.busy = String(busy);
  string.setMode(p === "loading" ? "thinking" : p === "generating" || player.state === "playing" ? "speaking" : "idle");
}

function fmtLong(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

function etaText(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "";
  if (seconds < 45) return "under a minute left";
  const mins = Math.round(seconds / 60);
  if (mins < 90) return `about ${mins} min left`;
  return `about ${(mins / 60).toFixed(1)} h left`;
}

function currentPlanOptions() {
  return { mode: state.mode, speed: state.pace, pauseScale: state.rhythm, voice: state.voice, cast: state.cast };
}

async function speak() {
  if (phase === "loading" || phase === "generating") {
    engine.cancel();
    player.cancelGeneration();
    if (phase === "loading") {
      runToken++;
      resetAudio();
      setPhase("idle");
      setStatus("");
      els.load.hidden = true;
      showStage(false);
    }
    return;
  }
  const value = els.text.value;
  if (!value.trim()) {
    setStatus(state.mode === "dialogue" ? "Write a line as “Name: what they say”." : "Add some text first.", "error");
    els.text.focus();
    return;
  }
  resetAudio();
  lastActive = -1;
  const token = ++runToken;
  const built = buildPlan(value, currentPlanOptions());
  state.cast = built.cast;
  plan = built.items;
  if (plan.length === 0) {
    setStatus("Nothing speakable found. Add some words.", "error");
    return;
  }
  els.load.hidden = true;
  string.strum(0.5, 1);
  renderStage();
  showStage(true);
  setPhase("loading");
  setStatus("Preparing…");

  // Find earlier work for this exact text and settings, so an interrupted render continues and a finished one replays at once.
  let existing: ClipMeta[] = [];
  let startIndex = 0;
  try {
    const st = await getStore();
    const hash = await hashPlan(plan);
    const found = await st.findJob(hash);
    if (token !== runToken) return;
    if (found) {
      jobId = found.id;
      existing = await st.metas(found.id);
      startIndex = existing.length;
      if (startIndex < plan.length) await st.truncate(found.id, startIndex);
    } else {
      jobId = `j${Date.now().toString(36)}`;
      await st.startJob({ id: jobId, planHash: hash, total: plan.length, createdAt: Date.now() });
    }
  } catch {
    failed("Couldn’t prepare storage for the audio. Free some space and try again.");
    return;
  }
  const st = store!;
  const id = jobId;
  metas = [...existing];
  const loader = async (i: number) => toFloat32(await st.get(id, i));
  const complete = startIndex >= plan.length;

  try {
    await player.begin(loader, existing);
    string.setAnalyser(player.analyserNode);
    if (!complete) {
      setStatus(engine.device ? "Starting…" : "Preparing the voice engine…");
      await engine.load();
      try {
        localStorage.setItem(WARM, "1");
      } catch {
        /* optional */
      }
    }
    if (token !== runToken) return;
  } catch (e) {
    if (token !== runToken) return;
    failed(e instanceof Error ? e.message : "The voice engine failed to start. Reload the page and try again.");
    return;
  }
  els.load.hidden = true;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
  if (existing.length > 0) {
    els.play.disabled = false;
    els.play.dataset.playing = "true";
  }
  if (complete) {
    player.finish();
    setPhase("ready");
    els.save.disabled = false;
    setStatus(`Ready · ${fmtLong(player.duration)}`);
    return;
  }

  setPhase("generating");
  void holdAwake();
  setStatus(existing.length ? "Resuming…" : "Speaking…");
  const totalChars = plan.reduce((n, p) => n + p.text.length, 0);
  const doneChars0 = plan.slice(0, startIndex).reduce((n, p) => n + p.text.length, 0);
  const t0 = performance.now();
  let sawFirst = existing.length > 0;
  await engine
    .generate(plan, { store: st, jobId: id, startIndex, existing }, {
      onClip(meta, done, total) {
        if (token !== runToken) return;
        metas.push(meta);
        player.add(meta);
        if (!sawFirst) {
          sawFirst = true;
          els.play.disabled = false;
          els.play.dataset.playing = "true";
        }
        const doneChars = plan.slice(0, done).reduce((n, p) => n + p.text.length, 0);
        const elapsed = (performance.now() - t0) / 1000;
        const rate = (doneChars - doneChars0) / Math.max(0.5, elapsed);
        const eta = rate > 0 ? (totalChars - doneChars) / rate : NaN;
        const pct = Math.round((done / total) * 100);
        const where = engine.device === "native" ? "" : engine.device === "webgpu" ? " · GPU" : "";
        setStatus(done < total ? `Speaking · ${pct}%${total > 20 && done > 4 ? ` · ${etaText(eta)}` : ""}${where}` : "Finishing…");
      },
      onDone() {
        if (token !== runToken) return;
        player.finish();
        letSleep();
        setPhase("ready");
        els.save.disabled = false;
        setStatus(`Ready · ${fmtLong(player.duration)}`);
      },
      onCancel() {
        player.finish();
        letSleep();
        setPhase(metas.length ? "ready" : "idle");
        els.save.disabled = metas.length === 0;
        setStatus(metas.length ? `Stopped · ${fmtLong(player.duration)} so far. Press Speak to continue.` : "");
        if (!metas.length) showStage(false);
      },
      onError(message) {
        failed(message);
      },
    })
    .catch((e: unknown) => failed(e instanceof Error ? e.message : "Speech generation stopped unexpectedly. Try again."));
}

function failed(message: string) {
  player.cancelGeneration();
  letSleep();
  const hadAudio = metas.length > 0;
  setPhase(hadAudio ? "ready" : "idle");
  els.save.disabled = !hadAudio;
  els.load.hidden = true;
  setStatus(hadAudio ? `${message} What’s done so far is kept; press Speak to continue.` : message, "error");
  if (!hadAudio) showStage(false);
}

function editText() {
  runToken++;
  engine.cancel();
  resetAudio();
  setPhase("idle");
  setStatus("");
  showStage(false);
  els.text.focus();
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fileName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `voltune-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.wav`;
}

/**
 * Android: stream the WAV into a temporary file in small pieces (an hour of audio never sits in memory),
 * then open the system “Save as” dialog so the person chooses where it goes.
 */
async function saveNative(st: ClipStore, id: string, all: readonly ClipMeta[], name: string, progress: (f: number) => void) {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const tmp = `export-${Date.now()}.wav`;
  const bytesTotal = 44 + (all.length ? (all[all.length - 1]!.startSample + all[all.length - 1]!.samples) * 2 : 0);
  let written = 0;
  let uri = "";
  try {
    for await (const chunk of rechunk(wavPieces(st, id, all), 1 << 20)) {
      const data = toBase64(chunk);
      if (written === 0) uri = (await Filesystem.writeFile({ path: tmp, data, directory: Directory.Cache })).uri;
      else await Filesystem.appendFile({ path: tmp, data, directory: Directory.Cache });
      written += chunk.length;
      progress(Math.min(1, written / bytesTotal));
    }
    await FileSaver.save({ path: uri, name, mime: "audio/wav" });
  } finally {
    await Filesystem.deleteFile({ path: tmp, directory: Directory.Cache }).catch(() => {});
  }
}

let saving = false;

async function save() {
  if (!metas.length || !store || saving) return;
  saving = true;
  els.save.disabled = true;
  const name = fileName();
  const snapshot = [...metas];
  const st = store;
  const id = jobId;
  try {
    if (Capacitor.isNativePlatform()) {
      setStatus("Preparing the file…");
      await saveNative(st, id, snapshot, name, (f) => setStatus(`Preparing the file · ${Math.round(f * 100)}%`));
      setStatus("Saved.");
    } else {
      setStatus("Preparing the file…");
      const blob = await buildWavBlob(st, id, snapshot);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus(`Saved as ${name}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) setStatus(phase === "ready" ? `Ready · ${fmtLong(player.duration)}` : "");
    else setStatus("Couldn’t save the audio file. Check free space and try again.", "error");
  } finally {
    saving = false;
    els.save.disabled = metas.length === 0;
  }
}

/* ---------- mode ---------- */

function placeInk() {
  const tab = els.tabs.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!tab) return;
  els.tabs.style.setProperty("--ink-x", `${tab.offsetLeft}px`);
  els.tabs.style.setProperty("--ink-w", `${tab.offsetWidth}px`);
}

function applyMode(mode: Mode, focusTab = false) {
  const changed = state.mode !== mode;
  if (changed) {
    state.texts[state.mode] = els.text.value;
    if (phase === "loading" || phase === "generating") {
      runToken++;
      engine.cancel();
    }
    resetAudio();
    setPhase("idle");
    setStatus("");
  }
  state.mode = mode;
  const run = () => {
    els.tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focusTab) b.focus();
    });
    els.panel.setAttribute("aria-labelledby", `tab-${mode}`);
    els.stage.hidden = true;
    els.editor.hidden = false;
    els.edit.hidden = true;
    els.text.value = state.texts[mode] ?? "";
    els.text.placeholder = mode === "dialogue" ? SAMPLE_DIALOGUE : "Type or paste what you want to hear.";
    els.voiceField.hidden = mode === "dialogue";
    renderCast();
    autosize();
    updateCount();
    placeInk();
  };
  if (changed) transition(run);
  else run();
  persist();
}

/* ---------- wiring ---------- */

function init() {
  if (!isSupported()) {
    setStatus("This browser can’t run VolTune. Try a recent version of Chrome, Edge, Safari or Firefox.", "error");
    els.speak.disabled = true;
  }

  voiceOptions(els.voice, state.voice);
  els.pace.value = String(state.pace);
  els.paceOut.textContent = `${state.pace.toFixed(2)}×`;
  applyMode(state.mode);

  els.text.addEventListener("input", () => {
    if (els.text.value.length > MAX_CHARS) els.text.value = els.text.value.slice(0, MAX_CHARS);
    state.texts[state.mode] = els.text.value;
    autosize();
    updateCount();
    if (state.mode === "dialogue") renderCast();
    persist();
  });
  els.text.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void speak();
    }
  });
  els.voice.addEventListener("change", () => {
    state.voice = els.voice.value;
    persist();
  });
  els.rhythm.value = String(state.rhythm);
  els.rhythm.addEventListener("change", () => {
    state.rhythm = Number(els.rhythm.value);
    persist();
  });
  els.pace.addEventListener("input", () => {
    state.pace = Number(els.pace.value);
    els.paceOut.textContent = `${state.pace.toFixed(2)}×`;
    updateCount();
    persist();
  });
  els.speak.addEventListener("click", () => void speak());
  els.edit.addEventListener("click", editText);
  els.save.addEventListener("click", () => void save());
  els.play.addEventListener("click", () => player.toggle());

  els.tabs.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
    if (b?.dataset.mode) applyMode(b.dataset.mode as Mode);
  });
  els.tabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    applyMode(state.mode === "speak" ? "dialogue" : "speak", true);
  });

  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (e.code === "Space" && player.hasAudio && !/^(TEXTAREA|INPUT|SELECT|BUTTON)$/.test(t.tagName) && !t.classList.contains("s")) {
      e.preventDefault();
      player.toggle();
    }
  });

  player.onState = (s) => {
    els.play.dataset.playing = String(s === "playing");
    els.play.setAttribute("aria-label", s === "playing" ? "Pause" : "Play");
    string.setMode(phase === "loading" ? "thinking" : s === "playing" ? "speaking" : "idle");
    if (s === "ended") {
      string.setMode("idle");
    }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  };

  const files = new Map<string, { loaded: number; total: number }>();
  engine.onProgress = (p) => {
    files.set(p.file || "model", p);
    let loaded = 0;
    let total = 0;
    files.forEach((v) => {
      loaded += v.loaded;
      total += v.total;
    });
    if (total <= 0 || phase !== "loading") return;
    els.load.hidden = false;
    els.load.style.setProperty("--p", String(Math.min(1, loaded / total)));
    const mb = (n: number) => `${Math.round(n / 1_048_576)} MB`;
    setStatus(`Downloading the voice model · ${mb(loaded)} of ${mb(total)}. This happens once.`);
  };

  // If the voice has been downloaded before, warm it up in the background so the first Speak is quick.
  try {
    if (isSupported() && localStorage.getItem(WARM) === "1") window.setTimeout(() => void engine.load().catch(() => {}), 1200);
  } catch {
    /* optional */
  }

  window.addEventListener("resize", placeInk);
  document.fonts?.ready.then(placeInk);
  // One orchestrated moment on arrival: pluck the string once.
  window.setTimeout(() => string.strum(0.38, 0.9), 450);
  window.addEventListener("beforeunload", () => engine.cancel());
}

init();
