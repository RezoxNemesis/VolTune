/**
 * English words that Hindi speakers use every day, in the Devanagari spelling a Hindi reader expects.
 * The studio model reads a Hindi line best when it is all in one script; these cover the common
 * Hinglish loanwords, and any other English word is left as written.
 */
const WORDS: Record<string, string> = {
  please: "प्लीज़", plz: "प्लीज़", sorry: "सॉरी", thanks: "थैंक्स", thank: "थैंक", you: "यू", okay: "ओके", ok: "ओके", yes: "यस", no: "नो",
  hello: "हेलो", hi: "हाय", bye: "बाय", good: "गुड", morning: "मॉर्निंग", night: "नाइट", welcome: "वेलकम", sir: "सर", madam: "मैडम", boss: "बॉस",
  train: "ट्रेन", station: "स्टेशन", platform: "प्लेटफ़ॉर्म", ticket: "टिकट", bus: "बस", car: "कार", bike: "बाइक", road: "रोड", taxi: "टैक्सी", auto: "ऑटो",
  phone: "फ़ोन", mobile: "मोबाइल", call: "कॉल", message: "मैसेज", video: "वीडियो", photo: "फ़ोटो", selfie: "सेल्फ़ी", internet: "इंटरनेट", laptop: "लैपटॉप", computer: "कंप्यूटर",
  school: "स्कूल", college: "कॉलेज", class: "क्लास", exam: "एग्ज़ाम", test: "टेस्ट", teacher: "टीचर", homework: "होमवर्क", office: "ऑफ़िस", job: "जॉब", meeting: "मीटिंग",
  doctor: "डॉक्टर", hospital: "हॉस्पिटल", medicine: "मेडिसिन", police: "पुलिस", party: "पार्टी", birthday: "बर्थडे", gift: "गिफ़्ट", cake: "केक", surprise: "सरप्राइज़", plan: "प्लान",
  love: "लव", happy: "हैप्पी", sad: "सैड", friend: "फ़्रेंड", friends: "फ़्रेंड्स", family: "फ़ैमिली", baby: "बेबी", mummy: "मम्मी", daddy: "डैडी", uncle: "अंकल", aunty: "आंटी",
  time: "टाइम", minute: "मिनट", minutes: "मिनट", second: "सेकंड", hour: "घंटा", week: "वीक", weekend: "वीकेंड", date: "डेट", late: "लेट", sure: "श्योर",
  really: "रियली", actually: "एक्चुअली", seriously: "सीरियसली", exactly: "एग्ज़ैक्टली", basically: "बेसिकली", problem: "प्रॉब्लम", tension: "टेंशन", chance: "चांस", idea: "आइडिया",
  team: "टीम", match: "मैच", game: "गेम", movie: "मूवी", film: "फ़िल्म", song: "सॉन्ग", music: "म्यूज़िक", dance: "डांस", room: "रूम", house: "हाउस",
  market: "मार्केट", shop: "शॉप", money: "मनी", card: "कार्ड", bank: "बैंक", hotel: "होटल", restaurant: "रेस्टोरेंट", dinner: "डिनर", lunch: "लंच", breakfast: "ब्रेकफ़ास्ट",
  coffee: "कॉफ़ी", tea: "टी", ice: "आइस", cream: "क्रीम", chocolate: "चॉकलेट", first: "फ़र्स्ट", last: "लास्ट", next: "नेक्स्ट", best: "बेस्ट", life: "लाइफ़",
  wow: "वाओ", super: "सुपर", cool: "कूल", nice: "नाइस", perfect: "परफ़ेक्ट", special: "स्पेशल", promise: "प्रॉमिस", miss: "मिस", sweet: "स्वीट", dear: "डियर",
};

/** Replace the common English words in a Hindi line with their Devanagari spelling. */
export function devanagariLoanwords(text: string): string {
  return text.replace(/[A-Za-z]+(?:'[a-z]+)?/g, (w) => WORDS[w.toLowerCase()] ?? w);
}
