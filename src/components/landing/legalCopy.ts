import type { Locale } from '@/lib/i18n';

/**
 * The privacy policy and the terms of service, in both of the studio's
 * languages. Every statement about data here describes what the code does --
 * keep them true together: an upload's handling is `asr-service/app/audio.py`
 * and `regroup.py`, YouTube's is `youtubeUpload.ts` and `youtubeVault.ts`,
 * the cookies are `LOCALE_COOKIE`, `VAULT_COOKIE` and the middleware's.
 *
 * Text is plain; `[label](url)` becomes a link, and `{contact}` where to write.
 */

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  list?: string[];
}

export interface LegalDocument {
  title: string;
  updated: string;
  intro: string[];
  sections: LegalSection[];
  /** Said in the Arabic text only: the English one governs where the two differ. */
  governs?: string;
}

export const UPDATED = { en: '10 October 2026', ar: '١٠ أكتوبر ٢٠٢٦' };

const GOOGLE_PRIVACY = 'https://policies.google.com/privacy';
const YOUTUBE_TERMS = 'https://www.youtube.com/t/terms';
const GOOGLE_PERMISSIONS = 'https://myaccount.google.com/permissions';
const USER_DATA_POLICY = 'https://developers.google.com/terms/api-services-user-data-policy';
const LICENSE = 'https://github.com/Omar-Kurdi/Quran-Clipper/blob/main/LICENSE';

