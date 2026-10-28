/**
 * Voice Lab: design character voices by blending stock voices, shifting pitch and pace,
 * previewing, and sharing them as VT1 codes (the same codes Claude's VolTune connector uses).
 */
import { VOICES } from "../engine/voices";
import {
  PRESETS,
  decodeVoiceCode,
  describeRecipe,
  encodeVoiceCode,
  makeRecipe,
  slug,
  type CustomVoice,
  type Mix,
} from "../engine/voicebank";
import { SCRIPT_HELP } from "../engine/scripthelp";

const KEY = "voltune.voices";

export function loadCustoms(): CustomVoice[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as CustomVoice[];
    return Array.isArray(list) ? list.filter((v) => v && typeof v.id === "string" && Array.isArray(v.recipe?.mix)) : [];
  } catch {
    return [];
  }
}

function saveCustoms(list: CustomVoice[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: voices last for this visit only */
  }
}

/** Fill a <select> with presets, the person's voices and stock voices. */
export function fillVoiceSelect(select: HTMLSelectElement, selected: string, customs: readonly CustomVoice[]) {
  select.replaceChildren();
  const group = (label: string, items: Array<[string, string]>) => {
    if (!items.length) return;
    const g = document.createElement("optgroup");
    g.label = label;
    for (const [value, text] of items) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = text;
      g.append(o);
    }
    select.append(g);
  };
  group("My voices", customs.map((v) => [v.id, `${v.name} · ${v.tone}`]));
  group("Characters", PRESETS.map((v) => [v.id, `${v.name} · ${v.tone.replace(/^Character · |^Narration · /, "")}`]));
  for (const lang of ["en", "hi"] as const) {
    for (const gender of ["Female", "Male"] as const) {
      group(
        `${lang === "hi" ? "Hindi · हिन्दी" : "English"} · ${gender}`,
        VOICES.filter((x) => x.lang === lang && x.gender === gender).map((v) => [v.id, `${v.name} · ${v.accent} · ${v.tone}`]),
      );
    }
  }
  // A mix expression from a script or an older save: keep it selectable.
  if (selected && ![...select.options].some((o) => o.value === selected)) group("From script", [[selected, selected]]);
  select.value = selected;
}

export interface LabHost {
  /** Speak a short line in a voice recipe and play it. */
  preview(text: string, voice: CustomVoice): Promise<void>;
  /** Voices changed (saved, imported or deleted). */
  onChange(list: CustomVoice[]): void;
  toast(message: string, tone?: "info" | "error"): void;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string>) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
};

function stockSelect(id: string, allowNone: boolean): HTMLSelectElement {
  const s = h("select", { id });
  if (allowNone) s.append(h("option", { value: "" }, "None (single voice)"));
  for (const v of VOICES) s.append(h("option", { value: v.id }, `${v.name} · ${v.gender} · ${v.accent}`));
  return s;
}

