/**
 * Hinglish: Hindi typed in Latin letters, usually mixed with English ("kal meeting hai, tum aa rahe ho na?").
 * Words are recognised one by one (a lexicon of everyday Hindi, verb forms built from roots, then spelling rules),
 * turned into Devanagari, and from there read by the Hindi phoneme converter. English words stay English and can be
 * given Indian English sounds so one Hindi voice carries the whole line.
 */

import { isEnglishWord } from "./english_words";

/** Everyday Hindi in its common Latin spellings → Devanagari. "a|b=x" lists spelling variants. */
const LEX_SRC = `
si_h=सी
yaadon|yadon=यादों sunai|sunaai=सुनाई dikhai|dikhaai=दिखाई
pasand|pasandh=पसंद napasand|naapasand=नापसंद seeti|siti|seetee=सीटी gale=गले laga=लगा lagaa=लगा
yahin|yaheen|yahi_n=यहीं wahin|waheen|vahin=वहीं kahin|kaheen=कहीं gulab|gulaab=गुलाब aansoo|aanson|ansu=आँसू intezar=इंतज़ार platform_e=प्लेटफ़ॉर्म bitiya=बिटिया gudiya=गुड़िया laadli|ladli=लाडली
main|mai=मैं hum|ham=हम tum=तुम aap=आप tu=तू yeh|ye=ये woh|wo|vo|voh=वो ve=वे mera=मेरा meri=मेरी mere=मेरे hamara|humara=हमारा hamari|humari=हमारी hamare|humare=हमारे
tumhara|tumhaara=तुम्हारा tumhari=तुम्हारी tumhare=तुम्हारे aapka|apka=आपका aapki|apki=आपकी aapke|apke=आपके tera=तेरा teri=तेरी tere=तेरे uska=उसका uski=उसकी uske=उसके iska=इसका iski=इसकी iske=इसके
unka=उनका unki=उनकी unke=उनके inka=इनका inki=इनकी inke=इनके mujhe|mujhay=मुझे mujhko=मुझको mujhse=मुझसे mujh=मुझ tumhe|tumhein|tumhen=तुम्हें tumko=तुमको tumse=तुमसे tujhe=तुझे tujhko=तुझको tujhse=तुझसे tujh=तुझ
hume|humein|hamein|hamen=हमें humko|hamko=हमको humse|hamse=हमसे use|usse_k=उसे usko=उसको usse=उससे ise=इसे isko=इसको isse=इससे unhe|unhein|unhen=उन्हें unko=उनको unse=उनसे inhe|inhein=इन्हें inko=इनको inse=इनसे
aapko|apko=आपको aapse|apse=आपसे khud=खुद apna=अपना apni=अपनी apne=अपने koi=कोई kuch|kuchh=कुछ sab=सब sabhi=सभी kisi=किसी kisne=किसने kisko=किसको kiska=किसका kiski=किसकी kiske=किसके jo=जो jise=जिसे jiska=जिसका jiski=जिसकी jiske=जिसके jisne=जिसने
us=उस is_h=इस un=उन in_h=इन maine=मैंने humne|hamne=हमने tumne=तुमने aapne|apne_e=आपने usne=उसने unhone|unhonne=उन्होंने isne=इसने tune=तूने
hai=है hain=हैं hoon|hun|hu=हूँ ho=हो tha=था thi=थी the_h=थे thin|thee=थीं hoga=होगा hogi=होगी honge=होंगे hota=होता hoti=होती hote=होते hua=हुआ hui=हुई hue|huye=हुए hona=होना hokar=होकर hone=होने hun_n=हूँ
ka=का ki=की ke=के ko=को se=से me|mein|men=में par=पर pe=पे tak=तक ne=ने liye|liy|lie=लिए saath|sath=साथ baad|bad_h=बाद pehle|pahle|pehele=पहले upar|oopar=ऊपर neeche|niche=नीचे andar=अंदर bahar|baahar=बाहर paas|pas=पास door|dur=दूर
saamne|samne=सामने peeche|piche=पीछे beech|bich=बीच taraf=तरफ़ bina=बिना dwara=द्वारा wala|vala=वाला wali|vali=वाली wale|vale=वाले bare|baare=बारे jaisa=जैसा jaisi=जैसी jaise=जैसे waisa|vaisa=वैसा waise|vaise=वैसे aisa=ऐसा aisi=ऐसी aise=ऐसे kaisa=कैसा kaisi=कैसी kaise=कैसे
aur|or_h=और ya=या lekin=लेकिन magar=मगर par_b=पर kyunki|kyonki|kyuki=क्योंकि isliye|isiliye=इसलिए to|toh=तो bhi=भी hi_h=ही na|naa=ना nahi|nahin|nhi|nahee=नहीं mat=मत agar=अगर warna|varna=वरना phir|fir=फिर tab=तब jab=जब ab=अब abhi=अभी kabhi=कभी
tabhi=तभी jabhi=जभी yahan|yaha=यहाँ wahan|waha|vahan=वहाँ kahan|kaha=कहाँ jahan|jaha=जहाँ idhar=इधर udhar=उधर kidhar=किधर kya=क्या kyun|kyon|kyu=क्यों kab=कब kaun|kon=कौन kitna=कितना kitni=कितनी kitne=कितने kaunsa|konsa=कौनसा
haan|han|haa=हाँ ji|jee=जी achha|accha|acha|achchha=अच्छा achhi|acchi|achi=अच्छी achhe|acche|ache=अच्छे theek|thik|theekh=ठीक sahi=सही galat=ग़लत bahut|bohot|bahot|bhot=बहुत thoda|thora=थोड़ा thodi|thori=थोड़ी thode=थोड़े zyada|jyada|zyaada=ज़्यादा kam=कम
bada|bara=बड़ा badi|bari=बड़ी bade|bare_b=बड़े chhota|chota=छोटा chhoti|choti=छोटी chhote|chote=छोटे naya=नया nayi|nai=नई naye=नए purana=पुराना purani=पुरानी purane=पुराने lamba=लंबा lambi=लंबी sundar=सुंदर pyara|pyaara=प्यारा pyari|pyaari=प्यारी pyare=प्यारे
khush=ख़ुश udaas|udas=उदास pagal|paagal=पागल sachcha|sacha=सच्चा jhootha|jhutha=झूठा mushkil=मुश्किल aasan|asaan|aasaan=आसान zaroori|zaruri|jaruri=ज़रूरी tez=तेज़ dheere|dhire=धीरे jaldi=जल्दी der=देर poora|pura=पूरा poori|puri=पूरी aadha|adha=आधा khaali|khali=ख़ाली bhara=भरा
garam|garm=गरम thanda=ठंडा thandi=ठंडी meetha|mitha=मीठा teekha|tikha=तीखा saaf|saf=साफ़ ganda=गंदा gandi=गंदी accha_e=अच्छा bura=बुरा buri=बुरी bure=बुरे mast=मस्त zabardast|jabardast=ज़बरदस्त kamaal|kamal=कमाल shandar|shaandaar=शानदार bekar|bekaar=बेकार
har=हर aaj|aj=आज kal=कल parso|parson=परसों subah|subha=सुबह dopahar|dopeher=दोपहर shaam|sham=शाम raat|rat_h=रात din=दिन hafta=हफ़्ता mahina|maheena=महीना saal|sal=साल waqt|vaqt|wakt=वक़्त samay=समय ghanta=घंटा minat=मिनट pal=पल roz=रोज़ hamesha|humesha=हमेशा
kabhi_k=कभी aksar=अक्सर turant=तुरंत achanak=अचानक pichla=पिछला pichle=पिछले agla=अगला agle=अगले aajkal=आजकल
ghar=घर kamra=कमरा darwaza|darwaja=दरवाज़ा khidki=खिड़की rasta|raasta=रास्ता sadak=सड़क gaon|gaanv=गाँव shehar|shahar=शहर desh=देश duniya=दुनिया jagah=जगह dukaan|dukan=दुकान bazaar|bazar=बाज़ार school_h=स्कूल daftar=दफ़्तर mandir=मंदिर masjid=मस्जिद
paani|pani=पानी khana|khaana=खाना chai|chay=चाय doodh|dudh=दूध roti=रोटी chawal|chaval=चावल daal|dal=दाल sabzi|sabji=सब्ज़ी namak=नमक cheeni|chini=चीनी mithai=मिठाई phal=फल aam=आम
maa|ma=माँ papa=पापा pitaji=पिताजी mummy=मम्मी bhai=भाई behen|behan|bahan=बहन beta=बेटा beti=बेटी bachcha|bacha|baccha=बच्चा bachche|bache|bacche=बच्चे dost=दोस्त yaar|yar=यार dada=दादा dadi=दादी nana=नाना nani=नानी chacha=चाचा mama=मामा
pati=पति patni=पत्नी biwi=बीवी ladka|larka=लड़का ladki|larki=लड़की ladke|larke=लड़के ladkiyan=लड़कियाँ aadmi=आदमी aurat=औरत log=लोग insaan|insan=इंसान bhagwan|bhagvan=भगवान khuda=ख़ुदा allah=अल्लाह ram=राम sahab|saheb|sahib=साहब bhaiya=भैया didi=दीदी
dil=दिल pyaar|pyar=प्यार mohabbat|muhabbat=मोहब्बत ishq=इश्क़ zindagi|jindagi=ज़िंदगी jaan=जान sapna=सपना sapne=सपने yaad=याद yaadein|yaaden=यादें khushi=ख़ुशी gham|gam=ग़म dard=दर्द aansu=आँसू hansi=हँसी dua=दुआ kismat=क़िस्मत
umeed|ummeed=उम्मीद khwab|khwaab=ख़्वाब chand|chaand=चाँद suraj|sooraj=सूरज tara|taara=तारा taare|tare=तारे aasman|aasmaan|asmaan=आसमान zameen|zamin|jameen=ज़मीन hawa=हवा baarish|barish=बारिश badal|baadal=बादल phool=फूल rang=रंग roshni=रोशनी andhera=अँधेरा
aankh=आँख aankhen|aankhein=आँखें haath|hath=हाथ pair=पैर sar|sir_h=सिर muh|munh=मुँह baal=बाल chehra=चेहरा awaaz|awaz|aavaaz=आवाज़ naam=नाम kaam=काम baat=बात baatein|baaten=बातें cheez|chiz=चीज़ paisa=पैसा paise=पैसे rupaye|rupaiye=रुपये
sawaal|sawal=सवाल jawab|jawaab=जवाब matlab=मतलब wajah|vajah=वजह tarah=तरह tareeka|tarika=तरीक़ा madad=मदद zaroorat|zarurat|jarurat=ज़रूरत koshish=कोशिश galti=ग़लती sach=सच jhooth|jhuth=झूठ kahani=कहानी gaana|gana=गाना khel=खेल kitab|kitaab=किताब
safar=सफ़र manzil=मंज़िल raah=राह musafir=मुसाफ़िर dushman=दुश्मन jung=जंग jeet=जीत haar=हार taqat|taakat|takat=ताक़त himmat=हिम्मत darr|dar=डर gussa=ग़ुस्सा shanti|shaanti=शांति sukoon|sukun=सुकून junoon|junun=जुनून
ek=एक do_h=दो teen=तीन chaar|char=चार paanch|panch=पाँच chhe|chhah|cheh=छह saat=सात aath=आठ nau=नौ das=दस bees=बीस sau=सौ hazaar|hazar=हज़ार lakh|laakh=लाख crore|karod=करोड़ pehla|pahla=पहला doosra|dusra=दूसरा teesra|tisra=तीसरा dono=दोनों
namaste=नमस्ते namaskar=नमस्कार shukriya=शुक्रिया dhanyavaad|dhanyawad=धन्यवाद maaf|maf=माफ़ kripya=कृपया arey|arre|are_h=अरे oye=ओए chalo=चलो bas=बस shayad=शायद zaroor|zarur|jarur=ज़रूर bilkul=बिल्कुल sirf=सिर्फ़ bhai_e=भाई wah|waah=वाह
hey_h=हे suno=सुनो dekho=देखो ruko=रुको jao=जाओ aao=आओ lo=लो baitho=बैठो bolo=बोलो batao=बताओ karo=करो raho=रहो socho=सोचो samjho=समझो chhodo|chodo=छोड़ो pakdo=पकड़ो maaro|maro=मारो bhaago|bhago=भागो utho=उठो
gaya=गया gayi|gai=गई gaye|gae=गए aaya|aya=आया aayi|aai=आई aaye|aae=आए kiya=किया ki_v=की kiye=किए liya=लिया li=ली liye_v=लिए diya=दिया di=दी diye=दिए piya=पिया khaya=खाया khayi=खाई khaye=खाए soya=सोया roya=रोया
raha=रहा rahi=रही rahe=रहे rehna|rahna=रहना rehta|rahta=रहता rehti|rahti=रहती rehte|rahte=रहते sakta=सकता sakti=सकती sakte=सकते saka=सका saki=सकी chahiye|chaiye|chahie=चाहिए chahta|chaahta=चाहता chahti=चाहती chahte=चाहते chaha=चाहा
jana|jaana=जाना jata|jaata=जाता jati|jaati=जाती jate|jaate=जाते jaunga|jaaunga=जाऊँगा jaungi=जाऊँगी jayega|jaega|jaayega=जाएगा jayegi|jaegi=जाएगी jayenge|jaenge|jaayenge=जाएँगे jaoge|jaaoge=जाओगे jaogi=जाओगी jakar|jaakar=जाकर jaa|ja=जा jaye|jaaye=जाए
aana|ana=आना aata|ata=आता aati|ati=आती aate|ate_h=आते aaunga|aunga=आऊँगा aaungi=आऊँगी aayega|aega=आएगा aayegi|aegi=आएगी aayenge|aenge=आएँगे aaoge=आओगे aakar|akar=आकर aa=आ
khana_v=खाना khata|khaata=खाता khati=खाती khate=खाते khaunga=खाऊँगा khayega=खाएगा khaoge=खाओगे khao=खाओ khakar=खाकर kha=खा peena|pina=पीना peeta|pita_v=पीता peeti=पीती peete=पीते piyo=पियो pee|pi=पी
lena=लेना leta=लेता leti=लेती lete=लेते lunga|loonga=लूँगा lungi=लूँगी lega=लेगा legi=लेगी lenge=लेंगे loge=लोगे lekar=लेकर le=ले dena=देना deta=देता deti=देती dete=देते dunga|doonga=दूँगा dungi=दूँगी dega=देगा degi=देगी denge=देंगे doge=दोगे dekar=देकर de=दे
sona_v=सोना sota=सोता soti=सोती sote=सोते so_h=सो rona=रोना rota=रोता roti_v=रोती rote=रोते ro=रो jeena|jina=जीना jeeta|jita=जीता jeete=जीते jee|ji_v=जी marna=मरना
wapas|vapas|waapas=वापस raja|raaja=राजा rani|raani=रानी yuddh|yudh=युद्ध talwar|talvar=तलवार tyohar=त्योहार sena=सेना sipahi=सिपाही mahal=महल rajya=राज्य rajkumar=राजकुमार rajkumari=राजकुमारी veer=वीर bahadur=बहादुर khoon=खून badla=बदला insaaf=इंसाफ़ nyay|nyaay=न्याय shakti=शक्ति ladai|ladaai=लड़ाई maut=मौत taqdeer|takdeer=तक़दीर dharti=धरती samundar|samandar=समुंदर toofan|tufan=तूफ़ान aag=आग wada|vaada|waada=वादा kasam|qasam=क़सम pooja|puja=पूजा nafrat=नफ़रत dosti=दोस्ती dushmani=दुश्मनी parivar|parivaar=परिवार mata=माता
yoddha=योद्धा samrat=सम्राट senapati=सेनापति qila|kila=क़िला singhasan=सिंहासन praja=प्रजा asur=असुर rakshas=राक्षस amar=अमर anant=अनंत vijay=विजय parajay=पराजय rakt=रक्त pratishodh=प्रतिशोध balidan=बलिदान kartavya=कर्तव्य dharm=धर्म karm=कर्म aatma|atma=आत्मा shraap|shrap=श्राप vardaan|vardan=वरदान
`;

