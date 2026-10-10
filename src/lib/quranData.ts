import { QPC_V2, FALLBACK_ARABIC_FAMILY } from './mushafFonts';

export interface Reciter {
  id: string;
  name: string;
  arabicName: string;
  style: string;
  audioServerUrl: string;
  /**
   * Reciter id on quran.com's audio API, which publishes measured per-ayah
   * timings for that reciter's chapter recordings. `0` means quran.com does
   * not carry this reciter: loading their audio falls back to the mp3quran
   * file above with *estimated* ayah boundaries, which have to be corrected on
   * the timeline by hand.
   *
   * The timings and the audio file are a matched pair -- the timestamps index
   * quran.com's own recording, not mp3quran's -- so whichever source a load
   * uses, it must use both halves of it. Verified against
   * `api.quran.com/api/v4/resources/recitations` (Aug 2026).
   */
  quranApiId: number;
  /**
   * Kept for projects that already name this reciter, but not offered for a
   * new one: no published timings exist for the recording, so every clip
   * would rest on the aligner alone.
   */
  hidden?: boolean;
  /**
   * Timed only by a QUL export, with no other recording to fall back to:
   * offered only on a machine that has imported it (`qulTimed`).
   */
  needsQul?: boolean;
}

/** The reciters offered when starting a clip, given which QUL exports this machine holds. */
export const listedReciters = (qulTimed: readonly string[]): Reciter[] =>
  RECITERS.filter(reciter => !reciter.hidden && (!reciter.needsQul || qulTimed.includes(reciter.id)));

export interface Surah {
  number: number;
  nameEnglish: string;
  nameArabic: string;
  englishTranslation: string;
  numberOfAyahs: number;
  revelationType: string;
}

export interface VerseWord {
  arabic: string;
  translation: string;
  timestamp?: number;
  excluded?: boolean;
  /**
   * The mushaf's own drawing of this word, and which page font draws it.
   *
   * The King Fahd Complex typesets each page by hand, and QUL publishes the
   * result as one font per page in which every word is a single glyph. So a
   * caption can show the printed page rather than a font's interpretation of
   * the Unicode text -- the two differ visibly, most obviously in the marks
   * over a sakin letter.
   *
   * `arabic` stays the text. Only pixels come from here: the aligner's
   * reference, ground truth, the inspector's edit box and every export's
   * metadata are all Unicode, because a private-use glyph code is not text and
   * cannot be searched, edited or compared. Absent when the upstream did not
   * send the glyph fields, which is why nothing may depend on it.
   */
  glyph?: string;
  glyphPage?: number;
  /**
   * Which line of that printed page the word sits on, 1-15. Lets a caption
   * break its rows where the mushaf breaks them rather than wherever the card
   * runs out of width. Absent on the same terms as the glyph.
   */
  glyphLine?: number;
}

export interface VerseData {
  verseNumber: number;
  verseKey: string; // e.g. "1:1"
  textUthmani: string;
  translation: string;
  startTime: number; // in seconds (e.g. 0.0)
  endTime: number;   // in seconds (e.g. 5.2)
  words?: VerseWord[];
  matchConfidence?: number;
  /**
   * The aligner's reasons to check this caption -- `stop_mark` when it ended
   * the line on a mushaf stop mark with no silence heard. See `captionChecks`.
   */
  checks?: string[];
  /** Someone has dealt with this caption, so it is no longer marked for checking. */
  checked?: boolean;
  // Optional segment-specific display overrides from AI matching.
  // Useful when only part of an ayah is recited or repeated.
  displayTextUthmani?: string;
  displayTranslation?: string;
  /**
   * Further translations of this ayah, keyed by quran.com resource id.
   *
   * Whole-ayah text, unlike `displayTranslation`: a caption that covers half
   * an ayah cannot divide a translation nobody has aligned word for word.
   * Fetched on demand when a language is chosen, and dropped from the
   * auto-saved draft, which can ask for them again.
   */
  translations?: Record<string, string>;
  /**
   * Hand corrections to those, keyed the same way.
   *
   * Separate from `translations` for the reason `displayTranslation` is
   * separate from `translation`: one is fetched and re-fetchable, the other is
   * the user's own work and exists nowhere else. Keeping them apart is what
   * lets the draft drop megabytes of re-fetchable text and still bring an edit
   * back -- and it means a re-fetch refreshes the source text underneath a
   * correction instead of being blocked by it.
   */
  displayTranslations?: Record<string, string>;
}

