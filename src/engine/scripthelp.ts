/** The script language VolTune understands, in one place for the app's tips, the CLI and Claude. */
export const SCRIPT_HELP = `# VolTune script syntax

## Speakers
- \`Maya: Hello.\`  ·  \`[Maya] Hello.\`  ·  screenplay style (a NAME in capitals on its own line, speech below).
- Mood on the label: \`Maya (whispering): Come here.\`  ·  \`[Maya, angry] Stop!\`  ·  \`[Maya|excited] We won!\`
- Lines without a label continue the previous speaker; text before any speaker is the Narrator.

## Choosing voices inside the script
- \`@Maya = Teen girl\`  ·  \`@Jon = am_michael, pitch -1, speed 0.95\`  ·  \`@Ghost = af_sky*0.6+am_onyx*0.4, pitch -2\`
- A voice can be a stock id, a blend (\`id*weight+id*weight\`), a preset name or a saved custom voice's name.

## Directions (inline, in (), [] or *…*)
- Moods: whisper, softly, shout, angry, excited, laughing, sad, nervous (adds a stammer), scared, calm,
  serious, sarcastic, surprised, tired, confident, pleading, mysterious, curious, slowly, quickly.
  Strength: "a bit angry", "very excited". A mood lasts until the line ends or \`(normal)\`.
- Sounds, spoken in the character's voice: (laughs) (chuckles) (giggles) (sighs) (gasps) (groans)
  (clears throat) (hmm) (sniffs) (coughs) (screams) (yawns) (wow).
- Timing: \`(pause)\` \`(beat)\` \`(long pause)\` \`[pause 2s]\` \`[pause 400ms]\`.
- Anything else in brackets, like \`(looks away)\`, is treated as an action and not read aloud.

## Structure
- \`---\` on its own line is a scene break (a longer silence).
- \`# note\` or \`// note\` lines are comments and are skipped.
`;
