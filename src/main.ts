import "./styles/main.css";
import { SpeechEngine, isSupported, type Clip, type Segment } from "./engine/client";
import { Player } from "./engine/player";
import { encodeWav, SAMPLE_RATE } from "./engine/audio";
import { MAX_CHARS, estimateSeconds, toChunks } from "./engine/text";
import { autoAssignVoices, parseScript } from "./engine/dialogue";
import { DEFAULT_VOICE, VOICES, isVoiceId } from "./engine/voices";
import { VoiceString } from "./ui/string";

type Mode = "speak" | "dialogue";

interface Saved {
  mode: Mode;
  texts: Record<Mode, string>;
  voice: string;
  pace: number;
  cast: Record<string, string>;
}

const STORE = "voltune.v1";
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
  speak: $<HTMLButtonElement>("speak"),
  play: $<HTMLButtonElement>("play"),
  save: $<HTMLButtonElement>("save"),
  edit: $<HTMLButtonElement>("edit"),
  panel: $("panel"),
};

/* ---------- persisted settings ---------- */

function loadSaved(): Saved {
  const base: Saved = { mode: "speak", texts: { speak: "", dialogue: "" }, voice: DEFAULT_VOICE, pace: 1, cast: {} };
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return base;
    const s = JSON.parse(raw) as Partial<Saved>;
    return {
      mode: s.mode === "dialogue" ? "dialogue" : "speak",
      texts: { speak: String(s.texts?.speak ?? "").slice(0, MAX_CHARS), dialogue: String(s.texts?.dialogue ?? "").slice(0, MAX_CHARS) },
      voice: typeof s.voice === "string" && isVoiceId(s.voice) ? s.voice : DEFAULT_VOICE,
      pace: typeof s.pace === "number" && s.pace >= 0.7 && s.pace <= 1.3 ? s.pace : 1,
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
let clips: Clip[] = [];
let spans: HTMLElement[] = [];
let raf = 0;
let runToken = 0;

interface PlanItem extends Segment {
  speaker?: string;
  turn: number;
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
  for (const gender of ["Female", "Male"] as const) {
    const group = document.createElement("optgroup");
    group.label = gender;
    for (const v of VOICES.filter((x) => x.gender === gender)) {
      const o = document.createElement("option");
      o.value = v.id;
      o.textContent = `${v.name} · ${v.accent} · ${v.tone}`;
      group.append(o);
    }
    select.append(group);
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

/* ---------- plan ---------- */

function buildPlan(): PlanItem[] {
  const pace = state.pace;
  if (state.mode === "speak") {
    return toChunks(els.text.value).map((c) => ({ text: c.text, pauseMs: c.pauseMs, voice: state.voice, speed: pace, turn: 0 }));
  }
  const { lines, speakers } = parseScript(els.text.value);
  state.cast = autoAssignVoices(speakers, state.cast);
  const items: PlanItem[] = [];
  lines.forEach((line, turn) => {
    const chunks = toChunks(line.text);
    chunks.forEach((c, i) => {
      const last = i === chunks.length - 1;
      items.push({
        text: c.text,
        // A beat of silence when the speaker changes keeps exchanges from feeling clipped.
        pauseMs: last && turn < lines.length - 1 ? Math.max(c.pauseMs, 520) : c.pauseMs,
        voice: state.cast[line.speaker] ?? DEFAULT_VOICE,
        speed: pace,
        speaker: line.speaker,
        turn,
      });
    });
  });
  return items;
}

/* ---------- stage (read-along view) ---------- */

function renderStage() {
  els.stage.replaceChildren();
  spans = [];
  let turnEl: HTMLElement | null = null;
  let turnId = -1;
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
      els.stage.append(turnEl);
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
}

function seekTo(i: number) {
  const clip = clips[i];
  if (!clip) return;
  player.seek(clip.start);
  if (player.state !== "playing") player.toggle();
}

function showStage(show: boolean) {
  transition(() => {
    els.stage.hidden = !show;
    els.editor.hidden = show;
    els.edit.hidden = !show;
  });
}

function tick() {
  const pos = player.position;
  let active = -1;
  for (let i = 0; i < clips.length; i++) {
    if (clips[i]!.start <= pos + 0.02) active = i;
    else break;
  }
  const st = player.state;
  const live = st === "playing" || st === "paused";
  spans.forEach((s, i) => {
    const ready = i < clips.length;
    s.classList.toggle("pending", !ready);
    s.classList.toggle("active", live && i === active);
    s.classList.toggle("played", ready && (st === "ended" || (live && i < active)));
    if (ready && s.tabIndex !== 0) s.tabIndex = 0;
  });
  if (st === "playing" && active !== lastActive) {
    lastActive = active;
    const el = spans[active];
    if (el) el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  raf = requestAnimationFrame(tick);
}
let lastActive = -1;

/* ---------- actions ---------- */

function resetAudio() {
  player.stop();
  clips = [];
  plan = [];
  spans = [];
  cancelAnimationFrame(raf);
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
  plan = buildPlan();
  if (plan.length === 0) {
    setStatus("Nothing speakable found. Add some words.", "error");
    return;
  }
  els.load.hidden = true;
  string.strum(0.5, 1);
  renderStage();
  showStage(true);
  setPhase("loading");
  setStatus(engine.device ? "Starting…" : "Preparing the voice engine…");
  try {
    await player.begin();
    string.setAnalyser(player.analyserNode);
    await engine.load();
    if (token !== runToken) return;
  } catch (e) {
    if (token !== runToken) return;
    failed(e instanceof Error ? e.message : "The voice engine failed to start. Reload the page and try again.");
    return;
  }
  els.load.hidden = true;
  setPhase("generating");
  setStatus("Speaking…");
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
  let sawFirst = false;
  await engine.generate(plan, {
    onClip(clip, done, total) {
      if (token !== runToken) return;
      clips.push(clip);
      player.add(clip);
      if (!sawFirst) {
        sawFirst = true;
        els.play.disabled = false;
        els.play.dataset.playing = "true";
      }
      setStatus(done < total ? `Speaking · ${done} of ${total} sentences ready` : "Finishing…");
    },
    onDone() {
      player.finish();
      setPhase("ready");
      els.save.disabled = false;
      setStatus(`Ready · ${fmt(player.duration)}`);
    },
    onCancel() {
      player.finish();
      setPhase(clips.length ? "ready" : "idle");
      els.save.disabled = clips.length === 0;
      setStatus(clips.length ? `Stopped · ${fmt(player.duration)} generated` : "");
      if (!clips.length) showStage(false);
    },
    onError(message) {
      failed(message);
    },
  }).catch((e: unknown) => failed(e instanceof Error ? e.message : "Speech generation stopped unexpectedly. Try again."));
}

function failed(message: string) {
  player.cancelGeneration();
  const hadAudio = clips.length > 0;
  setPhase(hadAudio ? "ready" : "idle");
  els.save.disabled = !hadAudio;
  els.load.hidden = true;
  setStatus(message, "error");
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

function save() {
  if (!player.hasAudio) return;
  const blob = new Blob([encodeWav(player.render(), SAMPLE_RATE)], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const a = document.createElement("a");
  a.href = url;
  a.download = `voltune-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.wav`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  setStatus("Saved as a WAV file.");
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
    if (phase === "loading" || phase === "generating") engine.cancel();
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
  els.pace.addEventListener("input", () => {
    state.pace = Number(els.pace.value);
    els.paceOut.textContent = `${state.pace.toFixed(2)}×`;
    updateCount();
    persist();
  });
  els.speak.addEventListener("click", () => void speak());
  els.edit.addEventListener("click", editText);
  els.save.addEventListener("click", save);
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

  window.addEventListener("resize", placeInk);
  document.fonts?.ready.then(placeInk);
  // One orchestrated moment on arrival: pluck the string once.
  window.setTimeout(() => string.strum(0.38, 0.9), 450);
  window.addEventListener("beforeunload", () => engine.cancel());
}

init();