// Audio URLs verified against mp3quran.net download pages (Aug 2026).
// Format: https://serverXX.mp3quran.net/download/{slug}/{padded-surah}.mp3
export const RECITERS: Reciter[] = [
  {
    id: 'sudais',
    name: 'Abdul Rahman Al-Sudais',
    arabicName: 'عبد الرحمن السديس',
    style: 'Murattal',
    audioServerUrl: 'https://server11.mp3quran.net/download/sds/',
    quranApiId: 3
  },
  {
    id: 'muaiqly',
    name: 'Maher Al-Muaiqly',
    arabicName: 'ماهر المعيقلي',
    style: 'Murattal',
    audioServerUrl: 'https://server12.mp3quran.net/download/maher/',
    // Not on quran.com -- id 4 there is Abu Bakr al-Shatri, a different voice.
    quranApiId: 0
  },
  {
    id: 'yasser',
    name: 'Yasser Al-Dosari',
    arabicName: 'ياسر الدوسري',
    style: 'Emotional',
    audioServerUrl: 'https://server11.mp3quran.net/download/yasser/',
    quranApiId: 97
  },
  {
    id: 'shuraim',
    name: 'Saud Al-Shuraim',
    arabicName: 'سعود الشريم',
    style: 'Murattal',
    audioServerUrl: 'https://server7.mp3quran.net/download/shur/',
    quranApiId: 10
  },
  {
    id: 'ghamdi',
    name: 'Saad Al-Ghamdi',
    arabicName: 'سعد الغامدي',
    style: 'Murattal',
    audioServerUrl: 'https://server7.mp3quran.net/download/s_gmd/',
    // Not on quran.com -- id 8 there is al-Minshawi.
    quranApiId: 0
  },
  {
    id: 'raad',
    name: 'Raad Al-Kurdi',
    arabicName: 'رعد محمد الكردي',
    style: 'Emotional',
    audioServerUrl: 'https://server6.mp3quran.net/download/kurdi/',
    quranApiId: 0,
    // Neither quran.com nor QUL publishes timings for this recording.
    hidden: true
  },
  // Timed word by word by QUL, and played from QUL's own recording. Checked
  // on 2026-09-26: every ayah of all 114 surahs timed (Hani ar-Rifai's 89:1,
  // one word, has its bounds only). QUL tags 18 more recitations "with
  // segments" whose exports time only whole ayahs; those are not listed.
  ...([
    ['basit', 'Abdul Basit Abdul Samad', 'عبد الباسط عبد الصمد'],
    ['shatri', 'Abu Bakr Al-Shatri', 'أبو بكر الشاطري'],
    ['rifai', 'Hani Ar-Rifai', 'هاني الرفاعي'],
    ['tunaiji', 'Khalifa Al-Tunaiji', 'خليفة الطنيجي'],
    ['jalil', 'Khalid Al-Jalil', 'خالد الجليل'],
  ] as const).map(([id, name, arabicName]): Reciter => ({
    id, name, arabicName, style: 'Murattal', audioServerUrl: '', quranApiId: 0, needsQul: true
  })),
  {
    // QUL's export for this recording is not usable: 143 words timed over 10s
    // across 93 ayahs, one of 13:10's at 32s with the three after it as long,
    // where the recording has the ayah over in a few seconds.
    id: 'toure', name: 'Hady Toure', arabicName: 'هادي توري', style: 'Murattal',
    audioServerUrl: '', quranApiId: 0, needsQul: true, hidden: true
  }
];

