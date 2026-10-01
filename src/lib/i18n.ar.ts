import type { Dictionary } from './i18n.en';

/**
 * The studio's interface, in Arabic.
 *
 * Typed against `Dictionary`, so this file cannot drift from the English one:
 * a key that is added there and forgotten here fails `npm run typecheck`.
 *
 * Register: modern standard Arabic, plain rather than ornate. The studio is a
 * tool, and an instruction that reads like a manuscript colophon is harder to
 * follow than one that reads like a button. Where a term is genuinely technical
 * -- WebM, Pexels, Gemini, FPS -- it stays as it is; translating a codec name
 * makes it unsearchable.
 *
 * Quranic vocabulary keeps its own words: سورة, آية, ترتيل, مصحف. "Ayah" is
 * آية, not "verse", and the range separator stays a Latin colon so `2:255`
 * still reads as a reference rather than as a time.
 *
 * Numerals are Western (0-9) throughout, matching the timecodes, hex colours
 * and the `surah:ayah` references the rest of the studio prints.
 */
export const ar: Dictionary = {
  languageName: 'العربية',
  languageShort: 'ع',
  switchLanguage: 'تغيير لغة الاستوديو',

  meta: {
    title: 'Quran Clipper — استوديو فيديوهات التلاوة',
    description:
      'أنشئ فيديوهات تلاوة قرآنية محليًا في المتصفح: مطابقة زمنية للكلمات، ورسم على اللوحة، وتصدير WebM بدقة 1080p/4K وبمعدل 60 إطارًا في الثانية.'
  },

  common: {
    cancel: 'إلغاء',
    apply: 'تطبيق',
    done: 'تم',
    reset: 'إعادة ضبط',
    delete: 'حذف',
    remove: 'إزالة',
    add: 'إضافة',
    close: 'إغلاق',
    play: 'تشغيل',
    pause: 'إيقاف مؤقت',
    playing: 'قيد التشغيل',
    duplicate: 'تكرار',
    moreActions: 'إجراءات أخرى',
    loading: 'جارٍ التحميل…',
    dismiss: 'إخفاء'
  },

  palette: {
    label: 'المظهر',
    title: 'تغيير ألوان الاستوديو',
    names: {
      nocturne: 'ليلي',
      slate: 'أردوازي وعنبري',
      mushaf: 'مصحف',
      graphite: 'جرافيت',
      verdigris: 'زنجاري',
      maghrib: 'مغرب',
      qahwa: 'قهوة',
      parchment: 'رَقّ'
    },
    notes: {
      nocturne: 'كحلي وضوء القمر',
      slate: 'المظهر الأصلي',
      mushaf: 'ذهبي ولازوردي',
      graphite: 'رمادي محايد',
      verdigris: 'أخضر ونحاسي',
      maghrib: 'بنفسجي الغسق ومرجاني الغروب',
      qahwa: 'بنّي محمَّص وهيل',
      parchment: 'فاتح: ورق وحبر'
    }
  },

  header: {
    wordmark: 'Quran Clipper',
    pageTitle: (surah, number, start, end) =>
      `Quran Clipper — ${surah} ${number}:${start}–${end}`,
    undo: 'تراجع',
    undoTitle: 'التراجع عن آخر تغيير (Ctrl+Z)',
    redo: 'إعادة',
    redoTitle: 'إعادة آخر تغيير تم التراجع عنه (Ctrl+Shift+Z)',
    savedClips: 'المشاريع',
    saveToProjects: 'احفظ في المشاريع',
    draftKept: when => `محفوظ في هذا المتصفح · ${when}`,
    notSavedYet: 'لم يُحفظ بعد',
    help: 'مساعدة',
    moreMenu: 'المزيد: المظهر واللغة والأدوات',
    saveProject: 'حفظ المشروع',
    saveProjectTitle: 'حفظ هذا المقطع في قائمة المشاريع',
    healthDatabase: 'قاعدة البيانات',
    healthAligner: 'المحاذي',
    groundTruth: 'مرجع التقييم',
    groundTruthTitle:
      'احفظ هذا المسار الزمني وملفه الصوتي في scripts/ ليُقاس أي تغيير في المحاذاة على المقاطع التي صحّحتها سمعًا',
    groundTruthWriting: 'يُكتب مرجع التقييم…',
    groundTruthWritten: 'حُفظ مرجع التقييم',
    groundTruthDownloaded: 'نُزّل مرجع التقييم',
    groundTruthNeedsAudio: name =>
      `تعذّرت الكتابة في scripts/ من هنا فلم يُرافقه الصوت — ضع ${name} في جذر المستودع قبل تشغيل ‎./gauge.sh‎.`,
    trimAudio: 'قص الصوت',
    trimAudioWithLength: length => `قص الصوت (${length})`,
    trimAudioTitle: 'قص الملف الصوتي المرفوع — تعديلاتك على المسار الزمني محفوظة',
    export: 'تصدير',
    saving: 'جارٍ الحفظ…',
    saved: 'تم حفظ المشروع',
    savedThisSession: 'محفوظ (لهذه الجلسة)',
    savedInBrowser: 'محفوظ في هذا المتصفح',
    saveFailed: 'فشل الحفظ',
    saveFailedStatus: status => `ردّ الخادم بالرمز ${status}.`,
    audioNotStored:
      'تم الحفظ، لكن لم تتّسع مساحة هذا المتصفح للتلاوة. احتفظ بالملف الأصلي — فسيُطلب منك عند إعادة فتح المشروع.'
  },

  surfaces: {
    preview: 'المعاينة',
  },

  frame: {
    label: 'الإطار',
    safeArea: 'أظهر ما يغطيه التطبيق',
    covered: platform => `يغطيه ${platform}`,
    setAbove: 'شكل الإطار يُحدَّد فوق المعاينة، ويفتح التصدير على الإعداد نفسه.'
  },

  panel: {
    label: 'سير العمل',
    source: 'المصدر',
    captions: 'المقاطع',
    style: 'التنسيق',
    toCheck: count => `${count} للمراجعة`
  },

  source: {
    modeLabel: 'من أين تبدأ؟',
    modeReciter: 'قارئ مدمج',
    modeRecording: 'تسجيلي',
    sampleHint: 'هذا مثال جاهز: الفاتحة. اختر مقطعًا لتبدأ مقطعك الخاص.',
    dropTitle: 'أفلت ملف صوت أو فيديو هنا',
    dropHelp:
      'MP3 أو WAV أو M4A أو OGG أو MP4 أو MOV أو WebM أو MKV، حتى نحو 18 ميجابايت (15–20 دقيقة بصيغة MP3). ويمكن أن تكون لقطات الفيديو هي الخلفية.',
    engineLabel: 'أداة التوقيت',
    engineSummary: name => `أداة التوقيت · ${name}`,
    advanced: breaks => `خيارات متقدمة · تقسيم الشرائح: ${breaks}`,
    matchRecording: 'طابِق التسجيل',
    timeByHand: 'وقّته يدويًا',
    chooseFileFirst: 'اختر ملفًا لمطابقته.',
    summaryLabel: 'هذا المقطع',
    yourRecording: 'تسجيلك',
    lengthLabel: 'المدة',
    captionsLabel: 'المقاطع',
    editSource: 'عدّل المصدر والمطابقة',
    backToClip: 'عُد إلى هذا المقطع',
    nextReview: 'التالي: راجِع المقاطع',
    nextReviewBody: count =>
      count === 0 ? 'اقرأها مرة قبل التصدير.' : count === 1 ? 'مقطع واحد يستحق نظرة قبل التصدير.' : `${count} مقاطع تستحق نظرة قبل التصدير.`,
    review: 'راجِع',
    howItWorks: 'كيف يعمل',
    step1Strong: 'اختر قارئًا',
    step1: 'وسورة، أو ارفع تلاوتك الخاصة.',
    step2Before: 'اضغط',
    step2Button: '«تحميل الآيات والصوت»',
    step2After: 'تظهر الآيات على المسار الزمني بالأسفل.',
    step3Before: 'اضغط',
    step3Middle: 'للتشغيل أو الإيقاف، واضغط',
    step3After: 'عند نهاية كل آية لتحديد حدّها.',
    step4Strong: 'اسحب حافة',
    step4: 'أي كتلة على المسار الزمني لضبطها بدقة.',
    step5: 'اضغط على كتلة لاختيار كلماتها وتحرير ترجمتها في تبويب المقاطع.',
    step6Before: 'افتح تبويب',
    step6Strong: 'التنسيق',
    step6After: '، ثم صدّر المقطع.',
    howItWorksNoteBefore: 'ملاحظة: القراء الموسومون بـ',
    howItWorksNoteTimed: 'موقوت',
    howItWorksNoteMiddle:
      'تأتي حدود آياتهم مقاسة من التسجيل نفسه؛ وما عداهم تقديرات تضبطها بنفسك على المسار الزمني. ومطابقة التسجيل تعمل على الملفات',
    howItWorksNoteUploaded: 'المرفوعة',
    howItWorksNoteEnd: 'فقط.',

    chooseFile: 'اختر أو أفلت ملف صوت أو فيديو',
    dropHere: 'أفلته هنا',

    matcherUses: technical => `تستخدم ${technical}`,
    skipAlignerTimed: 'القرّاء المدمجون: استخدم توقيتاتهم المنشورة فقط، دون أداة المحاذاة',
    skipAlignerTimedHelp: 'أسرع، ويعمل دون نموذج المحاذاة. كل آية شريحة واحدة، لا تُقسَم إلا حيث يكرّر القارئ؛ أما أداة المحاذاة فتقسم الآية الطويلة أيضًا حيث يقف القارئ. والملفات المرفوعة تُحاذى كما كانت.',
    screenBreaksLabel: 'تقسيم الشرائح:',
    screenBreaksFewer: 'أقل',
    screenBreaksNormal: 'عادي',
    screenBreaksMore: 'أكثر',
    screenBreaksHelp: '«أقل»: شريحة جديدة عند الوقفات الطويلة فقط. «أكثر»: عند القصيرة أيضًا. نهاية الآية تبدأ شريحة دائمًا. يُطبَّق على المطابقة التالية، وفورًا على تسجيل طوبق من قبل.',
    recutHelp: 'يعيد تقسيم هذه المطابقة فورًا دون مطابقة جديدة. «أقل» يقسم عند الوقفات الطويلة فقط، و«أكثر» عند القصيرة أيضًا.',
    recutting: 'جارٍ إعادة التقسيم…',
    recut: 'أعد التقسيم',
    recutCancel: 'أبقِ تعديلاتي',
    recutReplacesEdits: level => `إعادة التقسيم على «${level}» تستبدل تعديلاتك على الشرائح. Ctrl+Z يعيدها.`,
    screenBreaksUploadsOnly: 'مع التوقيتات المنشورة وحدها، يُطبَّق هذا على الملفات المرفوعة لا على القرّاء المدمجين.',
    matcherLocal: 'محلي',
    matcherLocalTechnical: 'المحاذاة القسرية المحلية',
    matcherLocalBlurb:
      'يعثر على المقطع داخل التسجيل، ثم يوقّت كل كلمة على نص القرآن الثابت، فلا يمكن أن تسقط كلمة أو تُسمع خطأً. ولا يغادر شيء جهازك.',
    matcherLocalFix: 'يتطلب هذا تشغيل التطبيق المساعد المحلي. شغّله ثم أعد تحميل الصفحة.',
    matcherQul: 'محلي + QUL',
    matcherQulTechnical: 'المحاذاة القسرية المحلية مع صرف QUL ومتشابهاته',
    matcherQulBlurb:
      'المطابِق المحلي نفسه، لكنه يستعين كذلك بجذور الكلمات من QUL وبقائمة المقاطع المتشابهة ليحدّد أيّ مقطع قُرئ. جرّبه على التسجيل نفسه مع «محلي» للمقارنة.',
    matcherQulFix:
      'يتطلب هذا تشغيل التطبيق المساعد المحلي واستيراد ملفّي الصرف والمتشابهات من QUL إلى data/qul (node scripts/qul-import.mjs).',
    matcherOnline: 'عبر الإنترنت',
    matcherOnlineTechnical: 'مطابقة Gemini السحابية',
    matcherOnlineBlurb:
      'يعمل دون تثبيت أي شيء، لكن التوقيت مُقدَّر لا مقاس، فتوقّع تصحيحه يدويًا. ويُرسَل الصوت إلى Google.',
    matcherOnlinePublic: 'غير متاح في هذا الاستوديو العام.',
    matcherOnlineFix: 'أضف مفتاح Gemini API لاستخدام هذا الخيار.',
    matcherQulMissing: 'ملفات QUL غير موجودة',
    matcherQulRestart: 'أعد تشغيل التطبيق المساعد',
    matcherQulRestartFix:
      'التطبيق المساعد المحلي يعمل بنسخة أقدم من دعم QUL. أوقفه ثم شغّله من جديد وسيصبح هذا الخيار جاهزًا — فملفات QUL موجودة أصلًا.',
    matcherChecking: 'جارٍ الفحص…',
    matcherReady: 'جاهز',
    matcherHelperNotRunning: 'التطبيق المساعد لا يعمل',
    matcherHelperNeedsRestart: 'التطبيق المساعد يحتاج إعادة تشغيل',
    matcherNeedsApiKey: 'يحتاج مفتاح API',
    matcherDetectionOffBefore:
      'كشف المقطع معطَّل في التطبيق المساعد لديك، لذا سيوقّت السورة والنطاق المحددين تحت «قارئ مدمج» بدل البحث عنهما في الصوت. أزِل ضبط',
    matcherDetectionOffAfter: 'وأعد تشغيله لإعادة تفعيل الكشف.',
    matcherEngineFailedTitle:
      'التطبيق المساعد يعمل لكنه لم يتمكن من تحميل محرك المحاذاة، لذا ستفشل المطابقة.',
    matcherEngineFailedBody:
      'يكاد يكون السبب دائمًا تشغيل الخدمة بإصدار Python خاطئ. أعد تشغيلها من بيئتها الافتراضية:',

    useVideoAsBackground: 'استخدم هذا الفيديو خلفيةً',
    useVideoAsBackgroundHelp: 'تتبع لقطاته الصوت، فتبقى التلاوة متزامنة معها',
    useVideoAsBackgroundOffset: offset => ` (بإزاحة ${offset} بعد القص)`,

    trimHelp:
      'اقصص قبل المطابقة لإزالة الصمت أولًا، أو بعدها لتقليص المسار الزمني الناتج — وفي الحالتين تُضبط أوقات المقاطع على المقطع الجديد تلقائيًا.',

    selectSurah: 'السورة',
    surahOption: (number, english, arabic, ayahs) => `${number}. ${arabic} (${english}) - ${ayahs} آية`,
    startAyah: 'من الآية',
    endAyah: 'إلى الآية',

    selectReciter: 'القارئ',
    reciterTimed: 'موقوت',
    reciterTimedTitle: 'حدود الآيات لهذا القارئ مأخوذة من التسجيل نفسه',
    reciterStyles: {
      Murattal: 'مرتّل',
      Emotional: 'مؤثّر'
    },

    loadVerses: 'تحميل الآيات والصوت',
    loadingVerses: 'جارٍ تحميل الآيات…',
    showOnTimeline: 'عرضها على المسار الزمني',
    loadFailed: 'تعذّر تحميل هذه الآيات. تحقّق من اتصالك وحاول مرة أخرى.',
    loadedCount: count => `تم تحميل ${count} ${count === 1 ? 'آية' : count === 2 ? 'آيتين' : 'آية'}.`,
    loadedAgainstUpload:
      'ملفك المرفوع ما زال هو الصوت المُشغَّل، وهذه الأوقات تخص تسجيل القارئ لا ملفك. طابِق التسجيل، أو اضبط الحدود على المسار الزمني.',
    loadedMeasured: seeked =>
      `حدود الآيات مأخوذة من التسجيل نفسه${seeked ? '، وانتقل مؤشر التشغيل إلى أولها' : ''}.`,
    loadedEstimated:
      'لا توقيتات منشورة لهذا القارئ، فالحدود مُقدَّرة — اضبطها على المسار الزمني قبل التصدير.'
  },

  match: {
    recutDone: (level, count) => `أُعيد التقسيم على «${level}»: ${count} شريحة.`,
    recutExpired: 'لم تعد أداة المحاذاة تحتفظ بهذه المطابقة، فلا يمكن إعادة تقسيمها. طابِق التسجيل من جديد عبر «عدّل المصدر والمطابقة».',
    recutFailed: error => `تعذّرت إعادة التقسيم: ${error}`,
    videoUploaded:
      'تم رفع الفيديو — سيُستخدم صوته للمطابقة ولقطاته خلفيةً. اختر «طابِق التسجيل» لإيجاد الآيات وتوقيتها، أو «وقّته يدويًا» لضبط المقاطع بنفسك.',
    audioUploaded:
      'تم رفع الصوت. اختر «طابِق التسجيل» لإيجاد الآيات وتوقيتها، أو «وقّته يدويًا» لضبط المقاطع بنفسك.',
    audioRestored:
      'استُعيدت التلاوة، مقصوصةً على المقطع نفسه الذي حُفظ به المشروع — والمسار الزمني بالأسفل مطابق له أصلًا.',
    awaitingAudio: name =>
      `أُنشئ هذا المشروع من ${name}، ولم تعد نسخته موجودة في هذا المتصفح. اختر ذلك الملف مجددًا وسيُقصّ ليطابق المسار الزمني.`,
    translationsRemoved: ids =>
      `ترجمة كان هذا المشروع يستخدمها (${ids}) لم تعد منشورة، فأُزيلت. وتعرض البطاقة الآن الترجمات الباقية، أو الافتراضية إن لم يبقَ منها شيء.`,
    trimmed: length =>
      `تم القص إلى ${length}. طابِق التسجيل من جديد على المقطع المقصوص، أو راجع المسار الزمني المعدَّل بالأسفل.`,
    trimmingRange: 'جارٍ قص الصوت إلى المقطع الذي حدّدته…',
    trimRangeFailed: 'تعذّر قص هذا الملف. جرّب نافذة قص الصوت، فهي تبيّن سبب الخطأ.',
    alignLostAyahs: (count, keys) =>
      `حُمّلت الآيات بتوقيتاتها المنشورة. وجُرّبت قراءة التسجيل أيضًا لكنها أسقطت ${count} آية (${keys})، فأُبقيت التوقيتات المحمّلة — استعمل «محاذاة على الصوت» إن أردت التقطيع بالعبارات رغم ذلك.`,
    publishedTimed: (captions, source, split) =>
      split === 'pauses'
        ? `وُقّتت من توقيتات الكلمات المنشورة في ${source} — ${captions} مقطعًا، لا تُقسَم إلا حيث يقف القارئ أو يعيد.`
        : split === 'skipped'
        ? `وُقّتت من توقيتات الكلمات المنشورة في ${source} وحدها كما هو مضبوط في «محلي + QUL» — ${captions} مقطعًا: مقطع لكل آية، وآخر حيثما أعاد القارئ. استعمل «تقسيم» لتقسيم آية طويلة.`
        : `وُقّتت من توقيتات الكلمات المنشورة في ${source} — ${captions} مقطعًا، مقطع لكل آية: تعذّرت قراءة وقفات القارئ من التسجيل فلم تُقسَم الآيات الطويلة. استعمل «تقسيم» لتقسيم آية، أو تأكّد أن المحاذي المحلي يعمل.`,
    noAlignerOnLoad:
      'حُمّلت الآيات، لكن الحدود تقديرية — فالمحاذي المحلي غير مشغَّل ولم يُقرأ التسجيل. شغّله بـ ./start.sh ثم اضغط «محاذاة على الصوت»، أو اضبط الحدود بنفسك على المسار الزمني.',
    reciterNoUrl: 'ليس لصوت هذا القارئ عنوان يستطيع المحاذي جلبه.',
    needLoad: 'حمّل الآيات أولًا ثم حاذِها.',
    passageTooLong: (minutes, limit) =>
      `طول هذا المقطع نحو ${minutes} دقيقة، والمحاذي يستوعب حتى ${limit}. اختر آيات أقل.`,
    alignReciter: 'محاذاة على الصوت',
    segments: 'توقيتات القارئ',
    segmentsTitle:
      'وقّت هذا المقطع من توقيتات الكلمات المنشورة للقارئ نفسه. مقيسة لهذا التسجيل لا مستنبطة من الصوت، وتعطي كل كلمة بدايتها.',
    segmentsLoading: 'قراءة التوقيتات المنشورة للقارئ…',
    qulSegments: 'توقيتات QUL',
    qulSegmentsTitle:
      'وقّت هذا المقطع من توقيتات الكلمات في QUL لهذا القارئ، وشغّل تسجيل QUL له: فالتوقيتات مقيسة على ذلك التسجيل لا على المحمَّل الآن.',
    qulSegmentsUnavailable: reciter =>
      `لا توقيتات QUL لهذا القارئ على هذا الجهاز. نزّل تلاوته سورةً سورةً «مع المقاطع» من qul.tarteel.ai بصيغة JSON وفكّ ضغطها في data/qul/recitations/${reciter}/.`,
    qulSegmentsLoading: 'قراءة توقيتات QUL…',
    qulSegmentsNone: 'لا توقيتات لهذا المقطع في ملف QUL. والطرق الأخرى لتوقيته لم تتأثر.',
    qulSegmentsDone: (ayahs, timed, bounds) =>
      `وُقّتت ${ayahs} آية من QUL — ${timed} كلمةً كلمة${
        bounds > 0 ? `، و${bounds} بحدود الآية فقط` : ''
      }. ويُشغَّل الآن تسجيل QUL الذي قيست عليه هذه التوقيتات.`,
    segmentsUnavailable:
      'لا توقيتات منشورة لهذا القارئ — فتسجيله ليس من التسجيلات المقيسة. استعمل «محاذاة على الصوت» بدلًا من ذلك.',
    segmentsNone:
      'لم ترد توقيتات منشورة لهذا المقطع. والطريقتان الأخريان لتوقيته لم تتأثرا.',
    segmentsDone: (ayahs, timed, bounds) =>
      bounds > 0
        ? `وُقّتت ${ayahs} آية من تسجيل القارئ نفسه — ${timed} بتوقيت كلمة كلمة، و${bounds} بحدود الآية فقط.`
        : `وُقّتت ${ayahs} آية من تسجيل القارئ نفسه، بكل كلماتها.`,
    alignReciterTitle:
      'يقرأ تسجيل القارئ نفسه ويحدّد موضع كل كلمة، بدل تقدير مواضع الآيات.',
    needUpload: 'اختر تسجيلًا قبل مطابقته.',
    queued: (position: number, wait: string | null) =>
      `في الانتظار، رقم ${position}${wait ? ` -- نحو ${wait}` : ''}. تُطابَق تسجيلات آخرين قبلك.`,
    aligning:
      'جارٍ محاذاة نطاق الآيات المحدد على تسجيلك (التشغيل الأول يحمّل النموذج — وقد يستغرق وقتًا أطول)...',
    timingPublished: 'جارٍ توقيت المقطع من توقيتات القارئ المنشورة لكل كلمة...',
    sendingToGemini: 'جارٍ إرسال الصوت إلى Gemini للتحليل...',
    notConfigured: 'أداة المطابقة غير مهيّأة. وقّت هذا التسجيل يدويًا بدلًا من ذلك.',
    failed: 'فشلت المطابقة. وقّته يدويًا، أو تحقق من أداة التوقيت وحاول مجددًا.',
    detected: (label, segments) => `تم التعرّف على ${label} — ${segments} مقطعًا. `,
    fallbackSurahLabel: number => `سورة رقم ${number}`,
    confirmRange:
      'تأكّد من أن هذه هي السورة ونطاق الآيات الصحيحان لتسجيلك، ثم راجع التوقيتات بالأسفل قبل النشر.',
    reviewTimings: 'راجع التوقيتات والنصوص بالأسفل قبل النشر.',
    manualMode: 'التوقيت اليدوي: اضبط بداية كل مقطع ونهايته على المسار الزمني، وآيته من المقاطع › المزيد.'
  },

  audioErrors: {
    aborted: 'أُلغي تحميل الصوت.',
    network: 'خطأ في الشبكة — تعذّر الوصول إلى خادم الصوت. تحقّق من اتصالك بالإنترنت.',
    decode: 'فشل فك ترميز الصوت. قد يكون الملف تالفًا أو بصيغة غير مدعومة.',
    unsupported: 'مصدر الصوت غير مدعوم أو غير موجود. قد يكون رابط القارئ غير صحيح لهذه السورة.',
    unknown: code => `تعذّر تحميل الصوت (خطأ ${code}).`,
    hint: 'جرّب قارئًا آخر، أو ارفع ملفًا صوتيًا خاصًا بك.'
  },

  draft: {
    title: 'عمل من زيارتك السابقة',
    describe: (project, when) => `${project} — آخر تعديل ${when}.`,
    restore: 'استعادته',
    dismiss: 'تجاهل',
    audioMissing: name =>
      `كانت التلاوة ملفك المرفوع ${name}، ولا يمكن فتحه تلقائيًا — استعد المسار ثم اختر الملف نفسه مرة أخرى.`,
    backgroundsMissing: count =>
      `تعذّر حفظ ${count} من الخلفيات المرفوعة. أضفها من جديد من خلفياتك.`,
    restored: 'تمت الاستعادة من زيارتك السابقة.',
    savedAt: when => `حُفظت المسودة ${when}`,
    savedTitle: 'محفوظة في هذا المتصفح حتى لا يضيع العمل عند التحديث أو التعطّل. وهي ليست مقطعًا محفوظًا.'
  },

  translations: {
    dialogLabel: 'اختيار الترجمات',
    title: 'الترجمات',
    help: max =>
      `اختر حتى ${max}. تظهر أسفل النص العربي بالترتيب الذي تختاره — لغة واحدة أو لغتان معًا.`,
    selected: (count, max) => `على البطاقة (${count}/${max}):`,
    searchPlaceholder: 'ابحث عن لغة أو مترجم…',
    loading: 'جارٍ تحميل قائمة الترجمات…',
    failed: 'تعذّر تحميل القائمة. والترجمة الموجودة على البطاقة تعمل كما هي.',
    noMatches: query => `لا نتائج لـ «${query}».`,
    rtlBadge: 'من اليمين',
    remove: name => `إزالة ${name}`,
    keepOne: 'تبقى ترجمة واحدة على الأقل — لإخفائها كلها استخدم مفتاح الترجمة.',
    atLimit: max => `${max} هو أقصى ما يتّسع ويبقى مقروءًا. أزِل واحدة أولًا.`,

    panelLabel: 'الترجمات',
    everyCaption: 'تظهر تحت النص العربي في كل مقطع',
    change: 'تغيير'
  },

  batch: {
    open: 'افتح',
    title: 'مطابقة عدة تسجيلات',
    button: 'مطابقة عدة تسجيلات…',
    help: matcher =>
      `اختر تلاوات، صوتًا أو فيديو، وتُطابَق واحدة بعد أخرى بأداة «${matcher}» التي تجد المقطع وحدها. افتح أي نتيجة في الاستوديو، أو احفظها كلها مشاريع بالمظهر الحالي.`,
    choose: 'اختر التسجيلات',
    start: count => `طابِق ${count} تسجيل`,
    stop: 'توقف بعد هذا',
    saveAll: 'احفظ الكل مشاريع',
    saved: 'حُفظ',
    remove: 'احذف من القائمة',
    found: (title, captions) => `${title} · ${captions} مقطع`,
    notReady: 'أداة المطابقة المحلية لا تعمل. شغّل التطبيق المساعد ثم أعد المحاولة.',
    keepOpen: 'تجري المطابقة في هذا التبويب. أبقه مفتوحًا حتى تنتهي القائمة.'
  },
  exportQueue: {
    label: 'طابور التصدير',
    heading: count => `الطابور · ${count} تصدير`,
    run: count => `صدّر الطابور (${count})`,
    cancel: 'أوقف الطابور',
    clear: 'امسح المنتهي',
    cancelled: 'أُوقف',
    moveUp: 'أبكر',
    moveDown: 'أبعد',
    remove: 'احذف من الطابور',
    keepOpen: 'يعمل الطابور في هذا التبويب. أبقه مفتوحًا حتى تنتهي كل التصديرات.'
  },
  serverRender: {
    label: 'تصديرات في الخلفية',
    heading: count => `تصديرات في الخلفية · ${count}`,
    sending: 'يُرسل إلى الخادم…',
    note: 'يستمر التصدير بعد إغلاق هذا التبويب.',
    queued: 'في الانتظار',
    rendering: percent => `يُصدَّر · ${percent}%`,
    finishing: 'تُضاف التلاوة…',
    failed: 'تعذّر',
    cancelled: 'أُلغي',
    cancel: 'ألغِ هذا التصدير',
    remove: 'احذفه من القائمة',
    sendFailed: reason => `تعذّر إرسال التصدير: ${reason}`
  },
  presets: {
    heading: 'قوالب جاهزة',
    showAll: count => `الكل (${count})`,
    help: 'مظهر كامل بنقرة واحدة: الخط والألوان والبطاقة والتخطيط ونمط الشارة والخلفية. ويبقى نص الشارة وترجماتك والعلامة المائية ونسبة الأبعاد كما هي.',
    items: {
      'night-mosque': { name: 'مسجد الليل', note: 'المظهر الافتراضي للاستوديو: رسم المصحف على مسجد تحت القمر، بلمسات زرقاء هادئة.' },
      'gold-kaaba': { name: 'الكعبة الذهبية', note: 'ذهب دافئ فوق الكعبة، مع تعتيم وتمويه خفيفين، تحت ترويسة بإطار المصحف.' },
      starlight: { name: 'ضوء النجوم', note: 'الخط الرقمي مباشرة على سماء مرصّعة بالنجوم، بلا بطاقة، بلمسات بنفسجية فاتحة.' },
      minimal: { name: 'بسيط', note: 'بلا بطاقة ولا مؤشر صوت، مع وسم صغير في الزاوية: خط عربي كبير مباشرة على سماء مموّهة.' },
      'madinah-green': { name: 'أخضر المدينة', note: 'المسجد النبوي بلمسات خضراء، وترويسة السورة بالخط، والعربية والترجمة كلٌّ في بطاقة.' },
      indopak: { name: 'هندي', note: 'نستعليق هندي في بطاقة تحت مئذنة مقمرة، مع وسم صغير في الزاوية، بلمسات كهرمانية.' }
    }
  },
  shortcuts: {
    open: 'الاختصارات',
    openTitle: 'كل اختصارات لوحة المفاتيح (?)',
    dialogLabel: 'اختصارات لوحة المفاتيح',
    title: 'اختصارات لوحة المفاتيح',
    hint:
      'تعمل هذه الاختصارات في كل أنحاء الاستوديو عدا داخل حقول النص — فهناك تكتب المفاتيح حروفها، ويتراجع Ctrl+Z عمّا كتبته.',
    macNote: 'على أجهزة Mac استخدم ⌘ بدل Ctrl.',
    playPause: 'تشغيل التلاوة أو إيقافها',
    markEnd: 'إنهاء الآية المحدّدة عند المؤشر',
    nextToCheck: 'الانتقال إلى المقطع التالي المعلَّم للمراجعة',
    undo: 'التراجع عن آخر تغيير في المسار أو التنسيق',
    redo: 'إعادة تنفيذ ما تم التراجع عنه',
    list: 'فتح هذه القائمة',
    dismiss: 'إغلاق هذه القائمة أو أي نافذة'
  },

  timeline: {
    dragToReorder: 'اسحبه لتغيير ترتيبه',
    label: 'المسار الزمني',
    playRecitation: 'تشغيل التلاوة',
    pauseRecitation: 'إيقاف التلاوة',
    backToStart: 'العودة إلى البداية',
    rippleOnTitle:
      'مفعّل: تحريك نهاية مقطع يزيح كل المقاطع بعده ويُبقي الخط مرصوصًا. أزل التحديد لتحريك حافة واحدة في كل مرة.',
    rippleLabel: 'أزِح المقاطع التالية حين أسحب',
    rippleOffTitle:
      'معطّل: تتحرك كل حافة وحدها، وتقف النهاية عند بداية المقطع التالي. حدّده لتعود إزاحة المقاطع بعدها.',
    markAyahEnd: 'حدّد نهاية المقطع',
    markAyahEndTitle: 'أنهِ هذا المقطع عند مؤشر التشغيل وانتقل إلى التالي (B)',
    nextToCheck: count => `${count} للمراجعة · التالي`,
    nextToCheckTitle: count =>
      `${count} من المقاطع معلَّمة للمراجعة، حيث كان التطابق أقل يقينًا. انتقل إلى التالي (N).`,
    toCheck: 'معلَّم للمراجعة',
    trimAudio: 'قص الصوت',
    trimAudioTitle: 'قص الملف الصوتي المرفوع — تعديلاتك على المسار الزمني محفوظة',
    keep: length => `الإبقاء على ${length}`,
    cutDownTo: (start, end) => `قص الصوت ليصبح من ${start} إلى ${end}`,
    resetClip: 'إعادة مقبضَي المقطع إلى التسجيل كاملًا',
    mute: 'كتم الصوت',
    unmute: 'إلغاء الكتم',
    volume: 'مستوى الصوت',
    readingAudio: 'جارٍ قراءة الصوت…',
    waveformUnavailable: 'الموجة غير متاحة',
    zoomIn: 'تكبير',
    zoomOut: 'تصغير',
    clip: 'المقطع',
    playhead: 'مؤشر التشغيل',
    backgrounds: 'الخلفيات',
    moveClipStart: 'تحريك بداية المقطع',
    moveClipEnd: 'تحريك نهاية المقطع',
    dragClipStart: 'اسحب لتحريك موضع بداية الصوت',
    dragClipEnd: 'اسحب لتحريك موضع نهاية الصوت',
    dragToEdit: ' · اسحب للتحريك، واسحب حافة لتغيير الطول',
    clipLength: length => `طول المقطع ${length}`,
    clipRepeats: times => `يُعاد ${times}× هنا`,
    clipRepeatsAria: (name, times) => `${name} يتكرر ${times} مرات في هذه الكتلة`,
    moveStartOf: name => `تحريك بداية ${name}`,
    moveEndOf: name => `تحريك نهاية ${name}`,
    empty: 'لا آيات محمّلة بعد — اختر سورة من اللوحة الجانبية، أو ارفع تلاوة.'
  },

  inspector: {
    captionOf: (n, total) => `المقطع ${n} من ${total}`,
    ayahSpan: (verseKey, start, end, length) => `الآية ${verseKey} · ${start} – ${end} · ${length}`,
    previous: 'المقطع السابق',
    next: 'المقطع التالي',
    onScreen: 'على الشاشة',
    tapToHide: 'اضغط كلمة لإخفائها',
    timing: 'التوقيت',
    startsLabel: 'البداية',
    endsLabel: 'النهاية',
    nudgeHint: 'بخطوات 0.2 ثانية. للتحريك الأكبر اسحب حافة المقطع على المسار الزمني.',
    mergeWithNext: 'ادمجه مع التالي',
    splitHere: 'قسّم عند المؤشر',
    delete: 'حذف',
    moreActions: 'المزيد',
    addCaption: 'أضف مقطعًا',
    empty: 'اختر آية على المسار الزمني لاختيار كلماتها وتحرير ترجمتها.',
    matchConfidence: percent => `تطابق ${percent}%`,
    checkTitle: 'تستحق المراجعة',
    checkStopMark:
      'ينتهي هذا السطر عند علامة وقف، لكن لم يُسمع توقف هناك. إن تابع القارئ دون توقف فادمجه مع المقطع التالي.',
    checkLowMatch: percent =>
      `لم يكن المُحاذي واثقًا من هذا المقطع (${percent}%). شغّله وتحقق من بدايته ونهايته.`,
    looksRight: 'يبدو صحيحًا',
    moveStartEarlier: 'تقديم البداية',
    moveStartLater: 'تأخير البداية',
    moveEndEarlier: 'تقديم النهاية',
    moveEndLater: 'تأخير النهاية',
    ayahNumber: 'رقم الآية',
    translation: 'الترجمة',
    alsoAppears: (verseKey, count, examples) =>
      count === 1
        ? `تُتلى هذه الكلمات نفسها في ${examples} أيضًا. وهذا المقطع مُعلَّم بـ ${verseKey}، فإن كان القارئ على الموضع الآخر فرقم الآية الظاهر في الفيديو خطأ.`
        : `تُتلى هذه الكلمات نفسها في ${count} مواضع أخرى — ${examples}${count > 4 ? '، وغيرها' : ''}. وهذا المقطع مُعلَّم بـ ${verseKey}، فإن كان القارئ على أحد تلك المواضع فرقم الآية الظاهر في الفيديو خطأ.`,
    translationFollowsWords: 'ترجم هذه الكلمات وحدها',
    translationFollowsWordsHint:
      'يتبع النصُ أسفل العربي الكلماتِ المحدَّدة بدل الآية كاملة، ويستعمل ترجمة quran.com الإنجليزية كلمةً كلمة.',
    oneGlossLine: count =>
      count === 1
        ? 'الترجمة الأخرى مخفيّة ما دام هذا الخيار مفعّلًا: معاني الكلمات مصدرها إنجليزيّ واحد كلمةً كلمة، فستعرض السطر نفسه حرفيًّا. أزل التحديد لتحريرها وحدها.'
        : `${count} ترجمات أخرى مخفيّة ما دام هذا الخيار مفعّلًا: معاني الكلمات مصدرها إنجليزيّ واحد كلمةً كلمة، فستعرض السطر نفسه حرفيًّا. أزل التحديد لتحريرها وحدها.`,
    wordByWord: 'كلمة كلمة',
    wordByWordFrom: (language, provider) => `${language} · ${provider}`,
    moveAyahEarlier: 'تقديم الآية',
    moveAyahLater: 'تأخير الآية',
    splitHint: 'إنهاء هذا المقطع عند المؤشر وبدء التالي منه',
    splitTooShort: 'حرّك المؤشر إلى داخل المقطع لتتمكن من تقسيمه',
    splitOneWord: 'لا يمكن تقسيم مقطع لا يظهر فيه سوى كلمة واحدة',
    merge: 'دمج',
    mergeHint: 'دمج هذا المقطع مع الذي يليه',
    mergeNotSameAyah: 'لا يمكن الدمج إلا داخل الآية الواحدة'
  },

  style: {
    tabDesign: 'النص',
    tabBackground: 'الخلفية',
    tabCard: 'البطاقة',
    mushafLines: 'اتّبع أسطر المصحف',
    mushafLinesHint:
      'اكسر النص العربي حيث تكسره الصفحة المطبوعة، لا حيث تضيق البطاقة. والسطر الطويل يصغر خطه بدل أن يُكسر من جديد.',
    headingBranding: 'العلامة المائية',

    bgModeLabel: 'طريقة استخدام الخلفيات:',
    bgModes: {
      single: 'خلفية واحدة',
      'per-ayah': 'خلفية لكل مقطع',
      cycle: 'تبديل دوري',
      shuffle: 'عشوائي',
      custom: 'ترتيب يدوي'
    },
    bgModeHints: {
      single: 'مقطع واحد يتكرر.',
      'per-ayah': 'ينتقل إلى الخلفية التالية عند بداية كل مقطع.',
      cycle: 'يتغيّر كل بضع ثوانٍ.',
      shuffle: 'يختار مقطعًا لكل آية، بالترتيب نفسه في كل مرة.',
      custom:
        'أي عدد من المقاطع، كلٌّ منها بالمدة التي تريدها. يأخذ التوزيع الحالي كما هو ويتيح لك سحبه على المسار الزمني.'
    },
    secondsPerBackground: 'ثوانٍ لكل خلفية:',

    laneSummary: blocks =>
      `مقصوص يدويًا على المسار الزمني — ${blocks} ${blocks === 1 ? 'كتلة' : blocks === 2 ? 'كتلتان' : 'كتلة'}.`,
    laneHelp:
      'اسحب كتلة لتحريكها، أو حافة لتغيير مدة تشغيلها؛ ومدّها أطول من المقطع نفسه يعيد تشغيله فحسب. وفي القائمة أدناه، اسحب أحدها من مقبضه لتضع مقطعًا آخر في تلك الخانة دون تحريك مواضع التبديل. اختر وضعًا بالأعلى للعودة إلى الوضع التلقائي.',
    removeBlockAria: (name, start) => `إزالة ${name} عند ${start} ثانية`,

    sequenceEmpty:
      'اضغط على الصور المصغّرة بالأسفل لإضافة خلفيات. وبدون أي اختيار يعمل هذا الوضع كخلفية واحدة.',
    sequenceCount: count => `${count} في التسلسل، بترتيب التشغيل — وقد يتكرر المقطع الواحد أكثر من مرة.`,
    sequenceReorder: 'اسحب أحدها من مقبضه لإعادة ترتيبه.',
    moveEarlier: name => `تقديم ${name}`,
    moveLater: name => `تأخير ${name}`,
    removeFromSequenceAria: (name, position) => `إزالة ${name} من الموضع ${position}`,

    galleryLabelLane: 'أضف خلفية إلى نهاية المسار:',
    galleryLabelSingle: 'الخلفيات:',
    galleryLabelMulti: 'اختر خلفياتك:',
    galleryHelp:
      'الخلفيات الجاهزة أولًا، ثم ما رفعته أو ألصقت رابطه بالأسفل. مرّر المؤشر فوق خلفياتك الخاصة لحذفها.',
    tileLength: length => `مدته ${length}`,
    tileMissing: 'لم يعد هذا الملف موجودًا على هذا الجهاز، أو توقّف الرابط عن العمل',
    tileAddToLane: 'أضف كتلة لهذا المقطع في نهاية المسار',
    tileAddToSequence: 'أضفها إلى التسلسل — اضغط مرة أخرى لاستخدامها أكثر من مرة',
    tileNotFound: 'الملف غير موجود — أضفه من جديد أو أزِل مدخله',
    removeBackgroundTitle: 'إزالة هذه الخلفية؟',
    removeBackgroundMissingMessage: name => `«${name}» لم تعد موجودة. إزالتها تمسح المدخل فحسب.`,
    removeBackgroundMessage: (name, inUse) =>
      `ستُزال «${name}» من خلفياتك${inUse ? '، ومن هذا الفيديو حيث تُستخدم' : ''}. ولا تتأثر الخلفيات الجاهزة.`,
    removeBackgroundTooltip: 'إزالة من خلفياتك',
    removeBackgroundAria: name => `إزالة ${name} من خلفياتك`,

    browsePexels: 'تصفّح مقاطع فيديو مجانية على Pexels',
    browsePexelsHelp: 'انسخ رابط الصفحة من شريط العنوان والصقه بالأسفل.',

    pasteLinkLabel: 'الصق رابط فيديو أو صورة:',
    pasteLinkPlaceholder: 'رابط ‎.mp4‎، أو رابط صفحة على Pexels',
    pasteLinkHelp:
      'رابط صفحة Pexels من شريط العنوان يعمل هنا — يُستخرج منه ملف الفيديو تلقائيًا.',
    urlNotALink: 'هذا لا يبدو رابطًا.',
    urlChecking: 'جارٍ فحص الرابط…',
    urlAdded: 'أُضيف إلى خلفياتك.',
    urlLookingUp: 'جارٍ البحث عنه على Pexels…',
    urlPexelsFailed: 'تعذّر تحليل رابط Pexels هذا.',
    urlAddedWithCredit: credit => `أُضيف — ${credit} على Pexels.`,
    urlResolverUnreachable: 'تعذّر الوصول إلى أداة تحليل الروابط.',

    uploadLabel: 'ارفع فيديوهات أو صورًا خاصة بك:',
    uploadBrowse: 'اختر أو أفلت ملفات فيديو وصور',
    uploadDropHere: 'أفلتها هنا',
    uploadHelp:
      'اختر أو أفلت ما شئت منها دفعةً واحدة. تُحفَظ في هذا المتصفح، فتبقى في القائمة في المرة القادمة. ومسح بيانات الموقع يزيلها، فيظهر مدخلها عندئذٍ كمفقود بدل أن يختفي.',
    uploadAdded: name => `أُضيفت «${name}» — وستبقى هنا في المرة القادمة.`,
    uploadAddedMany: count => `أُضيفت ${count} خلفيات — وستبقى هنا في المرة القادمة.`,
    uploadNotStored: name =>
      `«${name}» موجودة في هذا الفيديو، لكن تعذّر حفظها للمرة القادمة — رفضها المتصفح، وغالبًا لنفاد المساحة المخصصة لهذا الموقع.`,
    uploadSomeNotStored: (failed, kept) =>
      `${kept === 0 ? `تعذّر حفظ ${failed} منها جميعًا` : `تعذّر حفظ ${failed} من ${failed + kept}`} للمرة القادمة — رفضها المتصفح، وغالبًا لنفاد المساحة المخصصة لهذا الموقع. وهي في هذا الفيديو على أي حال.`,

    overlayOpacity: 'عتامة الطبقة الداكنة:',
    backgroundBlur: 'ضبابية الخلفية:',

    arabicFontLabel: 'الخط العربي:',
    fonts: {
      'qpc-v2': 'المصحف المدني',
      DigitalKhatt: 'الخط الرقمي',
      DigitalKhattIndoPak: 'الخط الرقمي الهندي',
      IndopakNastaleeq: 'نستعليق هندي'
    },
    fontNotInstalled: 'الخطوط الباهتة غير مثبّتة على هذا الخادم، ومصدرها أرشيفات QUL -- انظر «خطوط المصحف» في ملف README.',
    fontFallback: 'الخط المختار غير مثبّت على هذا الخادم، فيُرسم النص العربي بخط الأميري إلى أن يُثبَّت.',
    arabicFontSize: 'حجم الخط العربي:',
    translationFontSize: 'حجم خط الترجمة:',
    ayahNumberSize: 'حجم رقم الآية:',

    coloursLabel: 'الألوان:',
    colourArabic: 'النص العربي',
    colourArabicDescription: 'الآية نفسها.',
    colourAccent: 'اللون المميّز',
    colourAccentDescription: 'شارة السورة، ورقم الآية، والفاصل، وأعمدة مؤشر الصوت، وإطار البطاقة.',
    colourTranslation: 'نص الترجمة',
    colourTranslationDescription: 'السطر الإنجليزي تحت النص العربي.',

    cardOpacity: 'عتامة البطاقة الزجاجية:',
    badgeOpacity: 'عتامة الشارة:',
    badgeTextLabel: 'نص شارة السورة:',
    badgeTextPlaceholder: 'اتركه فارغًا لعنوان تلقائي بالسورة والنطاق',
    badgeTextHelp: 'اتركه فارغًا ليُولَّد تلقائيًا من السورة ونطاق الآيات المكتشفين.',
    badgeSubtitleLabel: 'العنوان الفرعي للشارة:',
    badgeSubtitlePlaceholder: 'عنوان فرعي اختياري تحت عنوان الشارة',
    badgeSubtitleHelp: 'اتركه فارغًا لإخفاء السطر الثاني من الشارة.',
    cardBorder: 'إطار البطاقة',
    textShadow: 'ظل النص',
    audioVisualizer: 'مؤشر الصوت',
    surahBadge: 'شارة السورة',
    englishTranslation: 'الترجمة',

    watermarkLabel: 'العلامة المائية / المعرّف:',
    watermarkPlaceholder: '@MyDawahChannel',
    watermarkPositionLabel: 'موضع العلامة المائية:',
    watermarkPositions: {
      'bottom-right': 'أسفل اليمين',
      'bottom-left': 'أسفل اليسار',
      'top-right': 'أعلى اليمين',
      'top-left': 'أعلى اليسار'
    },

    layoutLabel: 'التخطيط:',
    layouts: {
      card: 'بطاقة في الوسط',
      open: 'بلا بطاقة',
      split: 'العربية والترجمة منفصلتان'
    },
    badgeStyleLabel: 'الشارة:',
    badgeStyles: {
      none: 'بلا شارة',
      pill: 'كبسولة',
      calligraphic: 'ترويسة بالخط',
      frame: 'إطار المصحف',
      corner: 'وسم في الزاوية'
    },
    badgeFontMissing: 'تحتاج ترويسة الخط إلى خط أسماء السور، وهو غير مثبت على هذا الخادم. راجع الملف README، قسم «خطوط المصحف وبيانات QUL».'
  },

  colorField: {
    pickAny: 'اختر أي لون',
    pickAnyFor: label => `${label}: اختر أي لون`,
    hexValue: label => `قيمة ${label} الست عشرية`,
    hue: 'درجة اللون',
    saturation: 'التشبّع',
    lightness: 'السطوع'
  },

  backgrounds: {
    titles: {
      'mosque-moon': 'مسجد مضاء والقمر',
      'starry-sky': 'ليل كوني مرصّع بالنجوم',
      'aerial-mosque': 'مسجد ذهبي من الأعلى',
      'milky-way': 'درب التبانة فوق المحيط',
      'clouds-night': 'غيوم ليلية هادئة',
      'prophet-mosque': 'المسجد النبوي بالمدينة',
      'minaret-moonlit': 'مئذنة وسماء مقمرة',
      'aerial-mosque-night': 'مسجد ليلًا من الأعلى',
      'urban-mosque-night': 'مسجد وسط المدينة ليلًا',
      'kaaba-pilgrims': 'الحجّاج حول الكعبة',
      'kaaba-daylight': 'الكعبة في وضح النهار'
    },
    categories: {
      Nature: 'طبيعة',
      Mosque: 'مساجد',
      Makkah: 'مكة',
      Yours: 'خلفياتك',
      Missing: 'مفقودة'
    },
    uploadedImage: 'صورة مرفوعة',
    uploadedClip: 'مقطع مرفوع',
    pastedImage: 'صورة ملصقة',
    pastedClip: 'مقطع ملصق',
    generic: 'خلفية'
  },

  trim: {
    dialogLabel: 'قص الصوت',
    title: 'قص الصوت',
    help:
      'اسحب المسطرة لتحريك مؤشر التشغيل؛ واسحب المقبضين العنبريين لتحديد ما تريد الإبقاء عليه. اسحب هذا الشريط لتحريك النافذة، أو زاويتها السفلية لتكبير كل ما فيها.',
    resetWindow: percent => `إعادة ضبط النافذة (${percent}%)`,
    readingAudio: 'جارٍ قراءة الصوت…',
    decodeFailed: 'تعذّرت قراءة هذا الملف الصوتي للقص. جرّب ملفًا آخر، أو تابع دون قص.',
    trimFailed: 'تعذّر قص هذا الملف الصوتي.',
    playhead: 'مؤشر التشغيل',
    zoomIn: 'تكبير',
    zoomOut: 'تصغير',
    dragPlayhead: 'اسحب لتحريك مؤشر التشغيل',
    dragSelectionStart: 'اسحب لتحريك بداية التحديد',
    dragSelectionEnd: 'اسحب لتحريك نهاية التحديد',
    startLabel: 'البداية (د:ثث.ث)',
    endLabel: 'النهاية (د:ثث.ث)',
    selectedLength: 'مدة التحديد',
    playFromPlayhead: 'التشغيل من مؤشر التشغيل',
    previewSelection: 'معاينة التحديد',
    previewSelectionTitle: 'تشغيل المنطقة المحددة فقط',
    startHere: 'البداية هنا',
    startHereTitle: 'نقل البداية إلى مؤشر التشغيل',
    endHere: 'النهاية هنا',
    endHereTitle: 'نقل النهاية إلى مؤشر التشغيل',
    applyTrim: 'تطبيق القص',
    trimming: 'جارٍ القص…',
    resizeWindow: 'تغيير حجم نافذة القص',
    resizeWindowTitle: 'اسحب لتغيير حجم النافذة كاملة'
  },

  renderCheck: {
    button: 'افحص هذا التصدير',
    running: 'جارٍ قراءة الملف…',
    failed: 'تعذّر على هذا المتصفح قراءة الملف لفحصه.',
    ok: {
      length: seconds => `المدة ${seconds}، كما قُصّت.`,
      start: at => `يبدأ عند ${at} من التسجيل، حيث يبدأ القص.`,
      end: at => `ينتهي عند ${at} من التسجيل، حيث ينتهي القص.`
    },
    problem: {
      length: (seconds, expected) => `المدة ${seconds}، لكن القص ${expected}.`,
      start: (at, expected) => `يبدأ عند ${at} من التسجيل، لكن القص يبدأ عند ${expected}: البداية مقطوعة.`,
      end: (at, expected) => `ينتهي عند ${at} من التسجيل، لكن القص ينتهي عند ${expected}.`
    },
    unsure: {
      length: 'تعذّرت قراءة مدة الملف.',
      start: 'تعذّرت مطابقة البداية مع التسجيل (الصوت خافت هناك، أو تعذّرت قراءة التسجيل).',
      end: 'تعذّرت مطابقة النهاية مع التسجيل (الصوت خافت هناك، أو تعذّرت قراءة التسجيل).',
      background: 'تعذّر أخذ عينات من الخلفية في هذا الملف.'
    },
    backgroundOk: 'الخلفية حاضرة ومتحركة طوال المقطع.',
    backgroundMissing: (from, to) => `لا خلفية من ${from} إلى ${to}: يظهر التدرّج العادي بدلًا منها.`,
    backgroundStill: (from, to) => `الخلفية لا تتحرك من ${from} إلى ${to}: تأكّد أنها لم تتجمّد.`
  },

  exportModal: {
    dialogLabel: 'تصدير الفيديو',
    title: 'تصدير',
    subtitle: encoder => `يرمّز إطارًا بإطار عبر WebCodecs (${encoder})`,
    subtitleRecorder: encoder => `يسجّل اللوحة في الزمن الحقيقي عبر MediaRecorder (${encoder})`,
    detectedGpu: 'كرت الرسوميات المكتشف',
    gpuNotReported: 'المتصفح لا يفصح عن كرت الرسوميات',
    frameRateLabel: 'معدل الإطارات',

    beforeYouPublish: 'قبل النشر:',
    beforeYouPublishBody:
      'راجع بنفسك كل آية وتوقيتها وترجمتها. أنت المسؤول عمّا تنشره.',

    presetLabel: 'إلى أين سيُنشر؟',
    destinationsHint: 'اختر وجهة أو أكثر',
    relaidOut: ratio => `يُعاد ترتيبه إلى ${ratio}`,
    tooLong: 'أطول مما تقبله هذه المنصة',
    fpsValue: fps => `${fps} إطارًا/ث`,
    videos: count => (count === 1 ? 'فيديو واحد' : `${count} فيديوهات`),
    noDestination: 'اختر إلى أين سيُنشر الفيديو',
    renderVideos: count => (count > 1 ? `صدّر ${count} فيديوهات` : 'صدّر الفيديو'),
    renderOnServer: 'صدّر على الخادم ليمكن إغلاق هذا التبويب',
    presets: {
      tiktok: 'TikTok',
      reels: 'Instagram Reels',
      shorts: 'YouTube Shorts',
      'ig-portrait': 'Instagram طولي',
      'ig-feed': 'Instagram مربّع',
      youtube: 'YouTube',
      facebook: 'Facebook Reels'
    },
    qualityLabel: 'الجودة',
    qualityNames: { standard: '1080p', high: '1440p', max: '4K' },
    qualityHelp:
      'الأعلى يعني ملفًا أكبر وزمن إخراج أطول، ويستحق ذلك حين تُشاهَد التلاوة بملء الشاشة. و1080p هي ما تعرضه كل هذه المنصات.',
    steppedDown: (asked, used) =>
      `${asked} لا تتّسع في ملف واحد لمقطع بهذا الطول، فيجري الإخراج بدقة ${used}.`,
    bitrateReduced: 'مقطع طويل — خُفّض معدل البت ليتّسع الملف الناتج في الذاكرة.',
    exceedsMemory:
      'هذا المقطع طويل بما قد ينفد معه حيّز الذاكرة قبل اكتمال الإخراج. قصّه أو صدّره على أجزاء.',
    overLong: (platform, seconds) =>
      `أطول بـ ${seconds} ثانية مما تقبله ${platform} — سيُقتطع هناك أو يُرفض.`,
    recorderOnly:
      'يُسجَّل هذا المشروع في الزمن الحقيقي، وهو لا يلتقط سوى إطار المعاينة بدقة 1080p. والدقات الأعلى تحتاج مسار الترميز إطارًا بإطار.',
    aspectFormat: 'نسبة الأبعاد:',
    encoding: 'جارٍ ترميز الإطارات...',
    speed: speed => `السرعة: ${speed}`,
    realtimeCapture: 'تسجيل بالزمن الحقيقي',
    realtimeCaptureTitle:
      'يسجّل التصدير التشغيل في الزمن الحقيقي، فيستغرق المقطع وقتًا قريبًا من مدته.',
    complete: 'اكتمل تصدير الفيديو',
    renderedIn: 'اكتمل في',
    renderedOn: gpu => ` على ${gpu}.`,
    cancelRender: 'إيقاف هذا العرض والإغلاق',
    keepTabOpenTitle: 'أبقِ هذا اللسان مفتوحًا وظاهرًا.',
    keepTabOpenBody:
      'تُسجَّل الصورة من اللوحة أثناء العرض، والمتصفحات توقف الرسم في لسان انتقل إلى الخلفية. فإن انتقلت عنه توقّف العرض مؤقتًا وانتظرك — لا يضيع شيء، لكن مدة الانتظار تُضاف إلى الزمن الكلي.',
    doNotSwitch: 'جارٍ التسجيل — لا تنتقل إلى لسان آخر',
    pausedNotice: times =>
      times === 1
        ? 'توقّف مؤقتًا مرة واحدة حين كان هذا اللسان في الخلفية، ثم تابع. لم يضع شيء — والانتظار هو سبب طول المدة.'
        : `توقّف مؤقتًا ${times} مرات حين كان هذا اللسان في الخلفية، ثم تابع في كل مرة. لم يضع شيء — والانتظار هو سبب طول المدة.`,
    frozenWarning: seconds =>
      `نحو ${seconds} ثانية من هذا التسجيل صورتها جامدة. توقّفت اللوحة عن الرسم أثناء التسجيل، وغالبًا لأن اللسان انتقل إلى الخلفية أو نامت الشاشة. أعد التصدير وأبقِ هذا اللسان ظاهرًا.`,
    choppyWarning:
      'لم يلحق العرض بمعدّل الإطارات المطلوب، فستتقطّع الصورة. جرّب معدّلًا أقل، أو أغلق النوافذ الأخرى التي تستعمل بطاقة الرسوميات.',
    download: container => `تنزيل الفيديو بصيغة ${container}`,
    downloadWithCaption: container => `تنزيل ${container} مع النص`,
    previewButton: 'عاين الانتقالات أولًا',
    previewRendering: percent => `يجري إعداد المعاينة… ${percent}%`,
    previewNote: (width, height) =>
      `معاينة بمقاس ${width}×${height}: الصورة والتوقيت ومواضع تغيّر الخلفيات — لا الجودة. وهي تمرّ على المقطع كاملًا، فتستغرق نحو ما يستغرقه تصدير 1080p وأقل بكثير من تصدير 4K.`,
    previewClear: 'إغلاق المعاينة',
    previewFailed:
      'لم تكتمل المعاينة. ولا عيب في التصدير نفسه — جرّبه، أو أعد المعاينة.',
    renderAnother: 'تصدير مقطع آخر',
    warningsHeading: 'قبل التصدير',
    warnGap: (from, to) => `لا خلفية من ${from} إلى ${to}: يظهر التدرّج العادي هناك. اسحب مقطعًا فوقه على الخط الزمني.`,
    warnSeeking: name => `لا يمكن فك ترميز ${name} إطارًا بإطار هنا، فيُقرأ بالتقديم. سيُصدَّر صحيحًا لكن ببطء.`,
    warnUnreadable: name => `لا يستطيع هذا المتصفح قراءة ${name}: يظهر التدرّج العادي حيث يجب أن تكون. استبدلها أو أضف الملف من جديد.`
  },

  publish: {
    title: 'وصف هذا المقطع',
    copy: 'نسخ',
    copied: 'نُسخ',
    copyFailed:
      'لم يسمح هذا المتصفح للصفحة بالكتابة إلى الحافظة. حدّد النص أعلاه وانسخه يدويًا.',
    titleField: 'العنوان',
    descriptionField: 'الوصف',
    tagsField: 'الوسوم',
    includeText: 'أدرج نص الآيات وترجمتها',
    includeTextHelp:
      'معطَّل افتراضيًا ليبقى الوصف قصيرًا. والمصدر منسوب في الحالين؛ ومع تفعيله يكون ذلك النسب هو ما يُنشر النص بموجبه.',
    truncated:
      'اختُصر شيء ليتّسع لما تقبله المنصة. أما النسب والوسوم فتبقى كاملة.'
  },

  projects: {
    dialogLabel: 'المشاريع',
    heading: 'المشاريع',
    tabProjects: count => `المشاريع (${count})`,
    tabExports: count => `الفيديوهات المصدَّرة (${count})`,
    loading: 'جارٍ تحميل العناصر المحفوظة...',
    noProjects: 'لا مشاريع محفوظة بعد.',
    emptyBody: 'المقطع الذي تعمل عليه محفوظ في هذا المتصفح تلقائيًا. احفظه هنا ليبقى مع مقاطعك الأخرى.',
    saveCurrent: 'احفظ المقطع الحالي',
    searchPlaceholder: 'ابحث بالسورة أو القارئ أو الملف',
    newClip: 'مقطع جديد',
    noMatches: query => `لا مشروع يطابق «${query}».`,
    footerNote: 'المقطع الذي تعمل عليه محفوظ كذلك في هذا المتصفح تلقائيًا.',
    colPassage: 'المقطع',
    colAudio: 'الصوت',
    colLength: 'المدة',
    colFrame: 'الإطار',
    colRendered: 'صُدِّر بـ',
    colEdited: 'آخر تعديل',
    colActions: 'الإجراءات',
    open: 'افتح',
    notRendered: 'لم يُصدَّر بعد',
    yourRecording: file => `تسجيلك · ${file}`,
    noExports: 'لا مقاطع مصدَّرة بعد. اضغط «تصدير» لإنشاء أول مقطع لك.',
    openRenderedProject: 'افتح المشروع الذي صُدِّر منه',
    openInStudio: 'فتح في الاستوديو',
    passage: (surah, number, start, end) => `${surah} (${number}:${start}-${end})`,
    gpu: device => `كرت الرسوميات: ${device}`,
    unknownGpu: 'كرت رسوميات غير معروف',
    fps: fps => `${fps} إطارًا/ث`,
    clipLength: length => `الطول ${length}`,
    renderTook: seconds => `صُدِّر في ${seconds} ث`,
    noFileName: 'صُدِّر قبل أن تُسجَّل أسماء الملفات',
    savedToDownloads: 'محفوظ حيث يضع متصفحك التنزيلات',
    deleteRenderTitle: title => `إزالة سجلّ ${title}`,
    deleteRenderAria: title => `إزالة سجلّ التصدير الخاص بـ ${title}`,
    deleteTitle: title => `حذف «${title}»`,
    deleteAria: title => `حذف ${title}`,
    confirmDeleteTitle: 'حذف هذا المشروع المحفوظ؟',
    confirmDeleteMessage: title =>
      `ستُحذف «${title}» نهائيًا. وكل ما لم تحفظه في مكان آخر — توقيتاته وتنسيقه وخلفياته — يذهب معها.`,
    confirmDeleteLabel: 'حذف المشروع',
    deleteFailed: status => `تعذّر حذف هذا المشروع (HTTP ${status}).`,
    serverUnreachable: 'تعذّر الوصول إلى الخادم.'
  }
};