/** Verb roots (consonant-final) whose forms are built by rule: roman=Devanagari root. */
const ROOT_SRC = `
kar=कर bol=बोल sun=सुन dekh=देख chal=चल ruk=रुक baith=बैठ uth=उठ likh=लिख padh=पढ़ samajh=समझ soch=सोच pooch|puch|pooch=पूछ mil=मिल khel=खेल has|hans=हँस bhool|bhul=भूल maan|man_v=मान jaan|jan_v=जान pehchan|pehchaan=पहचान
rakh=रख nikal=निकल pahunch|pohoch|pahuch=पहुँच laut=लौट bhej=भेज khol=खोल band=बंद tod=तोड़ jod=जोड़ chhod|chod=छोड़ pakad=पकड़ maar|mar_v=मार bhaag|bhag=भाग daud=दौड़ kood|kud=कूद gir=गिर chadh=चढ़ utar=उतर
ban=बन bana=बना badal=बदल badh=बढ़ ghat=घट jeet|jit=जीत haar|har=हार lad=लड़ dar=डर ro_k=रोक tok=टोक dhoondh|dhundh=ढूँढ़ khareed|kharid=ख़रीद bech=बेच kama=कमा bacha=बचा bata=बता dikha=दिखा sikha=सिखा seekh|sikh=सीख
sambhal=संभाल nibha=निभा mita=मिटा jala=जला bujha=बुझा chhoo|chhu=छू chahiye_r=चाह pyaar_r=प्यार yaad_r=याद tadap=तड़प machal=मचल behek|bahak=बहक mehek|mahak=महक chamak=चमक baras=बरस garaj=गरज muskura=मुस्कुरा gungunaa|gunguna=गुनगुना
laga|lagaa=लगा lag=लग rah=रह keh|kah=कह beh|bah=बह seh|sah=सह pee_r=पी jee_r=जी
`;