export const SURAHS_LIST: Surah[] = [
  { number: 1, nameEnglish: "Al-Fatihah", nameArabic: "الفاتحة", englishTranslation: "The Opening", numberOfAyahs: 7, revelationType: "Meccan" },
  { number: 2, nameEnglish: "Al-Baqarah", nameArabic: "البقرة", englishTranslation: "The Cow", numberOfAyahs: 286, revelationType: "Medinan" },
  { number: 3, nameEnglish: "Ali 'Imran", nameArabic: "آل عمران", englishTranslation: "Family of Imran", numberOfAyahs: 200, revelationType: "Medinan" },
  { number: 4, nameEnglish: "An-Nisa", nameArabic: "النساء", englishTranslation: "The Women", numberOfAyahs: 176, revelationType: "Medinan" },
  { number: 5, nameEnglish: "Al-Ma'idah", nameArabic: "المائدة", englishTranslation: "The Table Spread", numberOfAyahs: 120, revelationType: "Medinan" },
  { number: 6, nameEnglish: "Al-An'am", nameArabic: "الأنعام", englishTranslation: "The Cattle", numberOfAyahs: 165, revelationType: "Meccan" },
  { number: 7, nameEnglish: "Al-A'raf", nameArabic: "الأعراف", englishTranslation: "The Heights", numberOfAyahs: 206, revelationType: "Meccan" },
  { number: 8, nameEnglish: "Al-Anfal", nameArabic: "الأنفال", englishTranslation: "The Spoils of War", numberOfAyahs: 75, revelationType: "Medinan" },
  { number: 9, nameEnglish: "At-Tawbah", nameArabic: "التوبة", englishTranslation: "The Repentance", numberOfAyahs: 129, revelationType: "Medinan" },
  { number: 10, nameEnglish: "Yunus", nameArabic: "يونس", englishTranslation: "Jonah", numberOfAyahs: 109, revelationType: "Meccan" },
  { number: 11, nameEnglish: "Hud", nameArabic: "هود", englishTranslation: "Hud", numberOfAyahs: 123, revelationType: "Meccan" },
  { number: 12, nameEnglish: "Yusuf", nameArabic: "يوسف", englishTranslation: "Joseph", numberOfAyahs: 111, revelationType: "Meccan" },
  { number: 13, nameEnglish: "Ar-Ra'd", nameArabic: "الرعد", englishTranslation: "The Thunder", numberOfAyahs: 43, revelationType: "Medinan" },
  { number: 14, nameEnglish: "Ibrahim", nameArabic: "إبراهيم", englishTranslation: "Abraham", numberOfAyahs: 52, revelationType: "Meccan" },
  { number: 15, nameEnglish: "Al-Hijr", nameArabic: "الحجر", englishTranslation: "The Rocky Tract", numberOfAyahs: 99, revelationType: "Meccan" },
  { number: 16, nameEnglish: "An-Nahl", nameArabic: "النحل", englishTranslation: "The Bee", numberOfAyahs: 128, revelationType: "Meccan" },
  { number: 17, nameEnglish: "Al-Isra", nameArabic: "الإسراء", englishTranslation: "The Night Journey", numberOfAyahs: 111, revelationType: "Meccan" },
  { number: 18, nameEnglish: "Al-Kahf", nameArabic: "الكهف", englishTranslation: "The Cave", numberOfAyahs: 110, revelationType: "Meccan" },
  { number: 19, nameEnglish: "Maryam", nameArabic: "مريم", englishTranslation: "Mary", numberOfAyahs: 98, revelationType: "Meccan" },
  { number: 20, nameEnglish: "Taha", nameArabic: "طه", englishTranslation: "Ta-Ha", numberOfAyahs: 135, revelationType: "Meccan" },
  { number: 21, nameEnglish: "Al-Anbya", nameArabic: "الأنبياء", englishTranslation: "The Prophets", numberOfAyahs: 112, revelationType: "Meccan" },
  { number: 22, nameEnglish: "Al-Hajj", nameArabic: "الحج", englishTranslation: "The Pilgrimage", numberOfAyahs: 78, revelationType: "Medinan" },
  { number: 23, nameEnglish: "Al-Mu'minun", nameArabic: "المؤمنون", englishTranslation: "The Believers", numberOfAyahs: 118, revelationType: "Meccan" },
  { number: 24, nameEnglish: "An-Nur", nameArabic: "النور", englishTranslation: "The Light", numberOfAyahs: 64, revelationType: "Medinan" },
  { number: 25, nameEnglish: "Al-Furqan", nameArabic: "الفرقان", englishTranslation: "The Criterion", numberOfAyahs: 77, revelationType: "Meccan" },
  { number: 26, nameEnglish: "Ash-Shu'ara", nameArabic: "الشعراء", englishTranslation: "The Poets", numberOfAyahs: 227, revelationType: "Meccan" },
  { number: 27, nameEnglish: "An-Naml", nameArabic: "النمل", englishTranslation: "The Ant", numberOfAyahs: 93, revelationType: "Meccan" },
  { number: 28, nameEnglish: "Al-Qasas", nameArabic: "القصص", englishTranslation: "The Stories", numberOfAyahs: 88, revelationType: "Meccan" },
  { number: 29, nameEnglish: "Al-'Ankabut", nameArabic: "العنكبوت", englishTranslation: "The Spider", numberOfAyahs: 69, revelationType: "Meccan" },
  { number: 30, nameEnglish: "Ar-Rum", nameArabic: "الروم", englishTranslation: "The Romans", numberOfAyahs: 60, revelationType: "Meccan" },
  { number: 31, nameEnglish: "Luqman", nameArabic: "لقمان", englishTranslation: "Luqman", numberOfAyahs: 34, revelationType: "Meccan" },
  { number: 32, nameEnglish: "As-Sajdah", nameArabic: "السجدة", englishTranslation: "The Prostration", numberOfAyahs: 30, revelationType: "Meccan" },
  { number: 33, nameEnglish: "Al-Ahzab", nameArabic: "الأحزاب", englishTranslation: "The Combined Forces", numberOfAyahs: 73, revelationType: "Medinan" },
  { number: 34, nameEnglish: "Saba", nameArabic: "سبإ", englishTranslation: "Sheba", numberOfAyahs: 54, revelationType: "Meccan" },
  { number: 35, nameEnglish: "Fatir", nameArabic: "فاطر", englishTranslation: "Originator", numberOfAyahs: 45, revelationType: "Meccan" },
  { number: 36, nameEnglish: "Ya-Sin", nameArabic: "يس", englishTranslation: "Ya-Sin", numberOfAyahs: 83, revelationType: "Meccan" },
  { number: 37, nameEnglish: "As-Saffat", nameArabic: "الصافات", englishTranslation: "Those Who Set the Ranks", numberOfAyahs: 182, revelationType: "Meccan" },
  { number: 38, nameEnglish: "Sad", nameArabic: "ص", englishTranslation: "The Letter Sad", numberOfAyahs: 88, revelationType: "Meccan" },
  { number: 39, nameEnglish: "Az-Zumar", nameArabic: "الزمر", englishTranslation: "The Troops", numberOfAyahs: 75, revelationType: "Meccan" },
  { number: 40, nameEnglish: "Ghafir", nameArabic: "غافر", englishTranslation: "The Forgiver", numberOfAyahs: 85, revelationType: "Meccan" },
  { number: 41, nameEnglish: "Fussilat", nameArabic: "فصلت", englishTranslation: "Explained in Detail", numberOfAyahs: 54, revelationType: "Meccan" },
  { number: 42, nameEnglish: "Ash-Shuraa", nameArabic: "الشورى", englishTranslation: "The Consultation", numberOfAyahs: 53, revelationType: "Meccan" },
  { number: 43, nameEnglish: "Az-Zukhruf", nameArabic: "الزخرف", englishTranslation: "The Gold Adornments", numberOfAyahs: 89, revelationType: "Meccan" },
  { number: 44, nameEnglish: "Ad-Dukhan", nameArabic: "الدخان", englishTranslation: "The Smoke", numberOfAyahs: 59, revelationType: "Meccan" },
  { number: 45, nameEnglish: "Al-Jathiyah", nameArabic: "الجاثية", englishTranslation: "The Crouching", numberOfAyahs: 37, revelationType: "Meccan" },
  { number: 46, nameEnglish: "Al-Ahqaf", nameArabic: "الأحقاف", englishTranslation: "The Wind-Curved Sandhills", numberOfAyahs: 35, revelationType: "Meccan" },
  { number: 47, nameEnglish: "Muhammad", nameArabic: "محمد", englishTranslation: "Muhammad", numberOfAyahs: 38, revelationType: "Medinan" },
  { number: 48, nameEnglish: "Al-Fath", nameArabic: "الفتح", englishTranslation: "The Victory", numberOfAyahs: 29, revelationType: "Medinan" },
  { number: 49, nameEnglish: "Al-Hujurat", nameArabic: "الحجرات", englishTranslation: "The Rooms", numberOfAyahs: 18, revelationType: "Medinan" },
  { number: 50, nameEnglish: "Qaf", nameArabic: "ق", englishTranslation: "The Letter Qaf", numberOfAyahs: 45, revelationType: "Meccan" },
  { number: 51, nameEnglish: "Adh-Dhariyat", nameArabic: "الذاريات", englishTranslation: "The Winnowing Winds", numberOfAyahs: 60, revelationType: "Meccan" },
  { number: 52, nameEnglish: "At-Tur", nameArabic: "الطور", englishTranslation: "The Mount", numberOfAyahs: 49, revelationType: "Meccan" },
  { number: 53, nameEnglish: "An-Najm", nameArabic: "النجم", englishTranslation: "The Star", numberOfAyahs: 62, revelationType: "Meccan" },
  { number: 54, nameEnglish: "Al-Qamar", nameArabic: "القمر", englishTranslation: "The Moon", numberOfAyahs: 55, revelationType: "Meccan" },
  { number: 55, nameEnglish: "Ar-Rahman", nameArabic: "الرحمن", englishTranslation: "The Beneficent", numberOfAyahs: 78, revelationType: "Medinan" },
  { number: 56, nameEnglish: "Al-Waqi'ah", nameArabic: "الواقعة", englishTranslation: "The Inevitable", numberOfAyahs: 96, revelationType: "Meccan" },
  { number: 57, nameEnglish: "Al-Hadid", nameArabic: "الحديد", englishTranslation: "The Iron", numberOfAyahs: 29, revelationType: "Medinan" },
  { number: 58, nameEnglish: "Al-Mujadila", nameArabic: "المجادلة", englishTranslation: "The Pleading Woman", numberOfAyahs: 22, revelationType: "Medinan" },
  { number: 59, nameEnglish: "Al-Hashr", nameArabic: "الحشر", englishTranslation: "The Exile", numberOfAyahs: 24, revelationType: "Medinan" },
  { number: 60, nameEnglish: "Al-Mumtahanah", nameArabic: "الممتحنة", englishTranslation: "She That Is To Be Examined", numberOfAyahs: 13, revelationType: "Medinan" },
  { number: 61, nameEnglish: "As-Saff", nameArabic: "الصف", englishTranslation: "The Ranks", numberOfAyahs: 14, revelationType: "Medinan" },
  { number: 62, nameEnglish: "Al-Jumu'ah", nameArabic: "الجمعة", englishTranslation: "The Congregation", numberOfAyahs: 11, revelationType: "Medinan" },
  { number: 63, nameEnglish: "Al-Munafiqun", nameArabic: "المنافقون", englishTranslation: "The Hypocrites", numberOfAyahs: 11, revelationType: "Medinan" },
  { number: 64, nameEnglish: "At-Taghabun", nameArabic: "التغابن", englishTranslation: "The Mutual Disillusion", numberOfAyahs: 18, revelationType: "Medinan" },
  { number: 65, nameEnglish: "At-Talaq", nameArabic: "الطلاق", englishTranslation: "The Divorce", numberOfAyahs: 12, revelationType: "Medinan" },
  { number: 66, nameEnglish: "At-Tahrim", nameArabic: "التحريم", englishTranslation: "The Prohibition", numberOfAyahs: 12, revelationType: "Medinan" },
  { number: 67, nameEnglish: "Al-Mulk", nameArabic: "الملك", englishTranslation: "The Sovereignty", numberOfAyahs: 30, revelationType: "Meccan" },
  { number: 68, nameEnglish: "Al-Qalam", nameArabic: "القلم", englishTranslation: "The Pen", numberOfAyahs: 52, revelationType: "Meccan" },
  { number: 69, nameEnglish: "Al-Haqqah", nameArabic: "الحاقة", englishTranslation: "The Reality", numberOfAyahs: 52, revelationType: "Meccan" },
  { number: 70, nameEnglish: "Al-Ma'arij", nameArabic: "المعارج", englishTranslation: "The Ascending Stairways", numberOfAyahs: 44, revelationType: "Meccan" },
  { number: 71, nameEnglish: "Nuh", nameArabic: "نوح", englishTranslation: "Noah", numberOfAyahs: 28, revelationType: "Meccan" },
  { number: 72, nameEnglish: "Al-Jinn", nameArabic: "الجن", englishTranslation: "The Jinn", numberOfAyahs: 28, revelationType: "Meccan" },
  { number: 73, nameEnglish: "Al-Muzzammil", nameArabic: "المزمل", englishTranslation: "The Enshrouded One", numberOfAyahs: 20, revelationType: "Meccan" },
  { number: 74, nameEnglish: "Al-Muddaththir", nameArabic: "المدثر", englishTranslation: "The Cloaked One", numberOfAyahs: 56, revelationType: "Meccan" },
  { number: 75, nameEnglish: "Al-Qiyamah", nameArabic: "القيامة", englishTranslation: "The Resurrection", numberOfAyahs: 40, revelationType: "Meccan" },
  { number: 76, nameEnglish: "Al-Insan", nameArabic: "الإنسان", englishTranslation: "Man", numberOfAyahs: 31, revelationType: "Medinan" },
  { number: 77, nameEnglish: "Al-Mursalat", nameArabic: "المرسلات", englishTranslation: "The Emissaries", numberOfAyahs: 50, revelationType: "Meccan" },
  { number: 78, nameEnglish: "An-Naba", nameArabic: "النبأ", englishTranslation: "The Announcement", numberOfAyahs: 40, revelationType: "Meccan" },
  { number: 79, nameEnglish: "An-Nazi'at", nameArabic: "النازعات", englishTranslation: "Those Who Drag Forth", numberOfAyahs: 46, revelationType: "Meccan" },
  { number: 80, nameEnglish: "Abasa", nameArabic: "عبس", englishTranslation: "He Frowned", numberOfAyahs: 42, revelationType: "Meccan" },
  { number: 81, nameEnglish: "At-Takwir", nameArabic: "التكوير", englishTranslation: "The Overthrowing", numberOfAyahs: 29, revelationType: "Meccan" },
  { number: 82, nameEnglish: "Al-Infitar", nameArabic: "الإنفطار", englishTranslation: "The Cleaving", numberOfAyahs: 19, revelationType: "Meccan" },
  { number: 83, nameEnglish: "Al-Mutaffifin", nameArabic: "المطففين", englishTranslation: "Defrauding", numberOfAyahs: 36, revelationType: "Meccan" },
  { number: 84, nameEnglish: "Al-Inshiqaq", nameArabic: "الإنشقاق", englishTranslation: "The Sundering", numberOfAyahs: 25, revelationType: "Meccan" },
  { number: 85, nameEnglish: "Al-Buruj", nameArabic: "البروج", englishTranslation: "The Mansions of the Stars", numberOfAyahs: 22, revelationType: "Meccan" },
  { number: 86, nameEnglish: "At-Tariq", nameArabic: "الطارق", englishTranslation: "The Nightcomer", numberOfAyahs: 17, revelationType: "Meccan" },
  { number: 87, nameEnglish: "Al-A'la", nameArabic: "الأعلى", englishTranslation: "The Most High", numberOfAyahs: 19, revelationType: "Meccan" },
  { number: 88, nameEnglish: "Al-Ghashiyah", nameArabic: "الغاشية", englishTranslation: "The Overwhelming", numberOfAyahs: 26, revelationType: "Meccan" },
  { number: 89, nameEnglish: "Al-Fajr", nameArabic: "الفجر", englishTranslation: "The Dawn", numberOfAyahs: 30, revelationType: "Meccan" },
  { number: 90, nameEnglish: "Al-Balad", nameArabic: "البلد", englishTranslation: "The City", numberOfAyahs: 20, revelationType: "Meccan" },
  { number: 91, nameEnglish: "Ash-Shams", nameArabic: "الشمس", englishTranslation: "The Sun", numberOfAyahs: 15, revelationType: "Meccan" },
  { number: 92, nameEnglish: "Al-Layl", nameArabic: "الليل", englishTranslation: "The Night", numberOfAyahs: 21, revelationType: "Meccan" },
  { number: 93, nameEnglish: "Ad-Duha", nameArabic: "الضحى", englishTranslation: "The Morning Hours", numberOfAyahs: 11, revelationType: "Meccan" },
  { number: 94, nameEnglish: "Ash-Sharh", nameArabic: "الشرح", englishTranslation: "The Relief", numberOfAyahs: 8, revelationType: "Meccan" },
  { number: 95, nameEnglish: "At-Tin", nameArabic: "التين", englishTranslation: "The Fig", numberOfAyahs: 8, revelationType: "Meccan" },
  { number: 96, nameEnglish: "Al-'Alaq", nameArabic: "العلق", englishTranslation: "The Clot", numberOfAyahs: 19, revelationType: "Meccan" },
  { number: 97, nameEnglish: "Al-Qadr", nameArabic: "القدر", englishTranslation: "The Power", numberOfAyahs: 5, revelationType: "Meccan" },
  { number: 98, nameEnglish: "Al-Bayyinah", nameArabic: "البينة", englishTranslation: "The Clear Proof", numberOfAyahs: 8, revelationType: "Medinan" },
  { number: 99, nameEnglish: "Az-Zalzalah", nameArabic: "الزلزلة", englishTranslation: "The Earthquake", numberOfAyahs: 8, revelationType: "Medinan" },
  { number: 100, nameEnglish: "Al-'Adiyat", nameArabic: "العاديات", englishTranslation: "The Courser", numberOfAyahs: 11, revelationType: "Meccan" },
  { number: 101, nameEnglish: "Al-Qari'ah", nameArabic: "القارعة", englishTranslation: "The Calamity", numberOfAyahs: 11, revelationType: "Meccan" },
  { number: 102, nameEnglish: "At-Takathur", nameArabic: "التكاثر", englishTranslation: "The Rivalry in World Increase", numberOfAyahs: 8, revelationType: "Meccan" },
  { number: 103, nameEnglish: "Al-'Asr", nameArabic: "العصر", englishTranslation: "The Declining Day", numberOfAyahs: 3, revelationType: "Meccan" },
  { number: 104, nameEnglish: "Al-Humazah", nameArabic: "الهمزة", englishTranslation: "The Traducer", numberOfAyahs: 9, revelationType: "Meccan" },
  { number: 105, nameEnglish: "Al-Fil", nameArabic: "الفيل", englishTranslation: "The Elephant", numberOfAyahs: 5, revelationType: "Meccan" },
  { number: 106, nameEnglish: "Quraysh", nameArabic: "قريش", englishTranslation: "Quraysh", numberOfAyahs: 4, revelationType: "Meccan" },
  { number: 107, nameEnglish: "Al-Ma'un", nameArabic: "الماعون", englishTranslation: "Small Kindnesses", numberOfAyahs: 7, revelationType: "Meccan" },
  { number: 108, nameEnglish: "Al-Kawthar", nameArabic: "الكوثر", englishTranslation: "Abundance", numberOfAyahs: 3, revelationType: "Meccan" },
  { number: 109, nameEnglish: "Al-Kafirun", nameArabic: "الكافرون", englishTranslation: "The Disbelievers", numberOfAyahs: 6, revelationType: "Meccan" },
  { number: 110, nameEnglish: "An-Nasr", nameArabic: "النصر", englishTranslation: "The Divine Support", numberOfAyahs: 3, revelationType: "Medinan" },
  { number: 111, nameEnglish: "Al-Masad", nameArabic: "المسد", englishTranslation: "The Palm Fiber", numberOfAyahs: 5, revelationType: "Meccan" },
  { number: 112, nameEnglish: "Al-Ikhlas", nameArabic: "الإخلاص", englishTranslation: "Sincerity", numberOfAyahs: 4, revelationType: "Meccan" },
  { number: 113, nameEnglish: "Al-Falaq", nameArabic: "الفلق", englishTranslation: "The Daybreak", numberOfAyahs: 5, revelationType: "Meccan" },
  { number: 114, nameEnglish: "An-Nas", nameArabic: "الناس", englishTranslation: "Mankind", numberOfAyahs: 6, revelationType: "Meccan" }
];

