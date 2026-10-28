/**
 * VolTune connector: an MCP server over streamable HTTP so Claude can design voices and perform
 * scripts with VolTune's engine, then hand back WAV files, timelines and lip-sync tracks.
 *
 *   PORT=7860 node dist/mcp.js
 *
 * Open /setup once to see the private connector URL (…/mcp/<token>), or set VOLTUNE_TOKEN yourself.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, createReadStream } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { Engine, dataDir, lipSync, wavBytes, type Rendered } from "./engine";
import { catalogue, createVoice, deleteVoice, importVoice, loadCustoms, voiceCode } from "./voices";
import { SCRIPT_HELP } from "../../src/engine/scripthelp";
import { BASE_VOICES } from "../../src/engine/voicebank";

const PORT = Number(process.env.PORT) || 7860;
const KEEP_RENDERS = Number(process.env.VOLTUNE_KEEP) || 200;
const MAX_CHARS = Number(process.env.VOLTUNE_MAX_CHARS) || 12_000;

mkdirSync(dataDir(), { recursive: true });
const rendersDir = path.join(dataDir(), "renders");
mkdirSync(rendersDir, { recursive: true });

function loadToken(): string {
  if (process.env.VOLTUNE_TOKEN) return process.env.VOLTUNE_TOKEN;
  const f = path.join(dataDir(), "token");
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  const t = randomBytes(24).toString("base64url");
  writeFileSync(f, t, { mode: 0o600 });
  return t;
}
const TOKEN = loadToken();
const claimedFile = path.join(dataDir(), "claimed");

const sameToken = (t: string) => {
  const a = Buffer.from(t);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
};

const engine = new Engine((s) => console.log(s));
// One render at a time: the model is CPU-bound and shares one session.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

function prune() {
  const files = readdirSync(rendersDir)
    .filter((f) => f.endsWith(".wav"))
    .map((f) => ({ f, t: statSync(path.join(rendersDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(KEEP_RENDERS)) {
    for (const ext of [".wav", ".json"]) {
      try {
        unlinkSync(path.join(rendersDir, f.replace(/\.wav$/, ext)));
      } catch {
        /* already gone */
      }
    }
  }
}

function baseUrl(req: IncomingMessage): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0]!.trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? `localhost:${PORT}`);
  return `${proto}://${host}`;
}