const LEX = new Map<string, string>();
/** Spellings that are also ordinary English words: Hindi only when the line around them is Hindi. */
const SHARED = new Set<string>();
for (const item of LEX_SRC.trim().split(/\s+/)) {
  const [lhs, dev] = item.split("=") as [string, string];
  for (const raw of lhs.split("|")) {
    const tagged = /_[a-z]+$/.test(raw);
    const w = raw.replace(/_[a-z]+$/, "");
    if (!LEX.has(w)) LEX.set(w, dev);
    if (tagged && /^(is|in|the|use|par|bad|do|or|hi|are|hey|so|sir|rat|school|hun|ki|li|di|ji|ro)$/.test(w)) SHARED.add(w);
  }
}
for (const w of ["to", "me", "main", "ham", "hum", "man", "kam", "bus", "log", "pal", "din", "kal", "sab", "tum", "ab", "tab", "jab", "ek", "pair", "bare", "dost", "her", "air", "an", "on", "aunt", "pet", "ram", "dam", "bin", "pe", "na", "ya", "ho", "le", "de", "so", "ja", "aa", "pi", "se", "ne", "ka", "ke", "ko", "us", "un", "the", "is", "in", "use", "par", "bad", "do", "or", "hi", "are", "hey", "sir", "rat", "school", "has", "band", "bat", "tod", "lad", "dar", "ban", "bach", "mar", "sun", "chal", "mil", "kar", "bol", "man", "jan", "bah", "sah", "kah", "rah", "lag", "gir", "tok", "ruk", "jeet", "but", "papa", "mummy", "mama", "dada", "nana", "sach", "khel", "rang", "jung", "saal", "sal", "raat", "roz", "phal", "aam", "roti", "pati", "beta", "dal", "namak", "hawa", "tara", "pura", "puri", "garam", "mast", "naya", "nai", "jo", "ye", "ve", "tu", "wo", "vo", "ji", "li", "di", "ki", "hai"]) SHARED.add(w);
// …but these are Hindi far more often than English wherever Hinglish is written
const HINDI_FIRST = new Set<string>();
for (const w of ["hai", "hain", "tum", "kal", "sab", "ab", "tab", "jab", "ek", "ka", "ke", "ko", "ne", "se", "ho", "ye", "wo", "vo", "tu", "na", "ya", "raat", "saal", "roz", "naya", "nai", "dost", "hum", "garam", "mast", "sach", "khel", "kar", "bol", "chal", "mil", "ruk", "ji", "jo", "hawa", "pura", "puri", "roti", "beta", "pati", "lag", "rah", "kah", "ki", "aur", "nahi", "kya", "mera", "tera", "bhi", "tha", "thi", "yaar", "bhai", "dil", "ghar", "paani", "pani", "baat", "kaam", "naam", "din", "aaj", "abhi", "kuch", "bahut", "accha", "acha", "theek", "haan", "ji", "mat", "phir", "fir", "liye", "saath", "wala", "wali", "wale", "gaya", "gayi", "kiya", "diya", "liya", "raha", "rahi", "rahe", "hoga", "hogi", "hua", "hui", "koi", "kisi", "apna", "apni", "apne", "mujhe", "tumhe", "unhe", "inhe", "isko", "usko", "maine", "tumne", "usne", "aap", "aapka", "aapki", "aapke", "yeh", "woh", "kab", "kahan", "kaun", "kaise", "kaisa", "kitna", "kitni", "kitne", "kyun", "kyon", "kyunki", "lekin", "magar", "agar", "toh", "bas", "zindagi", "pyaar", "pyar", "ishq", "sapna", "yaad", "chand", "suraj", "aasman", "baarish"]) HINDI_FIRST.add(w);
for (const w of ["hai", "tum", "kal", "sab", "ab", "tab", "jab", "ek", "ka", "ke", "ko", "ne", "se", "ho", "ye", "wo", "vo", "tu", "na", "ya", "raat", "saal", "roz", "naya", "nai", "papa", "mummy", "dost", "hum", "garam", "mast", "sach", "khel", "kar", "bol", "chal", "mil", "ruk", "ji", "jo", "kam", "hawa", "pura", "puri", "roti", "beta", "pati", "tara", "lag", "rah", "kah", "ki", "li", "di"]) SHARED.delete(w);

