/**
 * VolTune on Cloudflare: the website (static assets from dist/) plus a private MCP connector for
 * Claude, set up the same way as Reuz — open /setup once, copy the connector URL into Claude.
 *
 * Claude designs voices and writes scripts through the connector; they are stored here and show up
 * on the website automatically, where the speech itself is generated in the visitor's browser.
 */
import { DurableObject } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { buildPlan, lookupVoiceRef } from "../src/engine/plan";
import { parseScript } from "../src/engine/dialogue";
import { estimateSeconds } from "../src/engine/text";
import { SCRIPT_HELP } from "../src/engine/scripthelp";
import { VOICES } from "../src/engine/voices";
import {
  BASE_VOICES,
  PRESETS,
  decodeVoiceCode,
  describeRecipe,
  encodeVoiceCode,
  findVoice,
  isBaseVoice,
  isKnownVoiceRef,
  makeRecipe,
  parseMix,
  slug,
  type CustomVoice,
} from "../src/engine/voicebank";

interface Env {
  STUDIO: DurableObjectNamespace<Studio>;
  ASSETS: Fetcher;
}

export interface SavedScript {
  id: string;
  title: string;
  mode: "speak" | "dialogue";
  text: string;
  cast: Record<string, string>;
  voice?: string;
  pace: number;
  rhythm: number;
  voices: CustomVoice[];
  createdAt: number;
}

const MAX_SCRIPTS = 500;

/** One Durable Object holds the access token, Claude's voices and shared scripts. */
export class Studio extends DurableObject {
  async getToken(): Promise<string | null> {
    return (await this.ctx.storage.get<string>("mcpToken")) ?? null;
  }
  /** First visit only: create the token once. Later visits get nothing back. */
  async setupToken(): Promise<{ created: boolean; token?: string }> {
    if (await this.ctx.storage.get("mcpToken")) return { created: false };
    const token = randomId(32, "hex");
    await this.ctx.storage.put("mcpToken", token);
    return { created: true, token };
  }
  /** Replacing the token requires presenting the current one. */
  async rotateToken(presented: string): Promise<string | null> {
    const current = await this.ctx.storage.get<string>("mcpToken");
    if (!current || !sameSecret(presented, current)) return null;
    const token = randomId(32, "hex");
    await this.ctx.storage.put("mcpToken", token);
    return token;
  }

  async voices(): Promise<CustomVoice[]> {
    return (await this.ctx.storage.get<CustomVoice[]>("voices")) ?? [];
  }
  /**
   * Save by name: the same name replaces that voice and keeps its id (so casts that point at it still
   * work); a new name gets an id no other voice uses, even when names share a slug.
   */
  async saveVoice(v: Omit<CustomVoice, "id">): Promise<CustomVoice> {
    const list = await this.voices();
    const same = list.find((x) => x.name.toLowerCase() === v.name.toLowerCase());
    let id = same?.id ?? `st_${slug(v.name)}`;
    while (!same && list.some((x) => x.id === id)) id = `st_${slug(v.name)}_${randomId(3, "b62").toLowerCase()}`;
    const saved: CustomVoice = { ...v, id };
    await this.ctx.storage.put("voices", [...list.filter((x) => x.id !== id), saved]);
    return saved;
  }
  async deleteVoice(ref: string): Promise<boolean> {
    const list = await this.voices();
    const keep = list.filter((v) => v.id !== ref && v.name.toLowerCase() !== ref.trim().toLowerCase());
    await this.ctx.storage.put("voices", keep);
    return keep.length !== list.length;
  }

  async saveScript(s: SavedScript): Promise<void> {
    await this.ctx.storage.put(`script:${s.id}`, s);
    const all = await this.ctx.storage.list<SavedScript>({ prefix: "script:" });
    if (all.size > MAX_SCRIPTS) {
      const oldest = [...all.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt).slice(0, all.size - MAX_SCRIPTS);
      await this.ctx.storage.delete(oldest.map(([k]) => k));
    }
  }
  async getScript(id: string): Promise<SavedScript | null> {
    return (await this.ctx.storage.get<SavedScript>(`script:${id}`)) ?? null;
  }
  async listScripts(): Promise<Array<Pick<SavedScript, "id" | "title" | "createdAt">>> {
    const all = await this.ctx.storage.list<SavedScript>({ prefix: "script:" });
    return [...all.values()].sort((a, b) => b.createdAt - a.createdAt).map(({ id, title, createdAt }) => ({ id, title, createdAt }));
  }
}

