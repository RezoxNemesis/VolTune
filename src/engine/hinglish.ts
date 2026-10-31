/**
 * Hinglish: Hindi written in Latin letters ("mera naam Rahul hai") mixed with English. For a Hindi
 * voice, the romanised Hindi words are turned into Devanagari, so they get the Hindi pronunciation,
 * and every other Latin word is spoken as English. Words that are also English words ("to", "the",
 * "me", "do", "hi", "is") are left out, so "I want to go" is never read as "I want तो go".
 */

export const ROMAN_HINDI: Readonly<Record<string, string>> = Object.freeze({
  mera: "मेरा", meri: "मेरी", mere: "मेरे", mujhe: "मुझे", mujhko: "मुझको", main: "मैं", mai: "मैं", hum: "हम", humara: "हमारा", hamara: "हमारा", hamein: "हमें",
  tum: "तुम", tumhara: "तुम्हारा", tumhe: "तुम्हें", tujhe: "तुझे", aap: "आप", aapka: "आपका", aapki: "आपकी", aapko: "आपको",
  woh: "वह", wo: "वो", yeh: "यह", ye: "ये", kya: "क्या", kyun: "क्यों", kyunki: "क्योंकि", kaise: "कैसे", kaisa: "कैसा", kaisi: "कैसी",
  kaun: "कौन", kahan: "कहाँ", kab: "कब", kitna: "कितना", kitne: "कितने", kitni: "कितनी", kuch: "कुछ", koi: "कोई", sab: "सब",
  hai: "है", hain: "हैं", hoon: "हूँ", hun: "हूँ", ho: "हो", tha: "था", thi: "थी", nahi: "नहीं", nahin: "नहीं",
  haan: "हाँ", han: "हाँ", ji: "जी", accha: "अच्छा", achha: "अच्छा", acha: "अच्छा", theek: "ठीक", thik: "ठीक",
  bahut: "बहुत", bohot: "बहुत", bahot: "बहुत", ek: "एक", teen: "तीन", ko: "को", ka: "का", ki: "की", ke: "के", se: "से",
  mein: "में", aur: "और", ya: "या", bhi: "भी", lekin: "लेकिन", abhi: "अभी", ab: "अब", aaj: "आज", kal: "कल",
  pyar: "प्यार", dost: "दोस्त", dosto: "दोस्तों", logon: "लोगों", zindagi: "ज़िंदगी", duniya: "दुनिया", paisa: "पैसा", paise: "पैसे",
  ghar: "घर", kaam: "काम", kar: "कर", karna: "करना", karo: "करो", karunga: "करूँगा", raha: "रहा", rahi: "रही", rahe: "रहे",
  chahiye: "चाहिए", jao: "जाओ", pani: "पानी", khana: "खाना", samajh: "समझ", samjha: "समझा", samjhe: "समझे", bolo: "बोलो",
  suno: "सुनो", dekho: "देखो", chalo: "चलो", bas: "बस", saath: "साथ", sath: "साथ", kaha: "कहा", bola: "बोला", ghanta: "घंटा",
  bura: "बुरा", achhe: "अच्छे", sach: "सच", jhooth: "झूठ", pehle: "पहले", baad: "बाद", phir: "फिर", kyon: "क्यों",
});

const WORD = /[A-Za-z]+/g;

/** Replace romanised Hindi words with Devanagari; every other word is left as it is. */
export function hinglishToDevanagari(text: string): string {
  return text.replace(WORD, (w) => ROMAN_HINDI[w.toLowerCase()] ?? w);
}