const ROOTS: [string, string][] = [];
for (const item of ROOT_SRC.trim().split(/\s+/)) {
  const [lhs, dev] = item.split("=") as [string, string];
  for (const raw of lhs.split("|")) ROOTS.push([raw.replace(/_[a-z]+$/, ""), dev]);
}
ROOTS.sort((a, b) => b[0].length - a[0].length);
/** Endings of consonant-final verb roots: roman → Devanagari tail. */
const ENDINGS: [string, string][] = [
  ["enge", "ेंगे"], ["engi", "ेंगी"], ["unga", "ूँगा"], ["oonga", "ूँगा"], ["ungi", "ूँगी"], ["oongi", "ूँगी"], ["oge", "ोगे"], ["ogi", "ोगी"], ["ega", "ेगा"], ["egi", "ेगी"], ["iye", "िए"], ["iyega", "िएगा"], ["kar", "कर"], ["ke", "के"],
  ["na", "ना"], ["ne", "ने"], ["ni", "नी"], ["ta", "ता"], ["ti", "ती"], ["te", "ते"], ["tay", "ते"], ["a", "ा"], ["aa", "ा"], ["i", "ी"], ["ee", "ी"], ["e", "े"], ["o", "ो"], ["un", "ूँ"], ["oon", "ूँ"], ["en", "ें"], ["ein", "ें"], ["wana", "वाना"], ["wa", "वा"],
  ["", ""],
];
/** Roots that end in ा (bana, bata…) take glides: banaya, banao, banaunga. */
const A_END: [string, string][] = [["ya", "या"], ["yi", "ई"], ["ye", "ए"], ["o", "ओ"], ["unga", "ऊँगा"], ["ungi", "ऊँगी"], ["oge", "ओगे"], ["yega", "एगा"], ["ega", "एगा"], ["yegi", "एगी"], ["yenge", "एँगे"], ["enge", "एँगे"], ["na", "ना"], ["ne", "ने"], ["ta", "ता"], ["ti", "ती"], ["te", "ते"], ["kar", "कर"], ["iye", "इए"], ["", ""]];