// What the studio opens on: exactly what Load gives for this passage, so that
// opening the studio and pressing Load play the same recording with the same
// captions. Al-Sudais's Al-Fatihah on the recording quran.com timed (the one
// `chooseReciterTiming` pairs with surah 1), from Load + Match on 2026-10-10
// with the aligner hearing his pauses. This recording has no isti'adha.
export const SAMPLE_PROJECTS = [
  {
    title: "Surah Al-Fatihah (Abdul Rahman Al-Sudais)",
    surahNumber: 1,
    surahNameArabic: "الفاتحة",
    surahNameEnglish: "Al-Fatihah",
    ayahStart: 1,
    ayahEnd: 7,
    reciterId: "sudais",
    reciterName: "Abdul Rahman Al-Sudais",
    audioUrl: "https://download.quranicaudio.com/qdc/abdurrahmaan_as_sudais/murattal/1.mp3",
    audioDuration: "00:34",
    verses: [
      {
        verseNumber: 1,
        verseKey: "1:1",
        textUthmani: "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ",
        translation: "In the Name of Allah—the Most Compassionate, Most Merciful.",
        startTime: 0,
        endTime: 3.1,
        words: [
          { arabic: "بِسْمِ", translation: "In (the) name", glyph: "ﱁ", glyphPage: 1, glyphLine: 2, timestamp: 0 },
          { arabic: "ٱللَّهِ", translation: "(of) Allah", glyph: "ﱂ", glyphPage: 1, glyphLine: 2, timestamp: 0.65 },
          { arabic: "ٱلرَّحْمَـٰنِ", translation: "the Most Gracious", glyph: "ﱃ", glyphPage: 1, glyphLine: 2, timestamp: 1.13 },
          { arabic: "ٱلرَّحِيمِ", translation: "the Most Merciful", glyph: "ﱄ", glyphPage: 1, glyphLine: 2, timestamp: 1.86 }
        ]
      },
      {
        verseNumber: 2,
        verseKey: "1:2",
        textUthmani: "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ",
        translation: "All praise is for Allah—Lord of all worlds",
        startTime: 3.1,
        endTime: 7.6,
        words: [
          { arabic: "ٱلْحَمْدُ", translation: "All praises and thanks", glyph: "ﱆ", glyphPage: 1, glyphLine: 3, timestamp: 3.08 },
          { arabic: "لِلَّهِ", translation: "(be) to Allah", glyph: "ﱇ", glyphPage: 1, glyphLine: 3, timestamp: 4.05 },
          { arabic: "رَبِّ", translation: "the Lord", glyph: "ﱈ", glyphPage: 1, glyphLine: 3, timestamp: 4.92 },
          { arabic: "ٱلْعَـٰلَمِينَ", translation: "of the universe", glyph: "ﱉ", glyphPage: 1, glyphLine: 3, timestamp: 5.51 }
        ]
      },
      {
        verseNumber: 3,
        verseKey: "1:3",
        textUthmani: "ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ",
        translation: "the Most Compassionate, Most Merciful",
        startTime: 7.6,
        endTime: 10.7,
        words: [
          { arabic: "ٱلرَّحْمَـٰنِ", translation: "The Most Gracious", glyph: "ﱋ", glyphPage: 1, glyphLine: 4, timestamp: 7.57 },
          { arabic: "ٱلرَّحِيمِ", translation: "the Most Merciful", glyph: "ﱌ", glyphPage: 1, glyphLine: 4, timestamp: 8.65 }
        ]
      },
      {
        verseNumber: 4,
        verseKey: "1:4",
        textUthmani: "مَـٰلِكِ يَوْمِ ٱلدِّينِ",
        translation: "Master of the Day of Judgment.",
        startTime: 10.7,
        endTime: 14.1,
        words: [
          { arabic: "مَـٰلِكِ", translation: "(The) Master", glyph: "ﱎ", glyphPage: 1, glyphLine: 4, timestamp: 10.68 },
          { arabic: "يَوْمِ", translation: "(of the) Day", glyph: "ﱏ", glyphPage: 1, glyphLine: 4, timestamp: 11.38 },
          { arabic: "ٱلدِّينِ", translation: "(of the) Judgment", glyph: "ﱐ", glyphPage: 1, glyphLine: 4, timestamp: 12.1 }
        ]
      },
      {
        verseNumber: 5,
        verseKey: "1:5",
        textUthmani: "إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ",
        translation: "You [alone] we worship and You [alone] we ask for help.",
        startTime: 14.1,
        endTime: 19.1,
        words: [
          { arabic: "إِيَّاكَ", translation: "You Alone", glyph: "ﱒ", glyphPage: 1, glyphLine: 5, timestamp: 14.13 },
          { arabic: "نَعْبُدُ", translation: "we worship", glyph: "ﱓ", glyphPage: 1, glyphLine: 5, timestamp: 15.09 },
          { arabic: "وَإِيَّاكَ", translation: "and You Alone", glyph: "ﱔ", glyphPage: 1, glyphLine: 5, timestamp: 15.84 },
          { arabic: "نَسْتَعِينُ", translation: "we ask for help", glyph: "ﱕ", glyphPage: 1, glyphLine: 5, timestamp: 16.96 }
        ]
      },
      {
        verseNumber: 6,
        verseKey: "1:6",
        textUthmani: "ٱهْدِنَا ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ",
        translation: "Guide us along the Straight Path",
        startTime: 19.1,
        endTime: 23.3,
        words: [
          { arabic: "ٱهْدِنَا", translation: "Guide us", glyph: "ﱗ", glyphPage: 1, glyphLine: 5, timestamp: 19.07 },
          { arabic: "ٱلصِّرَٰطَ", translation: "(to) the path", glyph: "ﱘ", glyphPage: 1, glyphLine: 6, timestamp: 19.55 },
          { arabic: "ٱلْمُسْتَقِيمَ", translation: "the straight", glyph: "ﱙ", glyphPage: 1, glyphLine: 6, timestamp: 20.72 }
        ]
      },
      {
        verseNumber: 7,
        verseKey: "1:7",
        textUthmani: "صِرَٰطَ ٱلَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ ٱلْمَغْضُوبِ عَلَيْهِمْ وَلَا ٱلضَّآلِّينَ",
        translation: "the Path of those You have blessed—not those You are displeased with, or those who are astray.",
        startTime: 23.3,
        endTime: 34.9,
        words: [
          { arabic: "صِرَٰطَ", translation: "(The) path", glyph: "ﱛ", glyphPage: 1, glyphLine: 6, timestamp: 23.28 },
          { arabic: "ٱلَّذِينَ", translation: "(of) those", glyph: "ﱜ", glyphPage: 1, glyphLine: 6, timestamp: 24.2 },
          { arabic: "أَنْعَمْتَ", translation: "You have bestowed (Your) Favors", glyph: "ﱝ", glyphPage: 1, glyphLine: 6, timestamp: 25.24 },
          { arabic: "عَلَيْهِمْ", translation: "on them", glyph: "ﱞ", glyphPage: 1, glyphLine: 7, timestamp: 26.14 },
          { arabic: "غَيْرِ", translation: "not (of)", glyph: "ﱟ", glyphPage: 1, glyphLine: 7, timestamp: 27.2 },
          { arabic: "ٱلْمَغْضُوبِ", translation: "those who earned (Your) wrath", glyph: "ﱠ", glyphPage: 1, glyphLine: 7, timestamp: 27.85 },
          { arabic: "عَلَيْهِمْ", translation: "on themselves", glyph: "ﱡ", glyphPage: 1, glyphLine: 7, timestamp: 28.89 },
          { arabic: "وَلَا", translation: "and not", glyph: "ﱢ", glyphPage: 1, glyphLine: 8, timestamp: 30 },
          { arabic: "ٱلضَّآلِّينَ", translation: "(of) those who go astray", glyph: "ﱣ", glyphPage: 1, glyphLine: 8, timestamp: 30.33 }
        ]
      }
    ]
  }
];

