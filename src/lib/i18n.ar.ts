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
    title: 'مساعد مقاطع القرآن — استوديو فيديوهات التلاوة',
    description:
      'أنشئ فيديوهات تلاوة قرآنية محليًا في المتصفح: مطابقة زمنية للكلمات، ورسم على اللوحة، وتصدير WebM بدقة 1080p/4K وبمعدل 60 إطارًا في الثانية.'
  },

  common: {
    cancel: 'إلغاء',
    apply: 'تطبيق',
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
      verdigris: 'زنجاري'
    },
    notes: {
      nocturne: 'كحلي ولؤلؤي',
      slate: 'المظهر الأصلي',
      mushaf: 'ذهبي ولازوردي',
      graphite: 'رمادي محايد',
      verdigris: 'أخضر ونحاسي'
    }
  },

  header: {
    wordmark: 'مقاطع القرآن',
    wordmarkSuffix: 'استوديو',
    pageTitle: (surah, number, start, end) =>
      `استوديو مقاطع القرآن — ${surah} ${number}:${start}–${end}`,
    savedClips: 'المقاطع المحفوظة',
    saveProject: 'حفظ المشروع',
    saveProjectTitle: 'حفظ هذا المقطع في قائمة المشاريع',
    healthDatabase: 'قاعدة البيانات',
    healthAligner: 'المحاذي',
    groundTruth: 'مرجع التقييم',
    groundTruthTitle:
      'تنزيل هذا الجدول الزمني كملف مرجعي، ليُقاس عليه أي تغيير في المحاذاة مقابل المقاطع التي صحّحتها بالسمع',
    trimAudio: 'قص الصوت',
    trimAudioWithLength: length => `قص الصوت (${length})`,
    trimAudioTitle: 'قص الملف الصوتي المرفوع — تعديلاتك على المسار الزمني محفوظة',
    export: 'تصدير',
    saving: 'جارٍ الحفظ…',
    saved: 'تم حفظ المشروع',
    savedThisSession: 'محفوظ (لهذه الجلسة)',
    saveFailed: 'فشل الحفظ',
    saveFailedStatus: status => `ردّ الخادم بالرمز ${status}.`
  },

  surfaces: {
    source: 'المصدر',
    preview: 'المعاينة',
    inspector: 'المحرر',
    edit: 'تحرير',
    switchView: 'تبديل العرض'
  },

  source: {
    sampleTitle: 'هذا مثال جاهز.',
    sampleBody:
      'المسار الزمني مُعبّأ مسبقًا بسورة الفاتحة كي لا تكون المعاينة فارغة. حمّل سورة أو ارفع تلاوة لاستبداله.',

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
    step5: 'اضغط على كتلة لتحرير نصها وكلماتها في اللوحة الجانبية.',
    step6Before: 'بدّل تلك اللوحة إلى',
    step6Strong: 'التنسيق',
    step6After: '، ثم صدّر المقطع.',
    howItWorksNoteBefore: 'ملاحظة: القراء الموسومون بـ',
    howItWorksNoteTimed: 'موقوت',
    howItWorksNoteMiddle:
      'تأتي حدود آياتهم مقاسة من التسجيل نفسه؛ وما عداهم تقديرات تضبطها بنفسك على المسار الزمني. والمطابقة التلقائية تعمل على الملفات',
    howItWorksNoteUploaded: 'المرفوعة',
    howItWorksNoteEnd: 'فقط.',

    uploadLabel: 'رفع تلاوة — صوت أو فيديو:',
    uploadHelp:
      'صوت (MP3 / WAV / M4A / OGG) أو فيديو (MP4 / MOV / WebM / MKV). في حالة الفيديو، يُستخدم مساره الصوتي للمطابقة وتصبح لقطاته خلفيةً للمقطع. تدعم المطابقة التلقائية ملفات حتى نحو 18 ميجابايت (أي ما يقارب 15–20 دقيقة بصيغة MP3)؛ اضغط التسجيلات الأطول أو قسّمها.',
    chooseFile: 'اختر ملف صوت أو فيديو',

    matcherLabel: 'أداة المطابقة:',
    matcherUses: technical => `تستخدم ${technical}`,
    matcherLocal: 'محلي',
    matcherLocalTechnical: 'المحاذاة القسرية المحلية',
    matcherLocalBlurb:
      'يعثر على المقطع داخل التسجيل، ثم يوقّت كل كلمة على نص القرآن الثابت، فلا يمكن أن تسقط كلمة أو تُسمع خطأً. ولا يغادر شيء جهازك.',
    matcherLocalFix: 'يتطلب هذا تشغيل التطبيق المساعد المحلي. شغّله ثم أعد تحميل الصفحة.',
    matcherOnline: 'عبر الإنترنت',
    matcherOnlineTechnical: 'مطابقة Gemini السحابية',
    matcherOnlineBlurb:
      'يعمل دون تثبيت أي شيء، لكن التوقيت مُقدَّر لا مقاس، فتوقّع تصحيحه يدويًا. ويُرسَل الصوت إلى Google.',
    matcherOnlineFix: 'أضف مفتاح Gemini API لاستخدام هذا الخيار.',
    matcherChecking: 'جارٍ الفحص…',
    matcherReady: 'جاهز',
    matcherHelperNotRunning: 'التطبيق المساعد لا يعمل',
    matcherHelperNeedsRestart: 'التطبيق المساعد يحتاج إعادة تشغيل',
    matcherNeedsApiKey: 'يحتاج مفتاح API',
    matcherDetectionOffBefore:
      'كشف المقطع معطَّل في التطبيق المساعد لديك، لذا سيوقّت السورة والنطاق المحددين أعلاه بدل البحث عنهما في الصوت. أزِل ضبط',
    matcherDetectionOffAfter: 'وأعد تشغيله لإعادة تفعيل الكشف.',
    matcherEngineFailedTitle:
      'التطبيق المساعد يعمل لكنه لم يتمكن من تحميل محرك المحاذاة، لذا ستفشل المطابقة.',
    matcherEngineFailedBody:
      'يكاد يكون السبب دائمًا تشغيل الخدمة بإصدار Python خاطئ. أعد تشغيلها من بيئتها الافتراضية:',

    useVideoAsBackground: 'استخدم هذا الفيديو خلفيةً',
    useVideoAsBackgroundHelp: 'تتبع لقطاته الصوت، فتبقى التلاوة متزامنة معها',
    useVideoAsBackgroundOffset: offset => ` (بإزاحة ${offset} بعد القص)`,

    autoMatch: 'مطابقة تلقائية',
    manualMatch: 'مطابقة يدوية',
    trimHelp:
      'اقصص قبل المطابقة لإزالة الصمت أولًا، أو بعدها لتقليص المسار الزمني الناتج — وفي الحالتين تُضبط أوقات المقاطع على المقطع الجديد تلقائيًا.',

    selectSurah: 'اختر السورة:',
    surahOption: (number, english, arabic, ayahs) => `${number}. ${arabic} (${english}) - ${ayahs} آية`,
    startAyah: 'من الآية:',
    endAyah: 'إلى الآية:',

    selectReciter: 'اختر القارئ:',
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
      'ملفك المرفوع ما زال هو الصوت المُشغَّل، وهذه الأوقات تخص تسجيل القارئ لا ملفك. شغّل المطابقة التلقائية، أو اضبط الحدود على المسار الزمني.',
    loadedMeasured: seeked =>
      `حدود الآيات مأخوذة من التسجيل نفسه${seeked ? '، وانتقل مؤشر التشغيل إلى أولها' : ''}.`,
    loadedEstimated:
      'لا توقيتات منشورة لهذا القارئ، فالحدود مُقدَّرة — اضبطها على المسار الزمني قبل التصدير.'
  },

  match: {
    videoUploaded:
      'تم رفع الفيديو — سيُستخدم صوته للمطابقة ولقطاته خلفيةً. اختر المطابقة التلقائية لكشف الآيات ومزامنتها، أو المطابقة اليدوية لتوقيت المقاطع بنفسك.',
    audioUploaded:
      'تم رفع الصوت. اختر المطابقة التلقائية لكشف الآيات ومزامنتها، أو المطابقة اليدوية لتوقيت المقاطع بنفسك.',
    trimmed: length =>
      `تم القص إلى ${length}. أعِد تشغيل المطابقة التلقائية على المقطع المقصوص، أو راجع المسار الزمني المعدَّل بالأسفل.`,
    trimmingRange: 'جارٍ قص الصوت إلى المقطع الذي حدّدته…',
    trimRangeFailed: 'تعذّر قص هذا الملف. جرّب نافذة قص الصوت، فهي تبيّن سبب الخطأ.',
    reciterNoUrl: 'ليس لصوت هذا القارئ عنوان يستطيع المحاذي جلبه.',
    needLoad: 'حمّل الآيات أولًا ثم حاذِها.',
    passageTooLong: (minutes, limit) =>
      `طول هذا المقطع نحو ${minutes} دقيقة، والمحاذي يستوعب حتى ${limit}. اختر آيات أقل.`,
    alignReciter: 'محاذاة على الصوت',
    alignReciterTitle:
      'يقرأ تسجيل القارئ نفسه ويحدّد موضع كل كلمة، بدل تقدير مواضع الآيات.',
    needUpload: 'ارفع ملفًا صوتيًا قبل تشغيل المطابقة التلقائية.',
    aligning:
      'جارٍ محاذاة نطاق الآيات المحدد على تسجيلك (التشغيل الأول يحمّل النموذج — وقد يستغرق وقتًا أطول)...',
    sendingToGemini: 'جارٍ إرسال الصوت إلى Gemini للتحليل...',
    notConfigured: 'أداة المطابقة غير مهيّأة. استخدم المطابقة اليدوية لهذا الصوت.',
    failed: 'فشلت أداة المطابقة. استخدم المطابقة اليدوية، أو هيّئ الأداة على الخادم وحاول مجددًا.',
    detected: (label, segments) => `تم التعرّف على ${label} — ${segments} مقطعًا. `,
    fallbackSurahLabel: number => `سورة رقم ${number}`,
    confirmRange:
      'تأكّد من أن هذه هي السورة ونطاق الآيات الصحيحان لتسجيلك، ثم راجع التوقيتات بالأسفل قبل النشر.',
    reviewTimings: 'راجع التوقيتات والنصوص بالأسفل قبل النشر.',
    manualMode: 'وضع المطابقة اليدوية: عيّن أرقام الآيات واضبط وقت بداية ونهاية كل مقطع صوتي.'
  },

  audioErrors: {
    aborted: 'أُلغي تحميل الصوت.',
    network: 'خطأ في الشبكة — تعذّر الوصول إلى خادم الصوت. تحقّق من اتصالك بالإنترنت.',
    decode: 'فشل فك ترميز الصوت. قد يكون الملف تالفًا أو بصيغة غير مدعومة.',
    unsupported: 'مصدر الصوت غير مدعوم أو غير موجود. قد يكون رابط القارئ غير صحيح لهذه السورة.',
    unknown: code => `تعذّر تحميل الصوت (خطأ ${code}).`,
    hint: 'جرّب قارئًا آخر، أو ارفع ملفًا صوتيًا خاصًا بك.'
  },

  timeline: {
    label: 'المسار الزمني',
    playRecitation: 'تشغيل التلاوة',
    pauseRecitation: 'إيقاف التلاوة',
    backToStart: 'العودة إلى البداية',
    rippleOn: 'مرتبط',
    rippleOnTitle:
      'مرتبط: تحريك نهاية مقطع يزيح كل المقاطع بعده ويُبقي الخط مرصوصًا. انقر لفكّ الارتباط وتحريك حافة واحدة في كل مرة.',
    rippleOff: 'غير مرتبط',
    rippleOffTitle:
      'غير مرتبط: تتحرك كل حافة وحدها، وتقف النهاية عند بداية المقطع التالي. انقر لإعادة الارتباط.',
    markAyahEnd: 'تحديد نهاية الآية',
    markAyahEndTitle: 'حدّد نهاية هذه الآية عند مؤشر التشغيل (B)',
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
    moveStartOf: name => `تحريك بداية ${name}`,
    moveEndOf: name => `تحريك نهاية ${name}`,
    empty: 'لا آيات محمّلة بعد — اختر سورة من اللوحة الجانبية، أو ارفع تلاوة.'
  },

  inspector: {
    tabAyah: 'الآية',
    tabStyle: 'التنسيق',
    empty: 'اختر آية على المسار الزمني لتحرير نصها وترجمتها وكلماتها.',
    matchConfidence: percent => `تطابق ${percent}%`,
    starts: time => `تبدأ ${time}`,
    ends: time => `تنتهي ${time}`,
    edgeStart: 'البداية',
    edgeEnd: 'النهاية',
    moveStartEarlier: 'تقديم البداية',
    moveStartLater: 'تأخير البداية',
    moveEndEarlier: 'تقديم النهاية',
    moveEndLater: 'تأخير النهاية',
    ayahNumber: 'رقم الآية',
    arabic: 'النص العربي',
    translation: 'الترجمة',
    dragToResize: 'اسحب الزاوية لتغيير الحجم',
    wordsOnScreen: 'الكلمات الظاهرة',
    wordsHint: 'اضغط على كلمة لإخفائها من الفيديو.',
    moveAyahEarlier: 'تقديم الآية',
    moveAyahLater: 'تأخير الآية',
    deleteAyah: 'حذف الآية',
    split: 'تقسيم',
    splitHint: 'إنهاء هذا المقطع عند المؤشر وبدء التالي منه',
    splitTooShort: 'حرّك المؤشر إلى داخل المقطع لتتمكن من تقسيمه',
    merge: 'دمج',
    mergeHint: 'دمج هذا المقطع مع الذي يليه',
    mergeNotSameAyah: 'لا يمكن الدمج إلا داخل الآية الواحدة',
    beforeYouPublish: 'قبل النشر:',
    beforeYouPublishBody:
      'راجع بنفسك كل آية وتوقيتها وترجمتها. أنت المسؤول عمّا تنشره.'
  },

  style: {
    tabDesign: 'التخطيط والنص',
    tabBackground: 'الخلفية',
    tabCard: 'البطاقة والمؤثرات',

    headingFormat: 'الصيغة',
    headingTypography: 'الخطوط',
    headingBranding: 'الهوية',

    aspectRatioLabel: 'اختر نسبة أبعاد الفيديو:',
    aspectRatios: {
      '9:16': '9:16 عمودي (Shorts / TikTok / Reels)',
      '16:9': '16:9 عريض (YouTube)',
      '1:1': '1:1 مربّع (Instagram)',
      '4:5': '4:5 طولي (منشور Instagram)'
    },

    bgModeLabel: 'طريقة استخدام الخلفيات:',
    bgModes: {
      single: 'خلفية واحدة',
      'per-ayah': 'خلفية لكل آية',
      cycle: 'تبديل دوري',
      shuffle: 'عشوائي'
    },
    bgModeHints: {
      single: 'مقطع واحد يتكرر.',
      'per-ayah': 'ينتقل إلى المقطع التالي عند كل آية.',
      cycle: 'يتغيّر كل بضع ثوانٍ.',
      shuffle: 'يختار مقطعًا لكل آية، بالترتيب نفسه في كل مرة.'
    },
    secondsPerBackground: 'ثوانٍ لكل خلفية:',

    laneSummary: blocks =>
      `مقصوص يدويًا على المسار الزمني — ${blocks} ${blocks === 1 ? 'كتلة' : blocks === 2 ? 'كتلتان' : 'كتلة'}.`,
    laneHelp:
      'اسحب كتلة لتحريكها، أو حافة لتغيير مدة تشغيلها؛ ومدّها أطول من المقطع نفسه يعيد تشغيله فحسب. اختر وضعًا بالأعلى للعودة إلى الوضع التلقائي.',
    removeBlockTitle: 'إزالة هذه الكتلة؟',
    removeBlockMessage: (name, start, end) =>
      `«${name}» تعمل من ${start} ثانية إلى ${end} ثانية. إزالتها تترك فجوة هناك تظهر فيها الخلفية المتدرجة العادية.`,
    removeBlockConfirm: 'إزالة الكتلة',
    removeBlockAria: (name, start) => `إزالة ${name} عند ${start} ثانية`,

    sequenceEmpty:
      'اضغط على الصور المصغّرة بالأسفل لإضافة خلفيات. وبدون أي اختيار يعمل هذا الوضع كخلفية واحدة.',
    sequenceCount: count => `${count} في التسلسل، بترتيب التشغيل — وقد يتكرر المقطع الواحد أكثر من مرة.`,
    moveEarlier: name => `تقديم ${name}`,
    moveLater: name => `تأخير ${name}`,
    removeFromSequenceTitle: 'إزالة من التسلسل؟',
    removeFromSequenceMessage: (name, position) =>
      `«${name}» لن تعود تُعرض في الموضع ${position}. وتبقى ضمن خلفياتك بالأسفل جاهزة للإضافة مجددًا.`,
    removeFromSequenceAria: (name, position) => `إزالة ${name} من الموضع ${position}`,

    galleryLabelLane: 'أضف خلفية إلى نهاية المسار:',
    galleryLabelSingle: 'الخلفيات:',
    galleryLabelMulti: 'اختر خلفياتك:',
    galleryHelp:
      'الخلفيات الجاهزة أولًا، ثم ما رفعته أو ألصقت رابطه بالأسفل. مرّر المؤشر فوق خلفياتك الخاصة لحذفها.',
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

    uploadLabel: 'ارفع فيديو أو صورة خاصة بك:',
    uploadBrowse: 'اختر ملف فيديو أو صورة',
    uploadHelp:
      'يُحفَظ في هذا المتصفح، فيبقى في القائمة في المرة القادمة. ومسح بيانات الموقع يزيله، فيظهر مدخله عندئذٍ كمفقود بدل أن يختفي.',
    uploadAdded: name => `أُضيفت «${name}» — وستبقى هنا في المرة القادمة.`,
    uploadNotStored: name =>
      `«${name}» موجودة في هذا الفيديو، لكن تعذّر حفظها للمرة القادمة — رفضها المتصفح، وغالبًا لنفاد المساحة المخصصة لهذا الموقع.`,

    overlayOpacity: 'عتامة الطبقة الداكنة:',
    backgroundBlur: 'ضبابية الخلفية:',

    arabicFontLabel: 'الخط العربي:',
    fonts: {
      Amiri: 'أميري عثماني',
      'Scheherazade New': 'شهرزاد',
      'Noto Naskh Arabic': 'نوتو نسخ',
      'Reem Kufi': 'ريم كوفي',
      'Aref Ruqaa': 'عارف رقعة'
    },
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
    englishTranslation: 'الترجمة الإنجليزية',

    watermarkLabel: 'العلامة المائية / المعرّف:',
    watermarkPlaceholder: '@MyDawahChannel',
    watermarkPositionLabel: 'موضع العلامة المائية:',
    watermarkPositions: {
      'bottom-right': 'أسفل اليمين',
      'bottom-left': 'أسفل اليسار',
      'top-right': 'أعلى اليمين',
      'top-left': 'أعلى اليسار'
    }
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

  exportModal: {
    dialogLabel: 'تصدير الفيديو',
    title: 'تصدير الفيديو',
    subtitle: encoder => `يسجّل اللوحة في الزمن الحقيقي عبر MediaRecorder (${encoder})`,
    detectedGpu: 'كرت الرسوميات المكتشف',
    gpuNotReported: 'المتصفح لا يفصح عن كرت الرسوميات',
    frameRateLabel: 'معدل الإطارات المستهدف:',
    fps60: '60 إطارًا — فائق',
    fps30: '30 إطارًا — قياسي',
    resolutionLabel: 'دقة المخرجات:',
    resolutions: {
      '16:9': '1920x1080 عريض',
      '1:1': '1080x1080 مربّع',
      '4:5': '1080x1350 طولي',
      '9:16': '1080x1920 عمودي'
    },
    clipTitle: 'عنوان المقطع:',
    clipLength: 'مدة المقطع:',
    aspectFormat: 'نسبة الأبعاد:',
    bitrateTarget: 'معدل البت المستهدف:',
    bitrateValue: '18 ميجابت/ث — معدل عالٍ',
    encoding: 'جارٍ ترميز الإطارات...',
    speed: speed => `السرعة: ${speed}`,
    realtimeCapture: 'تسجيل بالزمن الحقيقي',
    realtimeCaptureTitle:
      'يسجّل التصدير التشغيل في الزمن الحقيقي، فيستغرق المقطع وقتًا قريبًا من مدته.',
    startRender: fps => `ابدأ التصدير بمعدل ${fps} إطارًا`,
    complete: 'اكتمل تصدير الفيديو',
    renderedIn: 'اكتمل في',
    renderedOn: gpu => ` على ${gpu}.`,
    cancelRender: 'إيقاف هذا العرض والإغلاق',
    fastPathTitle: 'ترميز إطارًا بإطار.',
    fastPathBody:
      'لا خلفية فيديو في هذا المشروع، فيمكن إخراجه بأقصى سرعة يبلغها الجهاز بدل الزمن الحقيقي — وقيس بين ٦ و١٠ أضعاف — ويُكتب بصيغة MP4. ويمكنك تبديل الألسنة أثناء العمل.',
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
    download: 'تنزيل فيديو WebM عالي الجودة',
    renderAnother: 'تصدير مقطع آخر'
  },

  projects: {
    dialogLabel: 'المشاريع والمقاطع المحفوظة',
    heading: 'المشاريع والمقاطع المصدَّرة',
    tabProjects: count => `المشاريع (${count})`,
    tabExports: count => `الفيديوهات المصدَّرة (${count})`,
    loading: 'جارٍ تحميل العناصر المحفوظة...',
    noProjects: 'لا مشاريع محفوظة بعد. اضغط «حفظ المشروع» في الاستوديو.',
    noExports: 'لا مقاطع مصدَّرة بعد. اضغط «تصدير» لإنشاء أول مقطع لك.',
    openInStudio: 'فتح في الاستوديو',
    passage: (surah, number, start, end) => `${surah} (${number}:${start}-${end})`,
    gpu: device => `كرت الرسوميات: ${device}`,
    unknownGpu: 'كرت رسوميات غير معروف',
    fps: fps => `${fps} إطارًا/ث`,
    downloadWebm: 'تنزيل ملف WebM',
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