function verbForm(w: string): string | null {
  for (const [root, dev] of ROOTS) {
    if (!w.startsWith(root)) continue;
    const tail = w.slice(root.length);
    const table = dev.endsWith("ा") ? A_END : ENDINGS;
    for (const [e, d] of table) if (tail === e) return dev + d;
  }
  return null;
}

/* ---------- spelling rules for words the lexicon does not know ---------- */

const C2: [string, string][] = [["chh", "छ"], ["kh", "ख"], ["gh", "घ"], ["ch", "च"], ["jh", "झ"], ["th", "थ"], ["dh", "ध"], ["ph", "फ"], ["bh", "भ"], ["sh", "श"], ["ng", "ंग"], ["gy", "ज्ञ"], ["tr", "त्र"], ["ksh", "क्ष"]];
const C1: Record<string, string> = { k: "क", g: "ग", c: "क", j: "ज", t: "त", d: "द", n: "न", p: "प", b: "ब", m: "म", y: "य", r: "र", l: "ल", v: "व", w: "व", s: "स", h: "ह", z: "ज़", f: "फ़", q: "क़", x: "क्स" };
const V: [string, string, string][] = [["aa", "आ", "ा"], ["ai", "ऐ", "ै"], ["au", "औ", "ौ"], ["ee", "ई", "ी"], ["ii", "ई", "ी"], ["oo", "ऊ", "ू"], ["uu", "ऊ", "ू"], ["ou", "औ", "ौ"], ["ei", "ए", "े"], ["a", "अ", ""], ["i", "इ", "ि"], ["u", "उ", "ु"], ["e", "ए", "े"], ["o", "ओ", "ो"]];

