/**
 * Reference lines for VolTune Studio. A voice is introduced to Chatterbox by a short clip of it acting
 * the wanted mood; these are the lines that clip says. The words fit the mood so Kokoro's own reading
 * of them already leans the right way, and Hindi lines agree with the speaker's gender.
 */

const HINDI: Record<string, string> = {
  neutral: "Aaj subah main jaldi {utha|uthi}, chai banayi aur khidki ke paas {baith gaya|baith gayi}. Bahar halki halki baarish ho rahi thi, aur hawa mein mitti ki khushboo thi.",
  happy: "Arre wah! Aaj toh kamaal ho gaya, mujhe sach mein yakeen nahi ho raha. Chalo, aaj sab milkar jashn manate hain!",
  excited: "Jaldi aao, jaldi aao! Dekho, humari team jeet gayi! Main kab se is pal ka intezaar kar {raha tha|rahi thi}!",
  sad: "Pata nahi kyun, aaj dil bahut bhaari hai. Sab kuch hote hue bhi, jaise kuch adhoora sa lagta hai.",
  crying: "Maine tumhe kitna samjhaya tha... kaash tum ek baar meri baat sun lete. Ab main kya karun, kuch samajh nahi aa raha.",
  angry: "Bas! Bahut ho gaya! Maine kitni baar kaha hai ki mujhse jhooth mat bolo. Ab ek shabd bhi nahi sunna mujhe!",
  scared: "Shh... kisi ke kadmon ki awaaz aa rahi hai. Lagta hai koi darwaze ke bilkul peeche khada hai. Mujhe bahut darr lag raha hai.",
  loving: "Tum meri zindagi ki sabse khoobsurat cheez ho. Jab tum muskurate ho, toh lagta hai sab kuch theek ho jayega.",
  surprised: "Kya? Tum yahan? Mujhe toh laga tha tum kal aaoge! Yeh toh sach mein bahut bada surprise hai!",
  serious: "Dhyaan se suno. Yeh kaam bahut zaroori hai, aur ismein koi galti nahi honi chahiye. Kal subah tak sab tayyar rehna chahiye.",
  tired: "Uff... aaj ka din bahut lamba tha. Poore din kaam karte karte ab toh aankhein band ho rahi hain.",
  pleading: "Please, meri baat ek baar sun lo. Main tumse haath jodkar vinti {karta|karti} hoon, mujhe ek aakhri mauka de do.",
};

const ENGLISH: Record<string, string> = {
  neutral: "This morning I woke up early, made a cup of tea and sat by the window. It was raining softly, and the air smelled of wet earth.",
  happy: "Oh wow, this is amazing! I honestly can't believe it worked out. Come on, let's all celebrate tonight!",
  excited: "Quick, come here, come here! Look, we actually won! I've been waiting for this moment forever!",
  sad: "I don't know why, but my heart feels so heavy today. Even with everything around me, something just feels missing.",
  crying: "I tried so hard to tell you... if only you had listened to me once. I don't know what to do anymore.",
  angry: "Enough! That's it! How many times have I told you not to lie to me? I don't want to hear another word!",
  scared: "Shh... did you hear those footsteps? I think someone is standing right behind the door. I'm really scared.",
  loving: "You are the most beautiful thing in my life. When you smile, it feels like everything is going to be okay.",
  surprised: "What? You're here? I thought you were coming tomorrow! This is such a huge surprise!",
  serious: "Listen carefully. This job matters, and there is no room for mistakes. Everything has to be ready by tomorrow morning.",
  tired: "Ugh... today was such a long day. I've been working since morning, and my eyes are closing on their own.",
  pleading: "Please, just hear me out one time. I'm begging you, give me one last chance to make this right.",
};

export const STUDIO_MOODS = Object.keys(ENGLISH);

/** The reference line for a voice language ("h" Hindi, otherwise English), mood and gender. */
export function referenceLine(lang: "a" | "b" | "h", mood: string | undefined, female: boolean): string {
  const set = lang === "h" ? HINDI : ENGLISH;
  const t = set[mood && set[mood] ? mood : "neutral"]!;
  return t.replace(/\{([^|}]*)\|([^}]*)\}/g, (_, m: string, f: string) => (female ? f : m));
}