function range(id: string, min: number, max: number, step: number, value: number): HTMLInputElement {
  return h("input", { id, type: "range", min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

let dialog: HTMLDialogElement | null = null;

export function openVoiceLab(host: LabHost) {
  dialog?.remove();
  let customs = loadCustoms();
  let editing: string | null = null;

  const name = h("input", { id: "lab-name", type: "text", maxlength: "40", placeholder: "e.g. Captain Rusty", autocomplete: "off" }) as HTMLInputElement;
  const a = stockSelect("lab-a", false);
  const b = stockSelect("lab-b", true);
  const blend = range("lab-blend", 0.1, 0.9, 0.05, 0.6);
  const pitch = range("lab-pitch", -6, 6, 0.5, 0);
  const pace = range("lab-pace", 0.7, 1.4, 0.05, 1);
  const tone = h("input", { id: "lab-tone", type: "text", maxlength: "60", placeholder: "Short description (optional)" }) as HTMLInputElement;
  const line = h("input", { id: "lab-line", type: "text", maxlength: "200", value: "Hey! You made it. I was starting to think you'd never show up." }) as HTMLInputElement;
  const blendOut = h("output", { for: "lab-blend" });
  const pitchOut = h("output", { for: "lab-pitch" });
  const paceOut = h("output", { for: "lab-pace" });
  const summary = h("p", { class: "lab-summary" });
  const list = h("div", { class: "lab-list" });
  const code = h("input", { type: "text", placeholder: "Paste a VT1… voice code", "aria-label": "Voice code", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;

  const field = (label: string, control: HTMLElement, out?: HTMLElement, wide = false) =>
    h("div", { class: `field${wide ? " wide" : ""}` }, h("label", { for: control.id }, label, ...(out ? [" ", out] : [])), control.tagName === "SELECT" ? h("div", { class: "select" }, control) : control);

  a.value = "af_heart";
  b.value = "";

  const current = (): CustomVoice => {
    const mix: Mix = b.value && b.value !== a.value ? [[a.value, Number(blend.value)], [b.value, 1 - Number(blend.value)]] : [[a.value, 1]];
    const first = VOICES.find((v) => v.id === a.value)!;
    const nm = name.value.trim() || "Untitled voice";
    return {
      id: editing ?? `my_${slug(nm)}_${Math.random().toString(36).slice(2, 6)}`,
      name: nm,
      gender: first.gender,
      accent: first.accent,
      tone: tone.value.trim() || "Custom",
      recipe: makeRecipe({ mix, pitch: Number(pitch.value), speed: Number(pace.value) }),
    };
  };

  const sync = () => {
    const pa = Math.round(Number(blend.value) * 100);
    blendOut.textContent = b.value ? `${pa}% / ${100 - pa}%` : "—";
    blend.disabled = !b.value;
    const p = Number(pitch.value);
    pitchOut.textContent = `${p > 0 ? "+" : ""}${p} st`;
    paceOut.textContent = `${Number(pace.value).toFixed(2)}×`;
    summary.textContent = describeRecipe(current().recipe);
  };

  const load = (v: CustomVoice, asCopy: boolean) => {
    editing = asCopy ? null : v.id;
    name.value = asCopy ? `${v.name} copy` : v.name;
    tone.value = v.tone.replace(/^Character · |^Narration · /, "");
    const [m0, m1] = v.recipe.mix;
    a.value = m0?.[0] ?? "af_heart";
    b.value = m1?.[0] ?? "";
    blend.value = String(m1 ? m0![1] : 0.6);
    pitch.value = String(v.recipe.pitch);
    pace.value = String(v.recipe.speed);
    sync();
    name.focus();
  };

  const renderList = () => {
    list.replaceChildren();
    const row = (v: CustomVoice) => {
      const actions = h("div", { class: "lab-row-actions" });
      const btn = (label: string, fn: () => void, extra = "") => {
        const el = h("button", { type: "button", class: `chip${extra}` }, label);
        el.addEventListener("click", fn);
        actions.append(el);
      };
      btn("Play", () => void host.preview(line.value || "Hello there.", v));
      btn(v.preset ? "Start from" : "Edit", () => load(v, !!v.preset));
      btn("Copy code", async () => host.toast((await copy(encodeVoiceCode(v))) ? `Code for “${v.name}” copied.` : encodeVoiceCode(v)));
      if (!v.preset)
        btn(
          "Delete",
          () => {
            customs = customs.filter((x) => x.id !== v.id);
            saveCustoms(customs);
            host.onChange(customs);
            if (editing === v.id) editing = null;
            renderList();
          },
          " danger",
        );
      return h("div", { class: "lab-row" }, h("div", {}, h("strong", {}, v.name), h("span", {}, describeRecipe(v.recipe))), actions);
    };
    if (customs.length) list.append(h("h3", {}, "My voices"), ...customs.map(row));
    list.append(h("h3", {}, "Characters"), ...PRESETS.map(row));
  };

  const save = () => {
    if (!name.value.trim()) {
      host.toast("Give the voice a name first.", "error");
      name.focus();
      return;
    }
    const v = current();
    customs = [...customs.filter((x) => x.id !== v.id && x.name.toLowerCase() !== v.name.toLowerCase()), v];
    editing = v.id;
    saveCustoms(customs);
    host.onChange(customs);
    renderList();
    host.toast(`Saved “${v.name}”. Use it in a script with @Name = ${v.name}`);
  };

  const importCode = () => {
    try {
      const v = decodeVoiceCode(code.value);
      customs = [...customs.filter((x) => x.name.toLowerCase() !== v.name.toLowerCase()), v];
      saveCustoms(customs);
      host.onChange(customs);
      renderList();
      code.value = "";
      host.toast(`Imported “${v.name}”.`);
    } catch (e) {
      host.toast(e instanceof Error ? e.message : "That code didn’t work.", "error");
    }
  };

  const button = (label: string, cls: string, fn: () => void) => {
    const el = h("button", { type: "button", class: `btn ${cls}` }, label);
    el.addEventListener("click", fn);
    return el;
  };

  const close = button("Close", "quiet", () => dialog?.close());
  const d = h(
    "dialog",
    { class: "lab glass", "aria-labelledby": "lab-title" },
    h("header", { class: "lab-head" }, h("h2", { id: "lab-title" }, "Voice Lab"), close),
    h(
      "div",
      { class: "lab-body" },
      h(
        "section",
        { class: "lab-edit", "aria-label": "Design a voice" },
        h("p", { class: "lab-intro" }, "Blend two voices, then shift pitch and pace. Saved voices appear in every voice menu and can be used in scripts."),
        h(
          "div",
          { class: "lab-grid" },
          field("Name", name, undefined, true),
          field("Voice A", a),
          field("Voice B", b),
          field("Blend", blend, blendOut),
          field("Pitch", pitch, pitchOut),
          field("Pace", pace, paceOut),
          field("Description", tone),
          field("Preview line", line, undefined, true),
        ),
        summary,
        h(
          "div",
          { class: "lab-actions" },
          button("Preview", "quiet", () => void host.preview(line.value || "Hello there.", current())),
          button("Copy code", "quiet", async () => {
            const c = encodeVoiceCode(current());
            host.toast((await copy(c)) ? "Voice code copied. Paste it into Claude or another device." : c);
          }),
          button("Save voice", "primary", save),
        ),
        h("div", { class: "lab-import" }, code, button("Import", "quiet", importCode)),
      ),
      h("section", { class: "lab-side", "aria-label": "Voices" }, list),
    ),
  ) as HTMLDialogElement;

  for (const el of [a, b, blend, pitch, pace, name, tone]) el.addEventListener("input", sync);
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  dialog = d;
  sync();
  renderList();
  d.showModal();
}

/** A compact, readable version of the script syntax for the Dialogue tab. */
export function scriptTips(): HTMLElement {
  const box = h("div", { class: "tips" });
  const body = SCRIPT_HELP.replace(/^# .*\n+/, "");
  for (const block of body.split(/\n(?=## )/)) {
    const [title, ...rest] = block.trim().split("\n");
    const ul = h("ul");
    for (const l of rest.join("\n").split(/\n- /)) {
      const text = l.replace(/^- /, "").replace(/\n\s+/g, " ").trim();
      if (!text) continue;
      const li = h("li");
      text.split(/(`[^`]+`)/).forEach((p) => li.append(p.startsWith("`") ? h("code", {}, p.slice(1, -1)) : p));
      ul.append(li);
    }
    box.append(h("h4", {}, title!.replace(/^## /, "")), ul);
  }
  return box;
}