/** Spell a romanised Hindi word in Devanagari by rule (dental t/d, short medial a, long final vowels). */
export function spellDevanagari(word: string): string {
  let w = word.toLowerCase();
  // -ana, -ani, -ane after a consonant are long in longer words: suhana, kahani, deewane
  if (w.length >= 6) w = w.replace(/([^aeiou])an([aie])$/, "$1aan$2").replace(/([^aeiou])a(r|l|n|m|z|b|t|d|s|j|k)$/, "$1aa$2");
  // plural endings are nasal vowels: raahon, raatein, baatein
  let tail = "";
  if (w.length >= 5 && /[^aeiou]on$/.test(w)) {
    w = w.slice(0, -2);
    tail = "ों";
  } else if (w.length >= 5 && /[^aeiou](ein|en)$/.test(w)) {
    w = w.replace(/(ein|en)$/, "");
    tail = "ें";
  }
  // (the stand-in final letter is dropped together with the virama before it)
  if (tail) return spellDevanagari(w + "q").slice(0, -2).replace(/्$/, "") + tail;
  let out = "";
  let i = 0;
  let prevCons = false;
  while (i < w.length) {
    const rest = w.slice(i);
    const last = (len: number) => i + len >= w.length;
    let hit = false;
    // n before a consonant is the dot above (anusvara)
    if (rest[0] === "n" && rest.length > 1 && /[kgcjtdpbsz]/.test(rest[1]!) && !prevCons && out) {
      out += "ं";
      i += 1;
      continue;
    }
    for (const [r, d] of [...C2, ...Object.entries(C1)] as [string, string][]) {
      if (!rest.startsWith(r)) continue;
      if (prevCons) out += "्";
      out += d;
      i += r.length;
      prevCons = !d.endsWith("ं") || d.length > 1;
      // doubled consonants are written as a conjunct by the loop itself
      hit = true;
      break;
    }
    if (hit) continue;
    for (const [r, full, sign] of V) {
      if (!rest.startsWith(r)) continue;
      let f = full, s = sign;
      // at the end of a word a, i and u are long: ladka, pani, guru
      if (last(r.length) && w.length > 2) {
        if (r === "a") {
          f = "आ";
          s = "ा";
        } else if (r === "i") {
          f = "ई";
          s = "ी";
        } else if (r === "u") {
          f = "ऊ";
          s = "ू";
        }
      }
      out += prevCons ? s : f;
      i += r.length;
      prevCons = false;
      hit = true;
      break;
    }
    if (!hit) i += 1;
  }
  return out;
}

