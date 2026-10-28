/** voltune — render VolTune voices from a terminal. Run with no arguments for usage. */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Engine, lipSync, wavBytes } from "./engine";
import { analyse, avCheck, lipTrack, readWavFile, reportMarkdown, scenePicture, type TimelineLine } from "./analyze";
import { encodeWav } from "../../src/engine/audio";
import { encodeVoiceCode, type CustomVoice } from "../../src/engine/voicebank";
import { catalogue, createVoice, deleteVoice, importVoice, loadCustoms, voiceCode } from "./voices";
import { SCRIPT_HELP } from "../../src/engine/scripthelp";

function args(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--") || (a.startsWith("-") && a.length === 2 && isNaN(Number(a)))) {
      const k = a.replace(/^-+/, "");
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[k] = next;
        i++;
      } else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

function parseCast(s: string | true | undefined): Record<string, string> {
  if (typeof s !== "string") return {};
  return Object.fromEntries(
    s
      .split(/[,;]/)
      .map((p) => p.split("="))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k!.trim(), v!.trim()]),
  );
}

const USAGE = `voltune — render VolTune voices from a terminal.\n\n  voltune render script.txt -o scene.wav [--speak] [--voice af_heart] [--pace 1] [--rhythm 1]\n                            [--cast "Maya=Teen girl,Jon=am_michael"] [--json timeline.json] [--lipsync 30]\n  voltune say "Hello there" -o hi.wav [--voice "Teen boy"]\n  voltune voices                       list stock voices, presets and custom voices\n  voltune voice-create "Rusty" "am_fenrir*0.7+bm_george*0.3" [--pitch -1.5] [--speed 0.95] [--tone "gravelly"]\n  voltune voice-import VT1.xxxx        save a voice copied from the app\n  voltune voice-code "Rusty"           print a code to paste into the app (Voice Lab → Import)\n  voltune voice-delete "Rusty"\n  voltune help-script                  the script syntax\n\nFor animation:\n  voltune scene bundle.json -o out/    render a scene (bundle from the VolTune site, or a script file):\n                                       scene.wav, lines/*.wav, scene.json (timeline + voice codes),\n                                       lipsync.json (mouth open + shape per frame), spectrogram.png, report.md\n  voltune analyze audio.wav [--timeline scene.json] [-o dir]   pitch, pace, loudness, clarity (transcript), delivery checks\n  voltune avcheck video.mp4 --scene out/ [--mouth drawn.json]  audio offset/drift in the video and mouth-vs-speech match\n  voltune pull https://voltune.<you>.workers.dev [--script <id>] -o bundle.json`;