export const BACKGROUND_VIDEOS = [
  {
    id: 'mosque-moon',
    title: 'Illuminated Mosque & Moon',
    category: 'Mosque',
    orientation: 'vertical',
    url: 'https://videos.pexels.com/video-files/18953366/18953366-hd_1080_1920_30fps.mp4',
    thumbnail: 'https://images.pexels.com/videos/18953366/pexels-photo-18953366.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=400&w=225'
  },
  {
    id: 'starry-sky',
    title: 'Starry Cosmic Night',
    category: 'Nature',
    orientation: 'vertical',
    url: 'https://videos.pexels.com/video-files/32097578/13683716_1080_1920_24fps.mp4',
    thumbnail: 'https://images.pexels.com/videos/32097578/polaris-32097578.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=400&w=225'
  },
  {
    id: 'aerial-mosque',
    title: 'Golden Aerial Mosque',
    category: 'Mosque',
    orientation: 'vertical',
    url: 'https://videos.pexels.com/video-files/30963441/13237235_1080_1920_60fps.mp4',
    thumbnail: 'https://images.pexels.com/videos/30963441/pexels-photo-30963441.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=400&w=225'
  },
  {
    id: 'milky-way',
    title: 'Celestial Milky Way Ocean',
    category: 'Nature',
    orientation: 'vertical',
    url: 'https://videos.pexels.com/video-files/30560632/13088569_2160_3242_30fps.mp4',
    thumbnail: 'https://images.pexels.com/videos/30560632/milky-way-starry-sky-30560632.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=400&w=225'
  },
  {
    id: 'clouds-night',
    title: 'Serene Night Sky Clouds',
    category: 'Nature',
    orientation: 'vertical',
    url: 'https://videos.pexels.com/video-files/30022034/12880728_1440_2560_50fps.mp4',
    thumbnail: 'https://images.pexels.com/videos/30022034/pexels-photo-30022034.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=400&w=225'
  },
  {
    id: 'prophet-mosque',
    title: 'Medina Prophet Mosque',
    category: 'Mosque',
    orientation: 'horizontal',
    url: 'https://videos.pexels.com/video-files/11647598/11647598-hd_1920_1080_60fps.mp4',
    thumbnail: 'https://images.pexels.com/videos/11647598/islam-islamic-islamic-architecture-madina-11647598.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=225&w=400'
  },
  {
    id: 'minaret-moonlit',
    title: 'Minaret & Moonlit Sky',
    category: 'Mosque',
    orientation: 'vertical',
    url: 'https://videos.pexels.com/video-files/34198277/14495120_1080_1920_30fps.mp4',
    thumbnail: 'https://images.pexels.com/videos/34198277/black-and-white-camii-istanbul-minaret-34198277.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=400&w=225'
  },
  {
    id: 'aerial-mosque-night',
    title: 'Aerial Mosque at Night',
    category: 'Mosque',
    orientation: 'vertical',
    url: 'https://videos.pexels.com/video-files/34753278/14732655_1440_2560_30fps.mp4',
    thumbnail: 'https://images.pexels.com/videos/34753278/camlica-camii-34753278.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=400&w=225'
  },
  {
    id: 'urban-mosque-night',
    title: 'Urban Mosque Night Cityscape',
    category: 'Mosque',
    orientation: 'vertical',
    url: 'https://videos.pexels.com/video-files/36271445/15381500_1080_1920_30fps.mp4',
    thumbnail: 'https://images.pexels.com/videos/36271445/pexels-photo-36271445.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=400&w=225'
  },
  {
    id: 'kaaba-pilgrims',
    title: 'Pilgrims at the Kaaba',
    category: 'Makkah',
    orientation: 'vertical',
    url: 'https://videos.pexels.com/video-files/35170561/14899798_1080_1920_30fps.mp4',
    thumbnail: 'https://images.pexels.com/videos/35170561/4k-asia-islam-kaaba-35170561.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=400&w=225'
  },
  {
    id: 'kaaba-daylight',
    title: 'Kaaba Daylight View',
    category: 'Makkah',
    orientation: 'vertical',
    url: 'https://videos.pexels.com/video-files/35155732/14892981_1080_1920_30fps.mp4',
    thumbnail: 'https://images.pexels.com/videos/35155732/4k-asia-islam-kaaba-35155732.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=400&w=225'
  }
];

