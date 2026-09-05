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
}

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
    quranApiId: 0
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

// High quality default pre-configured sample verses with exact timings
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
    audioUrl: "https://server11.mp3quran.net/download/sds/001.mp3",
    audioDuration: "00:43",
    verses: [
      {
        verseNumber: 1,
        verseKey: "1:1",
        textUthmani: "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ",
        translation: "In the name of Allah, the Entirely Merciful, the Especially Merciful.",
        startTime: 0.0,
        endTime: 6.2
      },
      {
        verseNumber: 2,
        verseKey: "1:2",
        textUthmani: "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ",
        translation: "[All] praise is [due] to Allah, Lord of the worlds.",
        startTime: 6.2,
        endTime: 11.5
      },
      {
        verseNumber: 3,
        verseKey: "1:3",
        textUthmani: "ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ",
        translation: "The Entirely Merciful, the Especially Merciful,",
        startTime: 11.5,
        endTime: 16.8
      },
      {
        verseNumber: 4,
        verseKey: "1:4",
        textUthmani: "مَـٰلِكِ يَوْمِ ٱلدَّينِ",
        translation: "Sovereign of the Day of Recompense.",
        startTime: 16.8,
        endTime: 21.4
      },
      {
        verseNumber: 5,
        verseKey: "1:5",
        textUthmani: "إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ",
        translation: "It is You we worship and You we ask for help.",
        startTime: 21.4,
        endTime: 27.6
      },
      {
        verseNumber: 6,
        verseKey: "1:6",
        textUthmani: "ٱهْدِنَا ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ",
        translation: "Guide us to the straight path -",
        startTime: 27.6,
        endTime: 33.1
      },
      {
        verseNumber: 7,
        verseKey: "1:7",
        textUthmani: "صِرَٰطَ ٱلَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ ٱلْمَغْضُوبِ عَلَيْهِمْ وَلَا ٱلضَّآلِّينَ",
        translation: "The path of those upon whom You have bestowed favor, not of those who have evoked [Your] anger or of those who are astray.",
        startTime: 33.1,
        endTime: 43.0
      }
    ]
  },
  {
    title: "Surah Ad-Duha (Emotional Recitation)",
    surahNumber: 93,
    surahNameArabic: "الضحى",
    surahNameEnglish: "Ad-Duha",
    ayahStart: 1,
    ayahEnd: 11,
    reciterId: "sudais",
    reciterName: "Abdul Rahman Al-Sudais",
    audioUrl: "https://server11.mp3quran.net/download/sds/093.mp3",
    audioDuration: "01:25",
    verses: [
      {
        verseNumber: 1,
        verseKey: "93:1",
        textUthmani: "وَٱلضُّحَىٰ",
        translation: "By the morning brightness",
        startTime: 0.0,
        endTime: 4.5
      },
      {
        verseNumber: 2,
        verseKey: "93:2",
        textUthmani: "وَٱلَّيْلِ إِذَا سَجَىٰ",
        translation: "And [by] the night when it covers with darkness,",
        startTime: 4.5,
        endTime: 9.8
      },
      {
        verseNumber: 3,
        verseKey: "93:3",
        textUthmani: "مَا وَدَّعَكَ رَبُّكَ وَمَا قَلَىٰ",
        translation: "Your Lord has not taken leave of you, [O Muhammad], nor has He detested [you].",
        startTime: 9.8,
        endTime: 16.2
      },
      {
        verseNumber: 4,
        verseKey: "93:4",
        textUthmani: "وَلَلْـَٔاخِرَةُ خَيْرٌۭ لَّكَ مِنَ ٱلْأُولَىٰ",
        translation: "And the Hereafter is better for you than the first [life].",
        startTime: 16.2,
        endTime: 23.5
      },
      {
        verseNumber: 5,
        verseKey: "93:5",
        textUthmani: "وَلَسَوْفَ يُعْطِيكَ رَبُّكَ فَتَرْضَىٰ",
        translation: "And your Lord is going to give you, and you will be satisfied.",
        startTime: 23.5,
        endTime: 31.0
      },
      {
        verseNumber: 6,
        verseKey: "93:6",
        textUthmani: "أَلَمْ يَجِدْكَ يَتِيمًۭا فَـَٔاوَىٰ",
        translation: "Did He not find you an orphan and give [you] refuge?",
        startTime: 31.0,
        endTime: 37.8
      },
      {
        verseNumber: 7,
        verseKey: "93:7",
        textUthmani: "وَوَجَدَكَ ضَآلًّۭا فَهَدَىٰ",
        translation: "And He found you lost and guided [you].",
        startTime: 37.8,
        endTime: 44.5
      },
      {
        verseNumber: 8,
        verseKey: "93:8",
        textUthmani: "وَوَجَدَكَ عَآئِلًۭا فَأَغْنَىٰ",
        translation: "And He found you poor and made [you] self-sufficient.",
        startTime: 44.5,
        endTime: 51.8
      },
      {
        verseNumber: 9,
        verseKey: "93:9",
        textUthmani: "فَأَمَّا ٱلْيَتِيمَ فَلَا تَقْهَرْ",
        translation: "So as for the orphan, do not oppress [him].",
        startTime: 51.8,
        endTime: 57.5
      },
      {
        verseNumber: 10,
        verseKey: "93:10",
        textUthmani: "وَأَمَّا ٱلسَّآئِلَ فَلَا تَنْهَرْ",
        translation: "And as for the petitioner, do not repel [him].",
        startTime: 57.5,
        endTime: 64.0
      },
      {
        verseNumber: 11,
        verseKey: "93:11",
        textUthmani: "وَأَمَّا بِنِعْمَةِ رَبِّكَ فَحَدِّثْ",
        translation: "And as for the favor of your Lord, report [it].",
        startTime: 64.0,
        endTime: 73.0
      }
    ]
  },
  {
    title: "Surah Al-Mulk (Verses 1-5)",
    surahNumber: 67,
    surahNameArabic: "الملك",
    surahNameEnglish: "Al-Mulk",
    ayahStart: 1,
    ayahEnd: 5,
    reciterId: "sudais",
    reciterName: "Abdul Rahman Al-Sudais",
    audioUrl: "https://server11.mp3quran.net/download/sds/067.mp3",
    audioDuration: "01:10",
    verses: [
      {
        verseNumber: 1,
        verseKey: "67:1",
        textUthmani: "تَبَـٰرَكَ ٱلَّذِى بِيَدِهِ ٱلْمُلْكُ وَهُوَ عَلَىٰ كُلِّ شَىْءٍۢ قَدِيرٌ",
        translation: "Blessed is He in whose hand is dominion, and He is over all things competent -",
        startTime: 0.0,
        endTime: 12.0
      },
      {
        verseNumber: 2,
        verseKey: "67:2",
        textUthmani: "ٱلَّذِى خَلَقَ ٱلْمَوْتَ وَٱلْحَيَوٰةَ لِيَبْلُوَكُمْ أَيُّكُمْ أَحْسَنُ عَمَلًۭا ۚ وَهُوَ ٱلْعَزِيزُ ٱلْغَفُورُ",
        translation: "[He] who created death and life to test you [as to] which of you is best in deed - and He is the Exalted in Might, the Forgiving -",
        startTime: 12.0,
        endTime: 26.5
      },
      {
        verseNumber: 3,
        verseKey: "67:3",
        textUthmani: "ٱلَّذِى خَلَقَ سَبْعَ سَمَـٰوَٰتٍۢ طِبَاقًۭا ۖ مَّا تَرَىٰ فِى خَلْقِ ٱلرَّحْمَـٰنِ مِن تَفَـٰوُتٍۢ ۖ فَٱرْجِعِ ٱلْبَصَرَ هَلْ تَرَىٰ مِن فُطُورٍۢ",
        translation: "[And] who created seven heavens in layers. You do not see in the creation of the Most Merciful any inconsistency. So return [your] vision; do you see any breaks?",
        startTime: 26.5,
        endTime: 44.0
      },
      {
        verseNumber: 4,
        verseKey: "67:4",
        textUthmani: "ثُمَّ ٱرْجِعِ ٱلْبَصَرَ كَرَّتَيْنِ يَنقَلِبْ إِلَيْكَ ٱلْبَصَرُ خَاسِئًۭا وَهُوَ حَسِيرٌۭ",
        translation: "Then return [your] vision twice again. [Your] vision will return to you humbled while it is fatigued.",
        startTime: 44.0,
        endTime: 56.5
      },
      {
        verseNumber: 5,
        verseKey: "67:5",
        textUthmani: "وَلَقَدْ زَيَّنَّا ٱلسَّمَآءَ ٱلدُّنْيَا بِمَصَـٰبِيحَ وَجَعَلْنَـٰهَا رُجُومًۭا لِّلشَّيَـٰطِينِ ۖ وَأَعْتَدْنَا لَهُمْ عَذَابَ ٱلسَّعِيرِ",
        translation: "And We have certainly beautified the nearest heaven with lamps and have made [from] them what is thrown at the devils and have prepared for them the punishment of the Blaze.",
        startTime: 56.5,
        endTime: 70.0
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

export const FONTS_ARABIC = [
  { id: 'Amiri', name: 'Amiri Uthmani', className: 'font-amiri', googleFont: 'Amiri:ital,wght@0,400;0,700;1,400' },
  { id: 'Scheherazade New', name: 'Scheherazade', className: 'font-scheherazade', googleFont: 'Scheherazade+New:wght@400;700' },
  { id: 'Noto Naskh Arabic', name: 'Noto Naskh', className: 'font-naskh', googleFont: 'Noto+Naskh+Arabic:wght@400;700' },
  { id: 'Reem Kufi', name: 'Kufi Calligraphy', className: 'font-kufi', googleFont: 'Reem+Kufi:wght@400;700' },
  { id: 'Aref Ruqaa', name: 'Aref Ruqaa', className: 'font-ruqaa', googleFont: 'Aref+Ruqaa:wght@400;700' }
];

export const ASPECT_RATIOS = [
  { id: '9:16', name: '9:16 Vertical (Shorts / TikTok / Reels)', width: 1080, height: 1920, class: 'aspect-[9/16]' },
  { id: '16:9', name: '16:9 Widescreen (YouTube)', width: 1920, height: 1080, class: 'aspect-[16/9]' },
  { id: '1:1', name: '1:1 Square (Instagram Feed)', width: 1080, height: 1080, class: 'aspect-square' },
  { id: '4:5', name: '4:5 Portrait (Instagram Post)', width: 1080, height: 1350, class: 'aspect-[4/5]' }
];