const num = (v: string | true | undefined, d: number) => (typeof v === "string" && !isNaN(Number(v)) ? Number(v) : d);

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = args(rest);
  const log = (s: string) => process.stderr.write(s + "\n");
  switch (cmd) {
    case "render":
    case "say": {
      const text = cmd === "say" ? pos.join(" ") : pos[0] === "-" || !pos[0] ? readFileSync(0, "utf8") : readFileSync(pos[0], "utf8");
      const out = typeof flags.o === "string" ? flags.o : typeof flags.out === "string" ? flags.out : "voltune.wav";
      const engine = new Engine(log);
      const t0 = Date.now();
      const r = await engine.render(
        text,
        {
          mode: cmd === "say" || flags.speak ? "speak" : "dialogue",
          voice: typeof flags.voice === "string" ? flags.voice : undefined,
          speed: num(flags.pace, 1),
          pauseScale: num(flags.rhythm, 1),
          cast: parseCast(flags.cast),
          customs: loadCustoms(),
        },
        (d, n) => process.stderr.write(`\r${d}/${n}`),
      );
      process.stderr.write("\n");
      writeFileSync(out, wavBytes(r));
      const meta = { file: out, seconds: Math.round((r.pcm.length / r.sampleRate) * 100) / 100, cast: r.cast, timeline: r.timeline, ...(flags.lipsync ? { lipsync: lipSync(r, num(flags.lipsync, 30)) } : {}) };
      if (typeof flags.json === "string") writeFileSync(flags.json, JSON.stringify(meta, null, 2));
      log(`Wrote ${out} (${meta.seconds}s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      if (!flags.json) console.log(JSON.stringify({ ...meta, lipsync: undefined }, null, 2));
      break;
    }
    case "scene": {
      // A scene bundle (from the VolTune site / connector: get_scene or share_script) or a plain script file.
      const src = pos[0];
      if (!src) throw new Error("Usage: voltune scene <bundle.json|script.txt> -o <folder>");
      const raw = src === "-" ? readFileSync(0, "utf8") : readFileSync(src, "utf8");
      let bundle: { title?: string; mode?: "speak" | "dialogue"; text?: string; script?: string; cast?: Record<string, string>; voice?: string; pace?: number; rhythm?: number; voices?: CustomVoice[] };
      try {
        bundle = JSON.parse(raw);
      } catch {
        bundle = { text: raw };
      }
      const text = bundle.text ?? bundle.script ?? "";
      const dir = typeof flags.o === "string" ? flags.o : "scene";
      mkdirSync(path.join(dir, "lines"), { recursive: true });
      const customs = [...loadCustoms().filter((c) => !(bundle.voices ?? []).some((v) => v.name.toLowerCase() === c.name.toLowerCase())), ...(bundle.voices ?? [])];
      const engine = new Engine(log);
      const fps = num(flags.fps, 30);
      const r = await engine.render(
        text,
        { mode: bundle.mode ?? (flags.speak ? "speak" : "dialogue"), voice: (flags.voice as string) ?? bundle.voice, speed: num(flags.pace, bundle.pace ?? 1), pauseScale: num(flags.rhythm, bundle.rhythm ?? 1), cast: { ...(bundle.cast ?? {}), ...parseCast(flags.cast) }, customs },
        (d, n) => process.stderr.write(`\rrendering ${d}/${n}`),
      );
      process.stderr.write("\n");
      writeFileSync(path.join(dir, "scene.wav"), wavBytes(r));
      r.timeline.forEach((l, i) => {
        const a = Math.round(l.start * r.sampleRate);
        const b = Math.round(l.end * r.sampleRate);
        writeFileSync(path.join(dir, "lines", `${String(i).padStart(2, "0")}_${(l.speaker ?? "Narrator").replace(/[^\w-]+/g, "_")}.wav`), new Uint8Array(encodeWav(r.pcm.subarray(a, b), r.sampleRate)));
      });
      const codes: Record<string, string> = {};
      for (const [who, ref] of Object.entries(r.cast)) {
        const v = customs.find((c) => c.id === ref || c.name.toLowerCase() === ref.toLowerCase());
        try {
          codes[who] = v ? encodeVoiceCode(v) : voiceCode(ref);
        } catch {
          codes[who] = ref;
        }
      }
      const seconds = Math.round((r.pcm.length / r.sampleRate) * 100) / 100;
      writeFileSync(path.join(dir, "scene.json"), JSON.stringify({ title: bundle.title ?? path.basename(dir), seconds, fps, cast: r.cast, voiceCodes: codes, timeline: r.timeline }, null, 2));
      writeFileSync(path.join(dir, "lipsync.json"), JSON.stringify(lipTrack(r.pcm, r.sampleRate, r.timeline, fps)));
      writeFileSync(path.join(dir, "spectrogram.png"), scenePicture(r.pcm, r.sampleRate, r.timeline));
      if (!flags["no-check"]) {
        log("checking the audio…");
        const rep = await analyse(r.pcm, r.sampleRate, r.timeline, { transcripts: !flags["no-asr"], log });
        writeFileSync(path.join(dir, "report.json"), JSON.stringify(rep, null, 2));
        writeFileSync(path.join(dir, "report.md"), reportMarkdown(rep));
        console.log(reportMarkdown(rep));
      }
      log(`Scene written to ${dir}/ (${seconds}s): scene.wav, lines/, scene.json, lipsync.json, spectrogram.png, report.md`);
      break;
    }
    case "analyze":
    case "analyse": {
      const file = pos[0];
      if (!file) throw new Error("Usage: voltune analyze <audio.wav> [--timeline scene.json] [-o folder]");
      const { pcm, sampleRate } = readWavFile(readFileSync(file));
      let timeline: TimelineLine[] | undefined;
      if (typeof flags.timeline === "string") timeline = (JSON.parse(readFileSync(flags.timeline, "utf8")) as { timeline: TimelineLine[] }).timeline;
      const rep = await analyse(pcm, sampleRate, timeline, { transcripts: !flags["no-asr"], log });
      if (typeof flags.o === "string") {
        mkdirSync(flags.o, { recursive: true });
        writeFileSync(path.join(flags.o, "report.json"), JSON.stringify(rep, null, 2));
        writeFileSync(path.join(flags.o, "report.md"), reportMarkdown(rep));
        writeFileSync(path.join(flags.o, "spectrogram.png"), scenePicture(pcm, sampleRate, timeline));
      }
      console.log(flags.json ? JSON.stringify(rep, null, 2) : reportMarkdown(rep));
      break;
    }
    case "avcheck": {
      const video = pos[0];
      const sceneArg = typeof flags.scene === "string" ? flags.scene : undefined;
      if (!video || !sceneArg) throw new Error("Usage: voltune avcheck <video.mp4> --scene <scene folder> [--mouth drawn-mouths.json]");
      const dir = existsSync(sceneArg) && statSync(sceneArg).isDirectory() ? sceneArg : path.dirname(sceneArg);
      const scene = JSON.parse(readFileSync(path.join(dir, "scene.json"), "utf8")) as { timeline: TimelineLine[] };
      const { pcm, sampleRate } = readWavFile(readFileSync(path.join(dir, "scene.wav")));
      const drawn = typeof flags.mouth === "string" ? (JSON.parse(readFileSync(flags.mouth, "utf8")) as { fps: number; tracks: Record<string, number[]> }) : undefined;
      console.log(JSON.stringify(avCheck(video, pcm, sampleRate, scene.timeline, drawn), null, 2));
      break;
    }
    case "pull": {
      // Fetch voices (and optionally a shared script) straight from a VolTune site, when the network allows.
      const site = (pos[0] ?? "").replace(/\/$/, "");
      if (!/^https?:\/\//.test(site)) throw new Error("Usage: voltune pull https://voltune.<you>.workers.dev [--script <id>] [-o bundle.json]");
      const voices = ((await (await fetch(`${site}/api/voices`)).json()) as { voices: CustomVoice[] }).voices ?? [];
      const id = typeof flags.script === "string" ? flags.script.replace(/^.*[?&]script=/, "") : undefined;
      const script = id ? await (await fetch(`${site}/api/scripts/${id}`)).json() : {};
      const bundle = { ...(script as object), voices: [...voices, ...((script as { voices?: CustomVoice[] }).voices ?? [])] };
      const out = typeof flags.o === "string" ? flags.o : "bundle.json";
      writeFileSync(out, JSON.stringify(bundle, null, 2));
      for (const v of voices) importVoice(encodeVoiceCode(v));
      log(`Saved ${out} with ${bundle.voices.length} voices${id ? " and the script" : ""}; voices also imported locally.`);
      break;
    }
    case "voices":
      console.log(JSON.stringify(catalogue(), null, 2));
      break;
    case "voice-create": {
      const [name, mix] = pos;
      if (!name || !mix) throw new Error('Usage: voltune voice-create "Name" "af_heart*0.6+am_puck*0.4" [--pitch 1] [--speed 1]');
      const v = createVoice({ name, mix, pitch: num(flags.pitch, 0), speed: num(flags.speed, 1), tone: typeof flags.tone === "string" ? flags.tone : undefined });
      console.log(JSON.stringify({ ...v, code: voiceCode(v.id) }, null, 2));
      break;
    }
    case "voice-import":
      console.log(JSON.stringify(importVoice(pos[0] ?? ""), null, 2));
      break;
    case "voice-code":
      console.log(voiceCode(pos.join(" ")));
      break;
    case "voice-delete":
      console.log(deleteVoice(pos.join(" ")) ? "Deleted." : "No such custom voice.");
      break;
    case "help-script":
      console.log(SCRIPT_HELP);
      break;
    default:
      console.log(USAGE);
  }
}

main().catch((e) => {
  process.stderr.write(`voltune: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