export const PRIVACY: Record<Locale, LegalDocument> = {
  en: {
    title: 'Privacy policy',
    updated: 'Last updated ' + UPDATED.en,
    intro: [
      'Quran-Clipper (“we”) is a free web studio for making Quran recitation videos. This policy explains what information the studio handles when you use it at this address, why, and what you can do about it.',
    ],
    sections: [
      {
        heading: 'In short',
        list: [
          'There is no account. We do not ask who you are.',
          'There are no ads, no analytics and no tracking cookies, and we sell nothing to anyone.',
          'Your projects are kept in your own browser, and your videos are made in your browser.',
          'A recording of your own is sent to our server only to time it, and it is not stored.',
          'If you post to YouTube, the studio can upload videos to your channel and do nothing else with your Google account.',
        ],
      },
      {
        heading: 'What you send us',
        paragraphs: [
          'Your own recordings. When you match a recording of your own, the file is sent to our server, where it is decoded and aligned with the Quran text so that the captions follow it. It touches the server’s disk only as a temporary file while it is decoded, and that file is deleted at once. The decoded audio is then held in the server’s memory, so that you can re-split captions without uploading again; the server holds about thirty minutes of audio from all visitors together and drops the oldest first, and anything held is gone when the server restarts. Your recording is never written to permanent storage, shown to anyone else or used for anything but your match.',
          'Background links. If you paste a link to a video on Pexels as a background, our server reads that Pexels page to find the video file to play.',
          'Built-in reciters. When you choose a built-in reciter, our server fetches the recitation from its public audio server and passes it to your browser. It may keep a copy of that public recording to serve it faster; nothing of yours is in it.',
        ],
      },
      {
        heading: 'What stays on your device',
        paragraphs: [
          'Your captions, project settings and drafts are saved in your browser’s local storage, as are preferences such as the colour scheme, the volume and whether you have seen the guided tour. We do not receive them. Clearing this site’s data in your browser deletes them.',
          'The video itself is rendered by your browser, on your device. It is not uploaded to us to be made.',
        ],
      },
      {
        heading: 'What is sent automatically',
        paragraphs: [
          'Like every website, your browser sends our server your IP address and the details of each request. The studio uses your IP address only in memory, to share the matching queue fairly between visitors, and does not record it. The studio keeps no log of who visited.',
          'Cookies. The studio sets only these, and none for advertising or tracking:',
        ],
        list: [
          '`qc-lang`: the language you chose. Kept for a year.',
          '`qc_youtube`: only if you stay signed in to YouTube. Your encrypted Google sign-in, sent only to the studio’s YouTube routes. Kept for a year from its last use, or until you disconnect.',
          '`studio_token`: only on a private studio protected by its owner’s password.',
        ],
      },
      {
        heading: 'Google and YouTube',
        paragraphs: [
          'Posting to YouTube is optional. If you choose it, you sign in with Google and grant the studio a single permission: to upload videos to your YouTube channel (the `youtube.upload` scope). The studio does not ask for your email address, your contacts or anything else in your Google account, and it cannot read, change or delete your existing videos.',
          'How it is used. Only to upload the video you chose, with the title, description, tags and visibility you entered, when you press upload. The video goes from your browser straight to YouTube.',
          'How it is kept. If you are not kept signed in, the access Google gives the studio lives in your browser for up to an hour and never reaches our server. Where the studio keeps you signed in, Google gives our server a refresh token, which it encrypts (AES-256-GCM) and returns to your browser in a cookie only our server can read. Our server keeps no copy; it can use the token only when your browser sends it to make an upload you asked for.',
          'How it is shared. It is not. Your Google data is not sold, not shared with anyone, not used for advertising and not used to train any AI model. Quran-Clipper’s use and transfer of information received from Google APIs will adhere to the [Google API Services User Data Policy](' + USER_DATA_POLICY + '), including the Limited Use requirements.',
          'How to remove it. Choose Disconnect in the studio’s YouTube panel: the studio revokes its access with Google and deletes the cookie. You can also remove the studio’s access at any time in your [Google account permissions](' + GOOGLE_PERMISSIONS + ').',
          'Uploading uses YouTube API Services. By posting to YouTube you agree to the [YouTube Terms of Service](' + YOUTUBE_TERMS + '), and Google’s handling of your data is described in the [Google Privacy Policy](' + GOOGLE_PRIVACY + ').',
        ],
      },
      {
        heading: 'Services the studio relies on',
        list: [
          'Quran.com and the Quran Foundation API, for the Quran text, translations and recitation timings. Our server asks them; your browser does not.',
          'Public recitation audio servers (quranicaudio.com, mp3quran.net, tarteel.ai), reached through our server.',
          'Google Fonts: your browser loads the studio’s typefaces from Google, which receives your IP address when it does.',
          'Pexels, if you pick a Pexels background: your browser loads that video from Pexels.',
          'Google’s Gemini API, only where a studio offers the Gemini matcher and you choose it: your recording is then sent to Google to be matched.',
          'YouTube, as above, only if you post to it.',
        ],
      },
      {
        heading: 'Children',
        paragraphs: [
          'The studio is not directed at children under 13, and we do not knowingly collect personal information from them.',
        ],
      },
      {
        heading: 'Security',
        paragraphs: [
          'The studio is served over HTTPS. Your YouTube sign-in is encrypted and readable only by our server, and your recordings are never written to permanent storage. No system is perfectly secure, and we cannot promise that information sent over the internet will never be intercepted.',
        ],
      },
      {
        heading: 'Changes',
        paragraphs: [
          'If this policy changes, the new version will be posted here with a new date. A change in what the studio does with Google user data will be stated here before it takes effect.',
        ],
      },
      {
        heading: 'Contact',
        paragraphs: ['Questions about this policy: {contact}.'],
      },
    ],
  },
  ar: {
    title: 'سياسة الخصوصية',
    updated: 'آخر تحديث ' + UPDATED.ar,
    governs: 'هذه ترجمة للنص الإنجليزي، وعند الاختلاف يُعتمد النص الإنجليزي.',
    intro: [
      'Quran-Clipper («نحن») استوديو مجاني على الويب لصنع فيديوهات التلاوة القرآنية. توضّح هذه السياسة ما يتعامل معه الاستوديو من معلومات حين تستعمله على هذا العنوان، ولماذا، وما الذي يمكنك فعله.',
    ],
    sections: [
      {
        heading: 'باختصار',
        list: [
          'لا يوجد حساب، ولا نسألك من أنت.',
          'لا إعلانات ولا تحليلات ولا ملفات تعريف ارتباط للتتبّع، ولا نبيع شيئًا لأحد.',
          'تُحفظ مشاريعك في متصفحك أنت، وتُصنع فيديوهاتك في متصفحك.',
          'لا يُرسل تسجيلك الخاص إلى خادمنا إلا لضبط توقيته، ولا يُخزَّن.',
          'إن نشرت على YouTube، فبإمكان الاستوديو رفع الفيديوهات إلى قناتك، ولا شيء غير ذلك في حسابك على Google.',
        ],
      },
      {
        heading: 'ما ترسله إلينا',
        paragraphs: [
          'تسجيلاتك الخاصة. حين تطابق تسجيلًا من عندك، يُرسل الملف إلى خادمنا، فيُفكّ ترميزه ويُطابَق مع نص القرآن لتتبعه المقاطع. لا يمسّ قرص الخادم إلا ملفًا مؤقتًا أثناء فكّ الترميز، ويُحذف فورًا. ثم يُبقى الصوت في ذاكرة الخادم لتتمكن من إعادة تقسيم المقاطع دون رفعه مجددًا؛ ويحتفظ الخادم بنحو ثلاثين دقيقة من صوت جميع الزوار معًا ويحذف الأقدم أولًا، ويزول كل ذلك عند إعادة تشغيل الخادم. لا يُكتب تسجيلك أبدًا في تخزين دائم، ولا يُعرض على أحد، ولا يُستعمل لغير مطابقتك.',
          'روابط الخلفيات. إن ألصقت رابط فيديو من Pexels خلفيةً، يقرأ خادمنا تلك الصفحة ليجد ملف الفيديو.',
          'القرّاء المدمجون. حين تختار قارئًا مدمجًا، يجلب خادمنا التلاوة من خادم الصوت العام الخاص بها ويمرّرها إلى متصفحك، وقد يحتفظ بنسخة من ذلك التسجيل العام ليقدّمه أسرع؛ ولا شيء منك فيه.',
        ],
      },
      {
        heading: 'ما يبقى على جهازك',
        paragraphs: [
          'تُحفظ مقاطعك وإعدادات مشروعك ومسوّداتك في التخزين المحلي لمتصفحك، وكذلك تفضيلات مثل نظام الألوان ومستوى الصوت وما إذا رأيت الجولة الإرشادية. لا نتلقّى شيئًا منها، ومسح بيانات هذا الموقع من متصفحك يحذفها.',
          'الفيديو نفسه يصنعه متصفحك على جهازك، ولا يُرفع إلينا لصنعه.',
        ],
      },
      {
        heading: 'ما يُرسل تلقائيًا',
        paragraphs: [
          'كما في كل موقع، يرسل متصفحك إلى خادمنا عنوان IP وتفاصيل كل طلب. يستعمل الاستوديو عنوان IP في الذاكرة فقط، لتقسيم دور المطابقة بعدل بين الزوار، ولا يسجّله. ولا يحتفظ الاستوديو بسجل لمن زاره.',
          'ملفات تعريف الارتباط. لا يضع الاستوديو إلا هذه، وليس منها شيء للإعلانات أو التتبّع:',
        ],
        list: [
          '`qc-lang`: اللغة التي اخترتها. تبقى سنة.',
          '`qc_youtube`: فقط إن بقيت متصلًا بـ YouTube. تسجيل دخولك إلى Google مشفّرًا، ولا يُرسل إلا إلى مسارات YouTube في الاستوديو. يبقى سنة من آخر استعمال، أو حتى تقطع الاتصال.',
          '`studio_token`: فقط في استوديو خاص يحميه صاحبه بكلمة سر.',
        ],
      },
      {
        heading: 'Google وYouTube',
        paragraphs: [
          'النشر على YouTube اختياري. إن اخترته، تسجّل الدخول بـ Google وتمنح الاستوديو إذنًا واحدًا: رفع الفيديوهات إلى قناتك على YouTube (نطاق `youtube.upload`). لا يطلب الاستوديو بريدك الإلكتروني ولا جهات اتصالك ولا أي شيء آخر في حسابك، ولا يستطيع قراءة فيديوهاتك الموجودة أو تغييرها أو حذفها.',
          'كيف يُستعمل. لرفع الفيديو الذي اخترته فقط، بالعنوان والوصف والوسوم ومستوى الظهور التي أدخلتها، حين تضغط زر الرفع. ويذهب الفيديو من متصفحك إلى YouTube مباشرة.',
          'كيف يُحفظ. إن لم تبقَ متصلًا، يبقى الإذن الذي تمنحه Google للاستوديو في متصفحك مدة أقصاها ساعة ولا يصل إلى خادمنا. وحيث يُبقيك الاستوديو متصلًا، تعطي Google خادمنا رمز تحديث، فيشفّره (AES-256-GCM) ويعيده إلى متصفحك في ملف تعريف ارتباط لا يقرؤه إلا خادمنا. لا يحتفظ خادمنا بنسخة منه، ولا يستطيع استعماله إلا حين يرسله متصفحك لرفع طلبته أنت.',
          'كيف يُشارك. لا يُشارك. لا تُباع بياناتك على Google ولا تُعطى لأحد ولا تُستعمل للإعلانات ولا لتدريب أي نموذج ذكاء اصطناعي. يلتزم Quran-Clipper في استعمال المعلومات المتلقّاة من واجهات Google ونقلها بـ [سياسة بيانات المستخدم لخدمات واجهات Google](' + USER_DATA_POLICY + ')، بما فيها متطلبات الاستعمال المحدود.',
          'كيف تزيله. اختر «قطع الاتصال» في لوحة YouTube في الاستوديو: يُلغي الاستوديو إذنه لدى Google ويحذف ملف تعريف الارتباط. ويمكنك أيضًا إزالة إذن الاستوديو متى شئت من [أذونات حسابك على Google](' + GOOGLE_PERMISSIONS + ').',
          'الرفع يستعمل خدمات واجهة YouTube البرمجية. بالنشر على YouTube توافق على [شروط خدمة YouTube](' + YOUTUBE_TERMS + ')، وتعامل Google مع بياناتك موضّح في [سياسة خصوصية Google](' + GOOGLE_PRIVACY + ').',
        ],
      },
      {
        heading: 'خدمات يعتمد عليها الاستوديو',
        list: [
          'Quran.com وواجهة Quran Foundation، لنص القرآن والترجمات وتوقيتات التلاوة. يسألها خادمنا، لا متصفحك.',
          'خوادم صوت التلاوة العامة (quranicaudio.com وmp3quran.net وtarteel.ai)، عبر خادمنا.',
          'Google Fonts: يحمّل متصفحك خطوط الاستوديو من Google، فتتلقّى Google عنوان IP الخاص بك حينها.',
          'Pexels، إن اخترت خلفية من Pexels: يحمّل متصفحك ذلك الفيديو من Pexels.',
          'واجهة Gemini من Google، فقط حيث يقدّم استوديو مطابِق Gemini وتختاره: يُرسل تسجيلك حينها إلى Google لمطابقته.',
          'YouTube، كما سبق، فقط إن نشرت عليه.',
        ],
      },
      {
        heading: 'الأطفال',
        paragraphs: ['الاستوديو غير موجّه للأطفال دون الثالثة عشرة، ولا نجمع عن علم معلومات شخصية منهم.'],
      },
      {
        heading: 'الأمان',
        paragraphs: [
          'يُقدَّم الاستوديو عبر HTTPS. تسجيل دخولك إلى YouTube مشفّر ولا يقرؤه إلا خادمنا، وتسجيلاتك لا تُكتب أبدًا في تخزين دائم. ولا يوجد نظام آمن تمامًا، ولا نستطيع أن نعد بألّا يُعترض ما يُرسل عبر الإنترنت.',
        ],
      },
      {
        heading: 'التغييرات',
        paragraphs: [
          'إن تغيّرت هذه السياسة، تُنشر النسخة الجديدة هنا بتاريخ جديد. وأي تغيير فيما يفعله الاستوديو ببيانات مستخدمي Google يُذكر هنا قبل أن يسري.',
        ],
      },
      {
        heading: 'التواصل',
        paragraphs: ['للأسئلة عن هذه السياسة: {contact}.'],
      },
    ],
  },
};