/**
 * The Arabic face every installation has.
 *
 * The others are files under `public/fonts/`, unpacked from the QUL archives
 * and never committed, so a fresh clone has none of them. Amiri comes from
 * Google Fonts with the studio's own interface, so it is always there to fall
 * back to. It is not offered as a choice: it draws the sukun as a closed ring
 * -- the mark the mushaf keeps for a letter that is not pronounced -- so it is
 * the face that works, not the right one. It is only ever drawn in when the
 * chosen face is not installed. See `usableArabicFont`.
 */
export const FONT_ARABIC_BUILTIN = 'amiri';

const BUILTIN_ARABIC_FONT = { id: FONT_ARABIC_BUILTIN, name: 'Amiri', className: 'font-amiri', family: 'Amiri', mushaf: false, file: null };

/**
 * The Arabic faces a caption can be drawn in.
 *
 * Every one is a mushaf font, self-hosted out of the QUL archives rather than
 * fetched from Google Fonts. The five Google faces that used to be here --
 * Amiri, Scheherazade New, Noto Naskh, Reem Kufi, Aref Ruqaa -- were removed
 * because all five draw the sukun as a closed ring, which is the ring the
 * mushaf reserves for a letter that is not pronounced at all.
 *
 * The built-in fallback is deliberately not among them -- see
 * `FONT_ARABIC_BUILTIN`.
 *
 * `mushaf` says the face draws `word.glyph`, the printed page's own drawing,
 * rather than composing `word.arabic` from Unicode marks. Only one face can:
 * see `mushafFonts`. `file` is one file under `public/` whose presence says
 * the face is installed -- `/api/fonts` checks it.
 */
