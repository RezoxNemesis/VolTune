/** voltune — render VolTune voices from a terminal. Run with no arguments for usage. */
import { readFileSync, writeFileSync } from "node:fs";
import { Engine, lipSync, wavBytes } from "./engine";
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

const USAGE = `voltune — render VolTune voices from a terminal.\n\n  voltune render script.txt -o scene.wav [--speak] [--voice af_heart] [--pace 1] [--rhythm 1]\n                            [--cast "Maya=Teen girl,Jon=am_michael"] [--json timeline.json] [--lipsync 30]\n  voltune say "Hello there" -o hi.wav [--voice "Teen boy"]\n  voltune voices                       list stock voices, presets and custom voices\n  voltune voice-create "Rusty" "am_fenrir*0.7+bm_george*0.3" [--pitch -1.5] [--speed 0.95] [--tone "gravelly"]\n  voltune voice-import VT1.xxxx        save a voice copied from the app\n  voltune voice-code "Rusty"           print a code to paste into the app (Voice Lab → Import)\n  voltune voice-delete "Rusty"\n  voltune help-script                  the script syntax`;

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