async function saveRender(r: Rendered, base: string, fps: number) {
  const id = `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const wav = wavBytes(r);
  writeFileSync(path.join(rendersDir, `${id}.wav`), wav);
  const sync = lipSync(r, fps);
  writeFileSync(path.join(rendersDir, `${id}.json`), JSON.stringify({ timeline: r.timeline, cast: r.cast, lipsync: sync }));
  prune();
  return {
    id,
    wav,
    audio_url: `${base}/files/${TOKEN}/${id}.wav`,
    data_url: `${base}/files/${TOKEN}/${id}.json`,
    seconds: Math.round((r.pcm.length / r.sampleRate) * 100) / 100,
  };
}

const json = (o: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(o, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] });

function buildServer(base: string): McpServer {
  const server = new McpServer(
    { name: "voltune", version: "1.0.0" },
    {
      instructions:
        "VolTune turns scripts into acted, multi-voice audio. Call script_help once to learn the script syntax (speakers, moods like (whispering), sounds like (laughs), [pause 2s], @Name = voice lines). " +
        "Design character voices with create_voice (blend stock voices, shift pitch), then perform_script to get a WAV URL plus a per-line timeline and lip-sync tracks for animation. " +
        "Every custom voice has a VT1 code the person can paste into the VolTune app (Voice Lab → Import) to get the identical voice there.",
    },
  );

  server.registerTool(
    "script_help",
    { title: "Script syntax", description: "How to write VolTune scripts: speakers, moods, sounds, pauses, scene breaks and in-script voice choices.", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => ({ content: [{ type: "text", text: SCRIPT_HELP }] }),
  );

  server.registerTool(
    "list_voices",
    {
      title: "List voices",
      description: "Stock Kokoro voices, built-in character presets (Teen boy, Villain, Grandma…) and saved custom voices, with their recipes and share codes.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => json(catalogue()),
  );

  server.registerTool(
    "create_voice",
    {
      title: "Create a voice",
      description:
        `Design and save a character voice by blending stock voices and shifting pitch/pace. Saving under an existing name replaces it. Stock voices: ${BASE_VOICES.join(", ")}. ` +
        "Tips: blend two voices of the same accent; +2…+4 semitones reads younger, −1…−3 older or menacing; speed 0.9 is measured, 1.1 lively.",
      inputSchema: {
        name: z.string().min(1).max(40).describe("Display name, also usable in scripts: @Hero = <name>"),
        mix: z.string().describe('Blend, e.g. "am_puck*0.6+am_michael*0.4", or one stock id'),
        pitch: z.number().min(-6).max(6).optional().describe("Semitones, default 0"),
        speed: z.number().min(0.7).max(1.4).optional().describe("Pace multiplier, default 1"),
        gender: z.enum(["Female", "Male"]).optional(),
        accent: z.enum(["US", "UK", "India"]).optional(),
        tone: z.string().max(60).optional().describe('Short description, e.g. "gravelly old sailor"'),
        preview_text: z.string().max(400).optional().describe("If given, also render this line in the new voice"),
      },
    },
    async (a) => {
      try {
        const v = createVoice(a);
        const out: Record<string, unknown> = { voice: v, code: voiceCode(v.id), use_in_script: `@Character = ${v.name}` };
        if (a.preview_text) {
          const r = await serial(() => engine.render(a.preview_text!, { mode: "speak", voice: v.id, customs: loadCustoms() }));
          const s = await saveRender(r, base, 30);
          out.preview = { audio_url: s.audio_url, seconds: s.seconds };
        }
        return json(out);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "import_voice",
    { title: "Import a voice code", description: "Save a voice from a VT1 code copied out of the VolTune app (Voice Lab → Copy code).", inputSchema: { code: z.string().startsWith("VT1.") } },
    async ({ code }) => {
      try {
        return json(importVoice(code));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_voice_code",
    { title: "Get a voice code", description: "The VT1 code for any voice, to paste into the VolTune app or website so it sounds identical there.", inputSchema: { voice: z.string() }, annotations: { readOnlyHint: true } },
    async ({ voice }) => {
      try {
        return json({ voice, code: voiceCode(voice) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_voice",
    { title: "Delete a custom voice", description: "Remove a saved custom voice by id or name. Presets cannot be deleted.", inputSchema: { voice: z.string() }, annotations: { destructiveHint: true } },
    async ({ voice }) => json({ deleted: deleteVoice(voice) }),
  );

  const renderShape = {
    pace: z.number().min(0.6).max(1.5).optional().describe("Overall speaking rate, default 1"),
    rhythm: z.number().min(0.5).max(2).optional().describe("Pause length multiplier, default 1"),
    lipsync_fps: z.number().int().min(10).max(60).optional().describe("Frame rate for the lip-sync tracks, default 30"),
    include_audio: z.boolean().optional().describe("Also return the WAV inline as an audio block (large). Default false: use audio_url."),
  };

  async function respond(r: Rendered, a: { lipsync_fps?: number; include_audio?: boolean }) {
    const s = await saveRender(r, base, a.lipsync_fps ?? 30);
    const body = {
      audio_url: s.audio_url,
      timeline_and_lipsync_url: s.data_url,
      seconds: s.seconds,
      cast: r.cast,
      lines: r.timeline.map((l) => ({ speaker: l.speaker, text: l.text, start: l.start, end: l.end, ...(l.tags ? { delivery: l.tags } : {}) })),
    };
    const content: Array<{ type: "text"; text: string } | { type: "audio"; data: string; mimeType: string }> = [{ type: "text", text: JSON.stringify(body, null, 2) }];
    if (a.include_audio) content.push({ type: "audio", data: Buffer.from(s.wav).toString("base64"), mimeType: "audio/wav" });
    return { content };
  }

  server.registerTool(
    "perform_script",
    {
      title: "Perform a script",
      description:
        "Render a multi-character script to one WAV with acted delivery. Returns the audio URL, per-line start/end times, and a JSON URL with lip-sync (mouth openness per frame, per speaker) for animation. Call script_help for the syntax.",
      inputSchema: {
        script: z.string().min(1).max(MAX_CHARS),
        cast: z.record(z.string(), z.string()).optional().describe('Voices per speaker, e.g. {"Maya":"Teen girl","Jon":"am_michael"}; @Name lines in the script take priority'),
        ...renderShape,
      },
    },
    async (a) => {
      try {
        const r = await serial(() => engine.render(a.script, { mode: "dialogue", cast: a.cast ?? {}, speed: a.pace, pauseScale: a.rhythm, customs: loadCustoms() }));
        return await respond(r, a);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "speak",
    {
      title: "Speak text",
      description: "Read plain text (narration, a voice-over) in one voice. Inline directions like (softly) or [pause 1s] still work.",
      inputSchema: { text: z.string().min(1).max(MAX_CHARS), voice: z.string().optional().describe("Stock id, blend, preset or custom voice name; default af_heart"), ...renderShape },
    },
    async (a) => {
      try {
        const r = await serial(() => engine.render(a.text, { mode: "speak", voice: a.voice, speed: a.pace, pauseScale: a.rhythm, customs: loadCustoms() }));
        return await respond(r, a);
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > 2_000_000) throw new Error("Request too large");
    chunks.push(c as Buffer);
  }
  const s = Buffer.concat(chunks).toString("utf8");
  return s ? JSON.parse(s) : undefined;
}

function page(res: ServerResponse, status: number, html: string) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(`<!doctype html><meta name=viewport content="width=device-width"><title>VolTune connector</title><body style="font:16px system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5">${html}</body>`);
}

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const parts = url.pathname.split("/").filter(Boolean);
  try {
    if (parts[0] === "mcp" && parts[1] && sameToken(parts[1])) {
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST" }).end();
        return;
      }
      const body = await readBody(req);
      const server = buildServer(baseUrl(req));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }
    if (parts[0] === "files" && parts[1] && sameToken(parts[1]) && parts[2] && /^[\w-]+\.(wav|json)$/.test(parts[2])) {
      const f = path.join(rendersDir, parts[2]);
      if (!existsSync(f)) {
        res.writeHead(404).end("Expired or unknown file");
        return;
      }
      res.writeHead(200, {
        "content-type": f.endsWith(".wav") ? "audio/wav" : "application/json",
        "content-length": statSync(f).size,
        "content-disposition": `inline; filename="${parts[2]}"`,
        "access-control-allow-origin": "*",
      });
      createReadStream(f).pipe(res);
      return;
    }
    if (url.pathname === "/setup") {
      if (process.env.VOLTUNE_TOKEN) return page(res, 403, "<h1>VolTune connector</h1><p>The token comes from <code>VOLTUNE_TOKEN</code>. Your connector URL is <code>&lt;this address&gt;/mcp/&lt;VOLTUNE_TOKEN&gt;</code>.</p>");
      if (existsSync(claimedFile)) return page(res, 410, "<h1>Already set up</h1><p>The connector link was shown once. To see a new one, delete <code>token</code> and <code>claimed</code> in the data folder and restart, or set <code>VOLTUNE_TOKEN</code>.</p>");
      writeFileSync(claimedFile, new Date().toISOString());
      const link = `${baseUrl(req)}/mcp/${TOKEN}`;
      return page(
        res,
        200,
        `<h1>Your VolTune connector</h1><p>Add this as a custom connector in Claude (Settings → Connectors → Add custom connector). It is shown only once and works like a password.</p><p><input readonly value="${link}" style="width:100%;font:14px ui-monospace;padding:.6rem" onclick="this.select()"></p>`,
      );
    }
    if (url.pathname === "/" || url.pathname === "/health") {
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
        return;
      }
      return page(res, 200, `<h1>VolTune connector is running</h1><p>Open <a href="/setup">/setup</a> once to get your private connector link.</p>`);
    }
    res.writeHead(404).end("Not found");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
});

http.listen(PORT, () => {
  console.log(`VolTune connector on :${PORT}. Visit /setup once for the connector link.`);
  // Warm the model so the first request is quick.
  if (process.env.VOLTUNE_WARM !== "0") void serial(() => engine.render("Ready.", { mode: "speak" })).catch((e) => console.error("Warm-up failed:", e));
});