export const TERMS: Record<Locale, LegalDocument> = {
  en: {
    title: 'Terms of service',
    updated: 'Last updated ' + UPDATED.en,
    intro: [
      'These terms apply when you use Quran-Clipper (“the studio”) at this address. By using it you agree to them. If you do not agree, please do not use the studio.',
    ],
    sections: [
      {
        heading: 'The studio',
        paragraphs: [
          'Quran-Clipper is a free tool for making Quran recitation videos: it times captions to a recitation, adds translations and renders a video in your browser. It is offered as it is, without an account, and it may change, be limited or stop at any time.',
        ],
      },
      {
        heading: 'Your content',
        paragraphs: [
          'You keep every right you have in recordings, images and videos you bring to the studio. You let us process them only as far as needed to do what you asked — for example, to time a recording you upload — as described in the [privacy policy](/privacy).',
          'You are responsible for having the right to use what you bring, and for what you publish with the videos you make.',
        ],
      },
      {
        heading: 'Recitations, texts and translations',
        paragraphs: [
          'The built-in recitations belong to their reciters and publishers and are played from public audio servers. The Quran text, the translations and the recitation timings come from Quran.com and the Quran Foundation, and each translation belongs to its translator. They are made available here for making recitation videos; when you publish a video, it is up to you to respect the terms of the recordings and translations it uses.',
        ],
      },
      {
        heading: 'Use it with care',
        paragraphs: ['Please do not use the studio:'],
        list: [
          'to break the law or infringe anyone’s rights;',
          'to present altered or misattributed Quran text, recitations or translations as genuine;',
          'to mock, insult or misuse the Quran or its recitation;',
          'to overload, scrape, probe or attack the studio or its server, or to get around its limits.',
        ],
      },
      {
        heading: 'Check before you publish',
        paragraphs: [
          'Caption timings are made automatically and can be wrong. Read through your captions, the Quran text and the translation before you publish a video; you are responsible for what you post.',
        ],
      },
      {
        heading: 'YouTube',
        paragraphs: [
          'Posting to YouTube uses YouTube API Services. By using it you agree to be bound by the [YouTube Terms of Service](' + YOUTUBE_TERMS + '), and Google’s handling of your information is described in the [Google Privacy Policy](' + GOOGLE_PRIVACY + '). You can withdraw the studio’s access at any time, as the privacy policy explains.',
        ],
      },
      {
        heading: 'The software',
        paragraphs: [
          'The studio’s source code is published under the [Quran Clipper Personal & Non-Commercial License](' + LICENSE + '). These terms cover using the studio at this address; the licence covers the code.',
        ],
      },
      {
        heading: 'No warranty',
        paragraphs: [
          'The studio is provided “as is” and “as available”, without warranties of any kind, express or implied, including fitness for a particular purpose, accuracy and uninterrupted availability. To the fullest extent the law allows, we are not liable for any indirect, incidental or consequential loss, or for any loss of data, content or opportunity, arising from your use of the studio.',
        ],
      },
      {
        heading: 'Changes',
        paragraphs: [
          'We may update these terms. The current version is always here, with its date, and using the studio after a change means you accept the new terms.',
        ],
      },
      {
        heading: 'Contact',
        paragraphs: ['Questions about these terms: {contact}.'],
      },
    ],
  },
  ar: {
    title: 'شروط الخدمة',
    updated: 'آخر تحديث ' + UPDATED.ar,
    governs: 'هذه ترجمة للنص الإنجليزي، وعند الاختلاف يُعتمد النص الإنجليزي.',
    intro: [
      'تسري هذه الشروط حين تستعمل Quran-Clipper («الاستوديو») على هذا العنوان، وباستعماله توافق عليها. إن لم توافق، فلا تستعمل الاستوديو من فضلك.',
    ],
    sections: [
      {
        heading: 'الاستوديو',
        paragraphs: [
          'Quran-Clipper أداة مجانية لصنع فيديوهات التلاوة القرآنية: يضبط توقيت المقاطع على التلاوة، ويضيف الترجمات، ويصنع الفيديو في متصفحك. يُقدَّم كما هو، دون حساب، وقد يتغيّر أو يُقيَّد أو يتوقف في أي وقت.',
        ],
      },
      {
        heading: 'محتواك',
        paragraphs: [
          'تحتفظ بكل حق لك في التسجيلات والصور والفيديوهات التي تأتي بها إلى الاستوديو. وتأذن لنا بمعالجتها بالقدر اللازم لفعل ما طلبته فقط — كضبط توقيت تسجيل ترفعه — كما في [سياسة الخصوصية](/privacy).',
          'أنت مسؤول عن امتلاك حق استعمال ما تأتي به، وعما تنشره بالفيديوهات التي تصنعها.',
        ],
      },
      {
        heading: 'التلاوات والنصوص والترجمات',
        paragraphs: [
          'التلاوات المدمجة ملك لقرّائها وناشريها، وتُشغّل من خوادم صوت عامة. ونص القرآن والترجمات وتوقيتات التلاوة من Quran.com وQuran Foundation، وكل ترجمة ملك لمترجمها. وهي متاحة هنا لصنع فيديوهات التلاوة؛ وحين تنشر فيديو، فعليك احترام شروط التسجيلات والترجمات التي يستعملها.',
        ],
      },
      {
        heading: 'استعمله بعناية',
        paragraphs: ['من فضلك لا تستعمل الاستوديو:'],
        list: [
          'لمخالفة القانون أو التعدّي على حقوق أحد؛',
          'لعرض نص قرآني أو تلاوة أو ترجمة محرّفة أو منسوبة إلى غير أصحابها على أنها صحيحة؛',
          'للسخرية من القرآن أو تلاوته أو الإساءة إليه أو استعماله في غير موضعه؛',
          'لإثقال الاستوديو أو خادمه أو كشطه أو فحصه أو مهاجمته، أو للالتفاف على حدوده.',
        ],
      },
      {
        heading: 'راجع قبل أن تنشر',
        paragraphs: [
          'توقيتات المقاطع تُصنع آليًا وقد تخطئ. راجع مقاطعك ونص القرآن والترجمة قبل نشر أي فيديو؛ فأنت مسؤول عما تنشره.',
        ],
      },
      {
        heading: 'YouTube',
        paragraphs: [
          'النشر على YouTube يستعمل خدمات واجهة YouTube البرمجية، وباستعماله توافق على الالتزام بـ [شروط خدمة YouTube](' + YOUTUBE_TERMS + ')، وتعامل Google مع معلوماتك موضّح في [سياسة خصوصية Google](' + GOOGLE_PRIVACY + '). ويمكنك سحب إذن الاستوديو في أي وقت كما توضّح سياسة الخصوصية.',
        ],
      },
      {
        heading: 'البرنامج',
        paragraphs: [
          'الشيفرة المصدرية للاستوديو منشورة بموجب [رخصة Quran Clipper للاستعمال الشخصي وغير التجاري](' + LICENSE + '). تغطّي هذه الشروط استعمال الاستوديو على هذا العنوان، والرخصة تغطّي الشيفرة.',
        ],
      },
      {
        heading: 'لا ضمان',
        paragraphs: [
          'يُقدَّم الاستوديو «كما هو» و«حسب توفّره»، دون ضمانات من أي نوع، صريحة أو ضمنية، بما فيها الملاءمة لغرض معيّن والدقة واستمرار التوفّر. وإلى أقصى حد يسمح به القانون، لسنا مسؤولين عن أي خسارة غير مباشرة أو عرضية أو تبعية، أو عن فقدان بيانات أو محتوى أو فرص، ينشأ عن استعمالك للاستوديو.',
        ],
      },
      {
        heading: 'التغييرات',
        paragraphs: [
          'قد نحدّث هذه الشروط. النسخة الحالية موجودة هنا دائمًا بتاريخها، واستعمالك للاستوديو بعد أي تغيير يعني قبولك للشروط الجديدة.',
        ],
      },
      {
        heading: 'التواصل',
        paragraphs: ['للأسئلة عن هذه الشروط: {contact}.'],
      },
    ],
  },
};