export const FONTS_ARABIC = [
  { id: QPC_V2, name: 'Madani Mushaf', className: 'font-mushaf', family: FALLBACK_ARABIC_FAMILY, mushaf: true, file: 'fonts/qcf/p1.woff2' },
  { id: 'DigitalKhatt', name: 'Digital Khatt', className: 'font-digitalkhatt', family: 'DigitalKhatt New Madina', mushaf: false, file: 'fonts/unicode/DigitalKhattV2.otf' },
  { id: 'DigitalKhattIndoPak', name: 'Digital Khatt IndoPak', className: 'font-digitalkhatt-indopak', family: 'DigitalKhatt IndoPak', mushaf: false, file: 'fonts/unicode/DigitalKhattIndoPak.otf' },
  { id: 'IndopakNastaleeq', name: 'Indopak Nastaleeq', className: 'font-indopak-nastaleeq', family: 'AlQuran IndoPak by QuranWBW', mushaf: false, file: 'fonts/unicode/IndopakNastaleeq.woff2' }
];

/**
 * The CSS family a font id names.
 *
 * The two are not the same string and cannot be: an id is stored in the
 * database and in exported projects, so it has to stay stable, while a family
 * is whatever the font's own name table says -- `IndopakNastaleeq` is served
 * by a face calling itself `AlQuran IndoPak by QuranWBW`. Passing the id to
 * `ctx.font` names nothing, and canvas answers a family it does not have by
 * silently using the next one in the list: every Unicode face rendered as
 * Digital Khatt, identically, which is the bug this exists to prevent.
 */
