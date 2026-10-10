import type { Locale } from '@/lib/i18n';

/**
 * The words of the landing page and the legal pages' frame, in both of the
 * studio's languages. Kept apart from the studio's dictionary: none of it is
 * shown inside the studio.
 */
export const LANDING_COPY = {
  en: {
    nav: { open: 'Open the studio', language: 'عربي', languageLabel: 'اقرأ هذه الصفحة بالعربية' },
    hero: {
      title: 'Recitation clips, captioned to the voice.',
      body:
        'Choose a reciter and a passage, or bring a recording of your own. Quran-Clipper times every ayah to the recitation, adds the translation you pick, and makes a vertical video for Shorts, Reels and TikTok — in your browser, free.',
      open: 'Open the studio',
      listen: 'Listen',
      pause: 'Pause',
      demoLabel: 'Al-Mulk 67:1–2 · Abdul Rahman Al-Sudais',
      timelineLabel: 'The studio’s timeline for this clip: one block per caption, laid on the recitation.',
      captionOf: (n: number, total: number) => `Caption ${n} of ${total}`,
    },
    steps: {
      title: 'From recitation to video',
      intro: 'The studio has three tabs, in the order you use them, and Export when it looks right.',
      items: [
        {
          tab: '1 · Source',
          title: 'Pick the recitation',
          body:
            'A surah, its ayahs and one of ten reciters — or upload your own recording, audio or video. A built-in reciter arrives already timed; your own is matched to the text for you.',
          video: 'passage',
        },
        {
          tab: '2 · Captions',
          title: 'Check each caption',
          body:
            'Captions split where the reciter pauses, at the stop signs. Choose the translations, hide a word, nudge a boundary — the timeline shows each caption on the recitation.',
          video: 'captions',
        },
        {
          tab: '3 · Style',
          title: 'Give it a look',
          body:
            'Layouts, Quran fonts, colours and backgrounds, with words lighting up as they are recited and soft motion between captions.',
          video: 'style',
        },
        {
          tab: 'Export',
          title: 'Make the video',
          body:
            'The video is rendered on your own device, in the browser, at the size each platform wants. Download it, or send it straight to your YouTube channel.',
          video: 'export',
        },
      ],
    },
    reciters: {
      title: 'Ten reciters, timed ayah by ayah',
      body:
        'Every built-in recording is timed from published word timings and checked against the audio itself — or bring any recitation you have permission to use.',
      own: 'Your own recording',
    },
    facts: {
      title: 'What to expect',
      items: [
        { term: 'Made on your device', text: 'The video renders in your browser. Only a recording of your own goes to the server, to be timed, and it is not kept.' },
        { term: 'Sized for each platform', text: 'YouTube Shorts, Instagram Reels, TikTok and Facebook, with their safe areas shown.' },
        { term: 'Translations', text: 'Choose one or more, shown under the Arabic of every caption.' },
        { term: 'Arabic and English', text: 'The whole studio, right to left or left to right.' },
        { term: 'No account', text: 'Open it and start. Your projects stay in your browser.' },
      ],
    },
    closing: { title: 'Make your first clip', body: 'It takes a minute with a built-in reciter.', open: 'Open the studio' },
    footer: { privacy: 'Privacy policy', terms: 'Terms of service', source: 'Source code', rights: 'Quran-Clipper' },
  },
  ar: {
    nav: { open: 'افتح الاستوديو', language: 'English', languageLabel: 'Read this page in English' },
    hero: {
      title: 'مقاطع تلاوة تظهر آياتها مع صوت القارئ.',
      body:
        'اختر قارئًا ومقطعًا، أو ارفع تسجيلًا من عندك. يضبط Quran-Clipper توقيت كل آية على التلاوة، ويضيف الترجمة التي تختارها، ويصنع مقطعًا عموديًا لـ Shorts وReels وTikTok — في متصفحك، مجانًا.',
      open: 'افتح الاستوديو',
      listen: 'استمع',
      pause: 'إيقاف',
      demoLabel: 'الملك ٦٧: ١–٢ · عبد الرحمن السديس',
      timelineLabel: 'الخط الزمني لهذا المقطع في الاستوديو: كتلة لكل مقطع، موضوعة على التلاوة.',
      captionOf: (n: number, total: number) => `المقطع ${n} من ${total}`,
    },
    steps: {
      title: 'من التلاوة إلى الفيديو',
      intro: 'في الاستوديو ثلاث علامات تبويب بالترتيب الذي تستعملها به، ثم التصدير حين يعجبك ما تراه.',
      items: [
        {
          tab: '١ · المصدر',
          title: 'اختر التلاوة',
          body:
            'سورة وآياتها وواحد من عشرة قرّاء — أو ارفع تسجيلك، صوتًا أو فيديو. تلاوة القارئ المدمج تأتي مضبوطة التوقيت، وتسجيلك يُطابَق مع النص تلقائيًا.',
          video: 'passage',
        },
        {
          tab: '٢ · المقاطع',
          title: 'راجع كل مقطع',
          body:
            'تنقسم المقاطع حيث يقف القارئ، عند علامات الوقف. اختر الترجمات، أخفِ كلمة، حرّك حدًّا — والخط الزمني يُظهر كل مقطع على التلاوة.',
          video: 'captions',
        },
        {
          tab: '٣ · التنسيق',
          title: 'اختر المظهر',
          body: 'تخطيطات وخطوط مصحف وألوان وخلفيات، مع إضاءة الكلمات وهي تُتلى وانتقال هادئ بين المقاطع.',
          video: 'style',
        },
        {
          tab: 'التصدير',
          title: 'اصنع الفيديو',
          body: 'يُصنع الفيديو على جهازك، في المتصفح، بالمقاس الذي تريده كل منصة. نزّله، أو أرسله مباشرة إلى قناتك على YouTube.',
          video: 'export',
        },
      ],
    },
    reciters: {
      title: 'عشرة قرّاء، مضبوطة تلاواتهم آيةً آية',
      body: 'كل تسجيل مدمج مضبوط من توقيتات الكلمات المنشورة ومُراجَع على الصوت نفسه — أو استعمل أي تلاوة لديك إذن باستعمالها.',
      own: 'تسجيلك أنت',
    },
    facts: {
      title: 'ما الذي تجده',
      items: [
        { term: 'يُصنع على جهازك', text: 'يُصنع الفيديو في متصفحك. لا يُرسل إلى الخادم إلا تسجيلك الخاص، لضبط توقيته، ولا يُحتفظ به.' },
        { term: 'بمقاس كل منصة', text: 'YouTube Shorts وInstagram Reels وTikTok وFacebook، مع إظهار المناطق الآمنة.' },
        { term: 'الترجمات', text: 'اختر واحدة أو أكثر، تظهر تحت النص العربي في كل مقطع.' },
        { term: 'بالعربية والإنجليزية', text: 'الاستوديو كله، من اليمين إلى اليسار أو العكس.' },
        { term: 'بلا حساب', text: 'افتحه وابدأ. تبقى مشاريعك في متصفحك.' },
      ],
    },
    closing: { title: 'اصنع أول مقطع لك', body: 'يستغرق دقيقة مع قارئ مدمج.', open: 'افتح الاستوديو' },
    footer: { privacy: 'سياسة الخصوصية', terms: 'شروط الخدمة', source: 'الشيفرة المصدرية', rights: 'Quran-Clipper' },
  },
} satisfies Record<Locale, unknown>;

export type LandingCopy = (typeof LANDING_COPY)['en'];
