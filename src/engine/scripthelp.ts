/** The script language VolTune understands, in one place for the app's tips, the CLI and Claude. */
export const SCRIPT_HELP = `# VolTune script syntax

## Speakers
- \`Maya: Hello.\`  ·  \`[Maya] Hello.\`  ·  screenplay style (a NAME in capitals on its own line, speech below).
- Mood on the label: \`Maya (whispering): Come here.\`  ·  \`[Maya, angry] Stop!\`  ·  \`[Maya|excited] We won!\`
- Lines without a label continue the previous speaker; text before any speaker is the Narrator.

## Choosing voices inside the script
- \`@Maya = Teen girl\`  ·  \`@Jon = am_michael, pitch -1, speed 0.95\`  ·  \`@Ghost = af_sky*0.6+am_onyx*0.4, pitch -2\`
- A voice can be a stock id, a blend (\`id*weight+id*weight\`), a preset name or a saved custom voice's name.

## Learned voices (Hindi and Hinglish)
- Shayar, Kahani, Noor, Josh, Chhotu, Gudiya, Dev, Papa, Sur and Sargam (ids \`hm_shayar\`, \`hf_noor\`, …) carry a
  delivery learned from real narrators: their own rhythm, melody and pauses. Shayar and Dev pause at every comma
  and line break, like poetry is read. Hinglish in Latin letters ("Papa, aap rona mat") is read as Hindi.

## Directions (inline, in (), [] or *…*)
- Emotions the voice itself acts (learned, for every voice): happy, excited, sad, crying, angry, scared,
  loving (tenderly, pyaar se), surprised, serious, tired, pleading. Hindi and Hinglish work too:
  (udaas) (rote hue) (gusse mein) (khush) (darte hue) (pyaar se) (hairan) (thaka hua) (gidgida kar), or in Devanagari.
- Other moods: whisper, softly, shout, laughing, nervous (adds a stammer), calm, sarcastic, confident,
  mysterious, curious, slowly, quickly. Strength: "a bit angry", "very excited". Marks combine:
  "(crying, whispering)". A mood lasts until the line ends or \`(normal)\`.
- Sounds, spoken in the character's voice: (laughs) (chuckles) (giggles) (sighs) (gasps) (groans)
  (clears throat) (hmm) (sniffs) (coughs) (screams) (yawns) (wow).
- Timing: \`(pause)\` \`(beat)\` \`(long pause)\` \`[pause 2s]\` \`[pause 400ms]\`.
- Anything else in brackets, like \`(looks away)\`, is treated as an action and not read aloud.

## Structure
- \`---\` on its own line is a scene break (a longer silence).
- \`# note\` or \`// note\` lines are comments and are skipped.
`;