function randomId(n: number, kind: "hex" | "b62"): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  if (kind === "hex") return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

/** Constant-time comparison so the token cannot be guessed by timing. */
function sameSecret(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · VolTune</title>
<style>:root{color-scheme:light dark;--bg:#dde5f4;--ink:#0e1a33;--muted:#55617a;--card:#f3f6fc;--line:rgba(14,26,51,.16);--accent:#3050ff}
@media(prefers-color-scheme:dark){:root{--bg:#070b17;--ink:#eaeefb;--muted:#9ba8c2;--card:#131b30;--line:rgba(255,255,255,.16);--accent:#93a6ff}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px;box-sizing:border-box}
main{max-width:640px;width:100%;background:var(--card);border:1px solid var(--line);border-radius:24px;padding:28px}
h1{font:400 34px/1.1 Georgia,serif;margin:0 0 12px}p{color:var(--muted)}a{color:var(--accent)}
code{display:block;word-break:break-all;background:var(--bg);border:1px solid var(--line);padding:14px;border-radius:12px;margin:14px 0;user-select:all;font:14px ui-monospace,Menlo,monospace;color:var(--ink)}
ol{padding-left:20px;color:var(--muted)}</style></head><body><main><h1>${esc(title)}</h1>${body}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer" } },
  );

/* ---------- MCP tools ---------- */

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });

function stockMeta(id: string) {
  const v = VOICES.find((x) => x.id === id);
  return {
    name: v?.name ?? id.slice(3).replace(/^./, (c) => c.toUpperCase()),
    gender: (v?.gender ?? (id[1] === "m" ? "Male" : "Female")) as CustomVoice["gender"],
    accent: (v?.accent ?? (id[0] === "b" ? "UK" : id[0] === "h" ? "India" : "US")) as CustomVoice["accent"],
    tone: v?.tone ?? "Stock voice",
  };
}

function codeFor(ref: string, customs: readonly CustomVoice[]): string {
  const v = findVoice(ref, customs);
  if (v) return encodeVoiceCode(v);
  if (isBaseVoice(ref)) return encodeVoiceCode({ ...stockMeta(ref), recipe: makeRecipe({ mix: [[ref, 1]] }) });
  throw new Error(`No voice called "${ref}". Call list_voices to see what exists.`);
}

/** What the planner makes of a script: who speaks, in which voice, how each line is delivered. */
function analyse(script: string, o: { mode: "speak" | "dialogue"; cast: Record<string, string>; voice?: string; pace: number; rhythm: number }, customs: CustomVoice[]) {
  const parsed = o.mode === "dialogue" ? parseScript(script) : null;
  const { items, cast } = buildPlan(script, { mode: o.mode, speed: o.pace, pauseScale: o.rhythm, voice: o.voice ?? "af_heart", cast: o.cast, customs });
  const warnings: string[] = [];
  if (parsed) {
    for (const [name, d] of Object.entries(parsed.cast)) {
      if (!isKnownVoiceRef(lookupVoiceRef(d.voice, customs), customs)) warnings.push(`@${name} = ${d.voice}: unknown voice, a default will be used.`);
    }
    for (const s of parsed.speakers) {
      if (!parsed.cast[s] && !o.cast[s]) warnings.push(`${s} has no chosen voice; auto-assigned ${cast[s]}. Add "@${s} = <voice>" to pick one.`);
    }
    if (!parsed.lines.length) warnings.push("No spoken lines found.");
  }
  const spoken = items.map((i) => i.text).join(" ");
  const seconds = Math.round(estimateSeconds(spoken, o.pace) + items.reduce((n, i) => n + i.pauseMs, 0) / 1000);
  const lines: Array<{ speaker: string; voice: string; delivery?: string[]; text: string }> = [];
  for (const it of items) {
    const prev = lines[lines.length - 1];
    const who = it.speaker ?? "Narrator";
    if (prev && prev.speaker === who && (it.turn === (items[items.indexOf(it) - 1]?.turn ?? -1))) {
      prev.text += ` ${it.text}`;
      for (const t of it.tags ?? []) if (!prev.delivery?.includes(t)) (prev.delivery ??= []).push(t);
    } else lines.push({ speaker: who, voice: describeVoice(it.voice, customs, cast[who]), ...(it.tags ? { delivery: [...it.tags] } : {}), text: it.text });
  }
  return { cast, seconds, lines, warnings };
}

function describeVoice(engineVoice: string, customs: readonly CustomVoice[], ref?: string): string {
  const v = ref ? findVoice(ref, customs) : undefined;
  return v ? `${v.name} (${describeRecipe(v.recipe)})` : (ref ?? engineVoice);
}

/** RPC results lose tuple types in transit; the stored data is exactly CustomVoice[]. */
const voicesOf = async (stub: DurableObjectStub<Studio>) => (await stub.voices()) as unknown as CustomVoice[];

function studioServer(stub: DurableObjectStub<Studio>, origin: string): McpServer {
  const server = new McpServer(
    { name: "VolTune", version: "1.0.0" },
    {
      instructions:
        "VolTune turns scripts into acted, multi-voice speech. Call script_help first for the script syntax (speakers, moods like (whispering), sounds like (laughs), [pause 2s], @Name = voice). " +
        "Design character voices with create_voice; they are saved to the person's VolTune website. Use check_script to see how a script will be performed, then share_script to get a link where the person hears it and downloads the WAV. " +
        "For animation: get_scene returns a script with its exact voice recipes; in an environment with the VolTune repo run `node server/dist/cli.js scene <bundle.json> -o out/` to get scene.wav, per-line WAVs, a timeline, lip-sync mouth tracks and an audio-quality report (pitch, pace, loudness, transcript check), then `avcheck` on the finished video.",
    },
  );

  server.registerTool("script_help", { description: "The VolTune script syntax: speakers, moods, performed sounds, pauses, scene breaks and in-script voice choices.", inputSchema: {} }, async () => text(SCRIPT_HELP));

  server.registerTool(
    "list_voices",
    { description: "Stock voices, built-in character presets and the custom voices saved on this VolTune site, with recipes and share codes.", inputSchema: {} },
    async () => {
      const customs = await voicesOf(stub);
      return text({
        studio: customs.map((v) => ({ name: v.name, id: v.id, gender: v.gender, accent: v.accent, tone: v.tone, recipe: describeRecipe(v.recipe), code: encodeVoiceCode(v) })),
        presets: PRESETS.map((v) => ({ name: v.name, id: v.id, gender: v.gender, accent: v.accent, tone: v.tone, recipe: describeRecipe(v.recipe) })),
        stock: VOICES.map((v) => ({ id: v.id, name: v.name, gender: v.gender, accent: v.accent, tone: v.tone })),
        other_stock_ids: BASE_VOICES.filter((id) => !VOICES.some((v) => v.id === id)),
      });
    },
  );

  server.registerTool(
    "create_voice",
    {
      description:
        `Design a character voice by blending stock voices and shifting pitch and pace, and save it to the VolTune site (it appears in the website's voice menus). Saving an existing name replaces it. Stock ids: ${BASE_VOICES.join(", ")}. ` +
        "Tips: blend voices of the same accent; +2…+4 semitones reads younger, −1…−3 older or menacing; speed 0.9 measured, 1.1 lively.",
      inputSchema: {
        name: z.string().min(1).max(40).describe("Display name; scripts use it as @Character = <name>"),
        mix: z.string().min(2).describe('Blend such as "am_puck*0.6+am_michael*0.4", or one stock id'),
        pitch: z.number().min(-6).max(6).optional().describe("Semitones, default 0"),
        speed: z.number().min(0.7).max(1.4).optional().describe("Pace multiplier, default 1"),
        gender: z.enum(["Female", "Male"]).optional(),
        accent: z.enum(["US", "UK", "India"]).optional(),
        tone: z.string().max(60).optional().describe('Short description, e.g. "gravelly old sailor"'),
      },
    },
    async (a) => {
      let mix;
      try {
        mix = parseMix(a.mix);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
      const meta = stockMeta(mix[0]![0]);
      const v: Omit<CustomVoice, "id"> = {
        name: a.name.trim(),
        gender: a.gender ?? meta.gender,
        accent: a.accent ?? meta.accent,
        tone: a.tone?.trim() || "Made by Claude",
        recipe: makeRecipe({ mix, pitch: a.pitch, speed: a.speed }),
      };
      await stub.saveVoice(v);
      return text({ saved: v.name, recipe: describeRecipe(v.recipe), code: encodeVoiceCode(v), use_in_script: `@Character = ${v.name}`, website: origin });
    },
  );

  server.registerTool(
    "import_voice",
    { description: "Save a voice from a VT1 code (copied from the VolTune app's Voice Lab).", inputSchema: { code: z.string().startsWith("VT1.") } },
    async ({ code }) => {
      try {
        const { id: _ignored, ...v } = decodeVoiceCode(code);
        const saved = (await stub.saveVoice(v)) as unknown as CustomVoice;
        return text({ saved: saved.name, recipe: describeRecipe(saved.recipe) });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool("get_voice_code", { description: "The VT1 code for any voice (stock, preset or saved), to paste into the VolTune app or a local render.", inputSchema: { voice: z.string().min(1) } }, async ({ voice }) => {
    try {
      return text({ voice, code: codeFor(voice, await voicesOf(stub)) });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  server.registerTool("delete_voice", { description: "Remove a saved voice by name or id. Presets and stock voices cannot be deleted.", inputSchema: { voice: z.string().min(1) } }, async ({ voice }) =>
    text({ deleted: await stub.deleteVoice(voice) }),
  );

  const scriptShape = {
    script: z.string().min(1).max(60_000),
    mode: z.enum(["dialogue", "speak"]).optional().describe("dialogue (default) for scripts with speakers, speak for narration in one voice"),
    cast: z.record(z.string(), z.string()).optional().describe('Voices per speaker, e.g. {"Maya":"Teen girl"}; @Name lines in the script win'),
    voice: z.string().optional().describe("Voice for speak mode"),
    pace: z.number().min(0.7).max(1.3).optional(),
    // The website offers exactly these three rhythms, so shared scripts play as reported.
    rhythm: z.union([z.literal(0.7), z.literal(1), z.literal(1.35)]).optional().describe("Pause length: 0.7 brisk, 1 natural, 1.35 relaxed"),
  };

  server.registerTool(
    "check_script",
    { description: "Show exactly how VolTune will perform a script: speakers, the voice each gets, per-line delivery (whisper, laughs…), estimated length and warnings. Use it to refine a script before sharing.", inputSchema: scriptShape },
    async (a) => {
      const customs = await voicesOf(stub);
      return text(analyse(a.script, { mode: a.mode ?? "dialogue", cast: a.cast ?? {}, voice: a.voice, pace: a.pace ?? 1, rhythm: a.rhythm ?? 1 }, customs));
    },
  );

  server.registerTool(
    "share_script",
    {
      description: "Save a script on the VolTune site and return a link that opens it ready to play, with its voices. The person presses Speak to hear it and Save audio to download the WAV.",
      inputSchema: { title: z.string().min(1).max(80), ...scriptShape },
    },
    async (a) => {
      const customs = await voicesOf(stub);
      const o = { mode: a.mode ?? ("dialogue" as const), cast: a.cast ?? {}, voice: a.voice, pace: a.pace ?? 1, rhythm: a.rhythm ?? 1 };
      const report = analyse(a.script, o, customs);
      const s: SavedScript = { id: randomId(12, "b62"), title: a.title, text: a.script, createdAt: Date.now(), voices: customs, ...o };
      await stub.saveScript(s);
      return text({ link: `${origin}/?script=${s.id}`, ...report });
    },
  );

  server.registerTool(
    "get_scene",
    {
      description:
        "Everything needed to render a shared script as audio files outside the browser: script text, cast, settings and the full voice recipes. Save the JSON to a file and run `node server/dist/cli.js scene <file> -o <folder>` in the VolTune repo to get scene.wav, per-line WAVs, a timeline, lip-sync tracks and an audio check, with the same voices the website plays. Without an id, returns the newest script.",
      inputSchema: { id: z.string().optional().describe("Script id or share link; default the newest") },
    },
    async ({ id }) => {
      const want = id?.replace(/^.*[?&]script=/, "").trim() || (await stub.listScripts())[0]?.id;
      const s = want ? ((await stub.getScript(want)) as unknown as SavedScript | null) : null;
      if (!s) return fail("No such script. Use share_script first, or list_scripts to see ids.");
      return text({ ...s, link: `${origin}/?script=${s.id}` });
    },
  );

  server.registerTool(
    "get_voices_bundle",
    { description: "All saved voices as a bundle (JSON) for local rendering with `voltune scene` or `voltune voice-import`, so animation audio uses the website's exact voices.", inputSchema: {} },
    async () => text({ voices: await voicesOf(stub) }),
  );

  server.registerTool("list_scripts", { description: "Scripts shared on this VolTune site, newest first, with their links.", inputSchema: {} }, async () =>
    text((await stub.listScripts()).map((s) => ({ ...s, link: `${origin}/?script=${s.id}`, created: new Date(s.createdAt).toISOString() }))),
  );

  return server;
}

/* ---------- routes ---------- */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const stub = env.STUDIO.getByName("main");

    if (url.pathname === "/setup") {
      const r = await stub.setupToken();
      if (!r.created) return page("Already set up", "<p>The connector URL was shown on the first visit. To replace it, open <b>/setup/reset?token=YOUR_CURRENT_TOKEN</b>.</p>", 409);
      const link = `${url.origin}/mcp/${r.token}`;
      return page(
        "VolTune is ready",
        `<p>This is your private connector URL. It is shown only once, so copy it now.</p><code>${esc(link)}</code>
<ol><li>In Claude, open <b>Settings → Connectors → Add custom connector</b>.</li><li>Name it <b>VolTune</b> and paste the URL above.</li><li>Ask Claude to make voices or perform a script. Voices it creates appear on <a href="/">your VolTune site</a>.</li></ol>
<p>To replace the URL later: <b>${esc(url.origin)}/setup/reset?token=YOUR_CURRENT_TOKEN</b></p>`,
      );
    }

    if (url.pathname === "/setup/reset") {
      const next = await stub.rotateToken(url.searchParams.get("token") ?? "");
      if (!next) return page("Not allowed", "<p>The current token is required to reset.</p>", 401);
      return page("New connector URL", `<p>Replace the old connector in Claude with this one. It is shown only once.</p><code>${esc(`${url.origin}/mcp/${next}`)}</code>`);
    }

    if (url.pathname.startsWith("/mcp/")) {
      const presented = url.pathname.slice("/mcp/".length);
      const current = await stub.getToken();
      if (!current) return json({ error: "Not set up yet. Open /setup once to create the connector URL." }, 503);
      if (!sameSecret(presented, current)) return json({ error: "Unauthorized" }, 401);
      return createMcpHandler(() => studioServer(stub, url.origin) as never, { route: url.pathname })(request, env as never, {} as never);
    }

    // Read-only data for the website: voices Claude made and shared scripts (by unguessable id).
    if (url.pathname === "/api/voices" && request.method === "GET") return json({ voices: await voicesOf(stub) });
    const sm = /^\/api\/scripts\/([A-Za-z0-9]{8,32})$/.exec(url.pathname);
    if (sm && request.method === "GET") {
      const s = await stub.getScript(sm[1]!);
      return s ? json(s) : json({ error: "Not found" }, 404);
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);

    return env.ASSETS.fetch(request);
  },
};