export function arabicFontFamily(id: string | undefined): string {
  return [...FONTS_ARABIC, BUILTIN_ARABIC_FONT].find(font => font.id === id)?.family || FALLBACK_ARABIC_FAMILY;
}

/**
 * What a project saved before the Google faces were removed should render in.
 *
 * Their ids are still in the database and in exported project files, and a
 * font id that names nothing leaves the canvas drawing in whatever the OS
 * ships. Everything maps to the mushaf: it is what each of them was an
 * imperfect attempt at. That includes `amiri`, the built-in fallback, from
 * the time it could be chosen: it now draws only where the mushaf cannot.
 */
export const FONT_ARABIC_DEFAULT = QPC_V2;

export function resolveArabicFont(id: string | undefined): string {
  return FONTS_ARABIC.some(font => font.id === id) ? (id as string) : FONT_ARABIC_DEFAULT;
}

/**
 * The face to actually draw with, given which ones this installation lacks.
 *
 * Applied when drawing, never written back: a project or preset naming the
 * mushaf keeps naming it, and gets it the moment the fonts are installed.
 * Without the page fonts the mushaf face would draw `word.glyph` -- codepoints
 * that mean nothing outside their own page's font -- as rows of empty boxes,
 * which is what a fresh server showed.
 */
export function usableArabicFont(id: string | undefined, missing: ReadonlySet<string>): string {
  const chosen = resolveArabicFont(id);
  return missing.has(chosen) ? FONT_ARABIC_BUILTIN : chosen;
}

export const ASPECT_RATIOS = [
  { id: '9:16', name: '9:16 Vertical (Shorts / TikTok / Reels)', width: 1080, height: 1920, class: 'aspect-[9/16]' },
  { id: '16:9', name: '16:9 Widescreen (YouTube)', width: 1920, height: 1080, class: 'aspect-[16/9]' },
  { id: '1:1', name: '1:1 Square (Instagram Feed)', width: 1080, height: 1080, class: 'aspect-square' },
  { id: '4:5', name: '4:5 Portrait (Instagram Post)', width: 1080, height: 1350, class: 'aspect-[4/5]' }
];