const HINDI_SHAPE = /(aa|ee|oo|kh|gh|bh|dh|jh|chh|[^aeiou]y[ae]$|w[ao]l[aei]$|(unga|ungi|enge|engi|oge|ogi|ega|egi|iye|kar|ta|ti|te|na|ne|ni|ya|yi|ye|on|an|ein|en)$)/;
const ENGLISH_SHAPE = /(tion|sion|ing$|ed$|ly$|ness$|ment$|ous$|ck|ough|igh|wh|^th[eiao]|qu|x|[^aeiou]s$|[bcdfghjklmnpqrstvwxz]{4})/;

export type WordKind = "hindi" | "english" | "either" | "unknown";

/** How one Latin-script word reads on its own. */
export function wordKind(word: string): WordKind {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return "unknown";
  const hin = LEX.has(w) || verbForm(w) !== null;
  const eng = isEnglishWord(w);
  if (hin && HINDI_FIRST.has(w)) return "hindi";
  if (hin && (eng || SHARED.has(w))) return "either";
  if (hin) return "hindi";
  if (eng) return "english";
  return "unknown";
}

/** Share of the Latin-script words in a line that are Hindi (0 = English, 1 = romanised Hindi). */
export function hinglishShare(text: string): number {
  const words = text.match(/[A-Za-z][A-Za-z']*/g) ?? [];
  if (!words.length) return 0;
  let h = 0, e = 0, either = 0;
  for (const w of words) {
    const k = wordKind(w);
    if (k === "hindi") h += 1;
    else if (k === "english") e += 1;
    else if (k === "either") either += 1;
  }
  // words that are also English ("hi", "to", "so") say nothing on their own: they count only beside a clearly Hindi word
  if (!h) return 0;
  h += either * 0.35;
  return h / Math.max(words.length * 0.6, h + e);
}

/** Devanagari for one romanised word, or null when it should be read as English. `hindiLine`: the line around it is Hindi. */
export function romanToDevanagari(word: string, hindiLine: boolean): string | null {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return null;
  const k = wordKind(w);
  if (k === "english") return null;
  if (k === "either" && !hindiLine) return null;
  if (k === "hindi" || k === "either") return LEX.get(w) ?? verbForm(w);
  if (!hindiLine) return null;
  // unknown word in a Hindi line: names and Hindi words are spelled out, English-looking ones stay English
  if (/^[A-Z]{2,}$/.test(word) || isEnglishWord(w)) return null;
  const hs = HINDI_SHAPE.test(w), es = ENGLISH_SHAPE.test(w);
  if (es && !hs) return null;
  if (hs || /[aeiou]$/.test(w)) return spellDevanagari(w);
  return null;
}

const FAMILY = new Set(["papa", "mummy", "mumma", "maa", "beta", "beti", "didi", "bhaiya", "gudiya", "dadi", "nani", "chacha", "bitiya"]);

/** Rewrite the Hindi words of a Latin-script line in Devanagari; English words are left as they are. */
export function transliterateHinglish(text: string, force = false): string {
  // A line with no English word in it ("Papa...", "Beta!") is Hindi when it holds a family word.
  const words = text.match(/[A-Za-z][A-Za-z']*/g) ?? [];
  const onlyHindi = words.length > 0 && words.every((w) => wordKind(w) !== "english" || FAMILY.has(w.toLowerCase())) && words.some((w) => FAMILY.has(w.toLowerCase()));
  const hindiLine = force || onlyHindi || hinglishShare(text) >= 0.34;
  if (!hindiLine && hinglishShare(text) < 0.12) return text;
  // "bacha" is बच्चा (a child) except as a verb: "bacha nahi paaya", "bacha liya" → बचा (saved)
  const t = hindiLine ? text.replace(/\bbach(?:a|aa)\b(?=\s+(?:nahi|nahin|na|liya|li|lo|le|lena|leta|leti|lete|loon|lu|lijiye|paaya|paya|payi|paayi|paa|pa|paata|paati|paate|pata|pati|pate|paaun|paaunga|paaungi|paoge|paaoge|paaye|paye|sakta|sakti|sakte|sake|sako|sakoon|sakun|sakenge|diya|dena|do|de|lunga|lungi|lenge|chuke|chuka|chuki)\b)/gi, "बचा") : text;
  return t.replace(/[A-Za-z][A-Za-z']*/g, (w) => romanToDevanagari(w, hindiLine) ?? w);
}

/** Kept for callers of the first Hinglish version: same as transliterateHinglish. */
export const hinglishToDevanagari = (text: string): string => transliterateHinglish(text);

/** The romanised Hindi words VolTune knows by heart (lexicon and verb roots), for tests and docs. */
export function knowsHindiWord(word: string): boolean {
  const w = word.toLowerCase();
  return LEX.has(w) || verbForm(w) !== null;
}
