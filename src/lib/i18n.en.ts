/**
 * The studio's interface, in English.
 *
 * This object is the *shape* of a translation as well as its default content:
 * `Dictionary` is derived from it, so a locale that forgets a key -- or hands a
 * phrase-builder the wrong number of arguments -- is a type error rather than a
 * blank label discovered by someone using the app.
 *
 * Anything that varies goes through a function rather than string surgery at
 * the call site. Arabic and English do not agree on word order, so a caller
 * that concatenates `"Loaded " + n + " ayahs"` cannot be translated; a caller
 * that asks for `t.source.loadedCount(n)` can.
 *
 * Deliberately NOT in here:
 *   - Anything the exported video contains. The watermark, the surah badge and
 *     translations are the user's content, and flipping the
 *     interface to Arabic must not rewrite the thing being made.
 *   - Raw upstream error text -- HTTP status lines, decoder failures, the
 *     alignment engine's own diagnostics. Those are passed through verbatim so
 *     they can be searched for and reported.
 */
export const en = {
  /** Names the language itself, for the switcher. Never translated. */
  languageName: 'English',
  languageShort: 'EN',
  switchLanguage: 'Change the studio language',

  meta: {
    title: 'Quran Clipper Studio — Quran Recitation Video Editor',
    description:
      'Create Quran recitation videos locally in the browser: forced-aligned word timing, canvas rendering, and 60 FPS 1080p/4K WebM export.'
  },

  common: {
    cancel: 'Cancel',
    apply: 'Apply',
    done: 'Done',
    reset: 'Reset',
    delete: 'Delete',
    remove: 'Remove',
    add: 'Add',
    close: 'Close',
    play: 'Play',
    pause: 'Pause',
    playing: 'Playing',
    duplicate: 'Duplicate',
    moreActions: 'More actions',
    loading: 'Loading…',
    dismiss: 'Dismiss'
  },

  palette: {
    label: 'Theme',
    title: 'Change the studio colour scheme',
    names: {
      nocturne: 'Nocturne',
      slate: 'Slate & Amber',
      mushaf: 'Mushaf',
      graphite: 'Graphite',
      verdigris: 'Verdigris',
      maghrib: 'Maghrib',
      qahwa: 'Qahwa',
      parchment: 'Parchment'
    },
    notes: {
      nocturne: 'Navy and moonlight',
      slate: 'The original',
      mushaf: 'Gold and lapis',
      graphite: 'Neutral grey',
      verdigris: 'Green and brass',
      maghrib: 'Plum dusk and sunset coral',
      qahwa: 'Roasted brown and cardamom',
      parchment: 'Light: paper and ink'
    }
  },

  header: {
    wordmark: 'Quran Clipper',
    pageTitle: (surah: string, number: number, start: number, end: number) =>
      `Quran Clipper Studio — ${surah} ${number}:${start}–${end}`,
    undo: 'Undo',
    undoTitle: 'Undo the last change (Ctrl+Z)',
    redo: 'Redo',
    redoTitle: 'Redo the last undone change (Ctrl+Shift+Z)',
    savedClips: 'Projects',
    saveToProjects: 'Save to Projects',
    draftKept: (when: string) => `Kept in this browser · ${when}`,
    notSavedYet: 'Not saved yet',
    help: 'Help',
    moreMenu: 'More: theme, language and tools',
    saveProject: 'Save project',
    saveProjectTitle: 'Save this clip to the saved-projects list',
    healthDatabase: 'Database',
    healthAligner: 'Aligner',
    groundTruth: 'Ground truth',
    groundTruthTitle:
      'Save this timeline and its audio into scripts/, so a change to the aligner can be scored against the captions you corrected by ear',
    groundTruthWriting: 'Writing ground truth…',
    groundTruthWritten: 'Ground truth saved',
    groundTruthDownloaded: 'Ground truth downloaded',
    groundTruthNeedsAudio: (name: string) =>
      `Could not write into scripts/ from here, so the audio did not come with it — put ${name} in the repo root before running ./gauge.sh.`,
    trimAudio: 'Trim audio',
    trimAudioWithLength: (length: string) => `Trim audio (${length})`,
    trimAudioTitle: 'Trim the uploaded audio — your timeline edits are kept',
    export: 'Export',
    saving: 'Saving…',
    saved: 'Project Saved!',
    savedThisSession: 'Saved (this session)',
    savedInBrowser: 'Saved in this browser',
    saveFailed: 'Save Failed',
    saveFailedStatus: (status: number) => `The server answered ${status}.`,
    audioNotStored:
      'Saved, but this browser had no room to keep the recitation. Hold on to the original file — reopening the project will ask for it.'
  },

  surfaces: {
    preview: 'Preview',
  },

  frame: {
    label: 'Frame',
    safeArea: 'Show what the app covers',
    covered: (platform: string) => `Covered by ${platform}`,
    setAbove: 'The frame shape is set above the preview, and Export opens on the same setting.'
  },

  panel: {
    label: 'Workflow',
    source: 'Source',
    captions: 'Captions',
    style: 'Style',
    toCheck: (count: number) => `${count} to check`
  },

  source: {
    modeLabel: 'What are you starting from?',
    modeReciter: 'Built-in reciter',
    modeRecording: 'My recording',
    sampleHint: 'You’re looking at a sample, Al-Fatihah. Choose a passage to start your own clip.',
    dropTitle: 'Drop audio or video here',
    dropHelp:
      'MP3, WAV, M4A, OGG, MP4, MOV, WebM or MKV, up to about 18 MB (15–20 minutes of MP3). A video’s footage can be the background.',
    engineLabel: 'Timing engine',
    engineSummary: (name: string) => `Timing engine · ${name}`,
    advanced: (breaks: string) => `Advanced · Screen breaks: ${breaks}`,
    matchRecording: 'Match recording',
    timeByHand: 'Time it by hand',
    chooseFileFirst: 'Choose a file to match it.',
    summaryLabel: 'This clip',
    yourRecording: 'Your recording',
    lengthLabel: 'Length',
    captionsLabel: 'Captions',
    editSource: 'Edit source and match',
    backToClip: 'Back to this clip',
    nextReview: 'Next: review captions',
    nextReviewBody: (count: number) =>
      count === 0 ? 'Read through them once before export.' : count === 1 ? '1 caption is worth a look before export.' : `${count} captions are worth a look before export.`,
    review: 'Review',
    howItWorks: 'How it works',
    step1Strong: 'Pick a reciter',
    step1: 'and a surah, or upload your own recitation.',
    step2Before: 'Click',
    step2Button: '“Load ayahs & audio”',
    step2After: 'The ayahs appear on the timeline below.',
    step3Before: 'Press',
    step3Middle: 'to play or pause, and tap',
    step3After: 'at the end of each ayah to set its boundary.',
    step4Strong: 'Drag the edge',
    step4: 'of any block on the timeline to fine-tune it.',
    step5: 'Click a block to choose its words and edit its translation in the Captions tab.',
    step6Before: 'Open the',
    step6Strong: 'Style',
    step6After: ' tab, then export.',
    howItWorksNoteBefore: 'Note: reciters marked',
    howItWorksNoteTimed: 'timed',
    howItWorksNoteMiddle:
      'come with ayah boundaries measured from the recording; the rest are estimates you set yourself on the timeline. Matching a recording only works on',
    howItWorksNoteUploaded: 'uploaded',
    howItWorksNoteEnd: 'files.',

    chooseFile: 'Choose or drop an audio or video file',
    dropHere: 'Drop it here',

    matcherUses: (technical: string) => `Uses ${technical}`,
    skipAlignerTimed: 'Built-in reciters: use their published timings only, without the aligner',
    skipAlignerTimedHelp: 'Faster, and works without the alignment model. Each ayah is one caption, split only where the reciter repeats; the aligner would also split a long ayah where the reciter pauses. Uploads are still aligned.',
    screenBreaksLabel: 'Screen breaks:',
    screenBreaksFewer: 'Fewer',
    screenBreaksNormal: 'Normal',
    screenBreaksMore: 'More',
    screenBreaksHelp: 'Fewer: a new caption only at long pauses. More: at short ones too. An ayah end always starts one. Applies to the next match, and at once to a recording already matched.',
    recutHelp: 'Re-cuts this match at once, without matching again. Fewer breaks only at long pauses, More at short ones too.',
    recutting: 'Re-cutting…',
    recut: 'Re-cut',
    recutCancel: 'Keep my edits',
    recutReplacesEdits: (level: string) => `Re-cutting at ${level} replaces your caption edits. Ctrl+Z brings them back.`,
    screenBreaksUploadsOnly: 'With published timings only, this applies to uploads, not built-in reciters.',
    matcherLocal: 'Local',
    matcherLocalTechnical: 'local forced alignment',
    matcherLocalBlurb:
      'Finds the passage in the audio, then times every word against the real Quran text, so no word can be dropped or misheard. Nothing leaves your machine.',
    matcherLocalFix: 'This needs the local helper app running. Start it, then reload this page.',
    matcherPublic: 'Match',
    matcherPublicBlurb:
      'Finds the passage in the audio, then times every word against the real Quran text, so no word can be dropped or misheard.',
    matcherPhonemeLab: 'Phoneme lab',
    matcherPhonemeTechnical: 'local forced alignment, each stage by the model chosen for it',
    matcherPhonemeBlurb:
      'Development only. Matches like Local, with each stage done by the model you choose: reading what was recited (restarts included), the word times the captions are cut from, and the word starts Highlight and Reveal use. Local is fastconformer for the first two and the older phoneme model for word starts.',
    labStage: { reading: 'Reading', timing: 'Caption timing', starts: 'Word starts' },
    labModel: { fastconformer: 'fastconformer', old: 'Phoneme (older)', v31: 'Phoneme v3.1', none: 'fastconformer', best: 'Best of both', mixed: 'Restart by restart' },
    labPublished: 'Use published reciter timings',
    matcherQul: 'Local + QUL',
    matcherExperimental: 'Experimental',
    matcherQulTechnical: 'local forced alignment, with QUL morphology and mutashabihat',
    matcherQulBlurb:
      'The same local matcher, but it also uses QUL’s word roots and its list of repeated passages to work out which passage was recited. Try it on the same recording as Local to compare.',
    matcherQulFix:
      'This needs the local helper app running and the QUL morphology and mutashabihat files imported into data/qul (node scripts/qul-import.mjs).',
    matcherOnline: 'Online',
    matcherOnlineTechnical: 'Gemini cloud matching',
    matcherOnlineBlurb:
      'Works with nothing installed, but the timing is estimated rather than measured, so expect to correct it by hand. Your audio is sent to Google.',
    matcherOnlinePublic: 'Not offered on this public studio.',
    matcherOnlineFix: 'Add a Gemini API key to use this option.',
    matcherChecking: 'Checking…',
    matcherQulMissing: 'QUL files missing',
    matcherQulRestart: 'Restart the helper',
    matcherQulRestartFix:
      'The local helper app is running code from before QUL support was added. Stop it and start it again, and this option will be ready -- the QUL files are already in place.',
    matcherReady: 'Ready',
    matcherHelperNotRunning: 'Helper not running',
    matcherHelperNeedsRestart: 'Helper needs restarting',
    matcherNeedsApiKey: 'Needs an API key',
    matcherEngineFailedTitle:
      'The helper is running but could not load its alignment engine, so matching will fail.',
    matcherEngineFailedBody:
      'This is almost always the service being started by the wrong Python. Restart it from its virtualenv:',

    useVideoAsBackground: 'Use this video as the background',
    useVideoAsBackgroundHelp: 'Its frames follow the audio, so the recitation stays in sync',
    useVideoAsBackgroundOffset: (offset: string) => ` (offset ${offset} after trimming)`,

    trimHelp:
      'Trim before matching to crop dead air first, or after to cut the AI-matched timeline down — either way the segment times adjust to the new clip automatically.',

    selectSurah: 'Surah',
    surahOption: (number: number, english: string, arabic: string, ayahs: number) =>
      `${number}. ${english} (${arabic}) - ${ayahs} Ayahs`,
    startAyah: 'From ayah',
    endAyah: 'To ayah',

    selectReciter: 'Reciter',
    reciterTimed: 'timed',
    reciterTimedTitle: 'Ayah boundaries for this reciter come from the recording',
    reciterStyles: {
      Murattal: 'Murattal',
      Emotional: 'Emotional'
    },

    loadVerses: 'Load ayahs & audio',
    loadingVerses: 'Loading ayahs…',
    showOnTimeline: 'Show on timeline',
    loadFailed: 'Could not load those ayahs. Check your connection and try again.',
    loadedCount: (count: number) => `Loaded ${count} ${count === 1 ? 'ayah' : 'ayahs'}.`,
    loadedAgainstUpload:
      'Your uploaded file is still the audio being played, and these times belong to the reciter’s recording — not to it. Match the recording, or set the boundaries on the timeline.',
    loadedMeasured: (seeked: boolean) =>
      `Ayah boundaries came from the recording itself${
        seeked ? ', and the playhead has moved to the first one' : ''
      }.`,
    loadedEstimated:
      'This reciter has no published timings, so the boundaries are estimated — set them on the timeline before exporting.'
  },

  match: {
    recutDone: (level: string, count: number) => `Re-cut at ${level}: ${count} caption${count === 1 ? '' : 's'}.`,
    recutExpired: 'The aligner no longer holds this match, so it cannot be re-cut. Match the recording again with Edit source and match.',
    recutFailed: (error: string) => `Could not re-cut: ${error}`,
    videoUploaded:
      'Video uploaded — its audio will be used for matching, and its footage as the background. Choose Match recording to find and time the ayahs, or Time it by hand to set the captions yourself.',
    audioUploaded:
      'Audio uploaded. Choose Match recording to find and time the ayahs, or Time it by hand to set the captions yourself.',
    audioRestored:
      'Recitation restored, cut to the same stretch this project was saved with — the timeline below already matches it.',
    awaitingAudio: (name: string) =>
      `This project was made from ${name}, and this browser no longer has its copy. Choose that file again and it will be cut to match the timeline.`,
    translationsRemoved: (ids: string) =>
      `A translation this project used (${ids}) is no longer published, so it was taken out. The card now shows the translations that remain, or the default if none do.`,
    trimmed: (length: string) =>
      `Trimmed to ${length}. Match the recording again for the trimmed clip, or review the adjusted timeline below.`,
    trimmingRange: 'Trimming the audio to the clip you marked…',
    trimRangeFailed: 'Could not trim this file. Try the Trim audio dialog, which reports what went wrong.',
    alignLostAyahs: (count: number, keys: string) =>
      `Ayahs loaded with their published timings. Reading the recording was tried too, but it lost ${count} ayah(s) (${keys}), so the loaded timings were kept instead \u2014 use \u201cAlign to audio\u201d if you want the phrase-level split anyway.`,
    publishedTimed: (captions: number, source: string, split: 'pauses' | 'skipped' | 'unheard') =>
      split === 'pauses'
        ? `Timed from ${source}\u2019s published word timings \u2014 ${captions} caption(s), split only where the reciter pauses or repeats.`
        : split === 'skipped'
        ? `Timed from ${source}\u2019s published word timings alone, as set under Local + QUL \u2014 ${captions} caption(s): one per ayah, and another wherever the reciter repeats. Use Split to divide a long ayah.`
        : `Timed from ${source}\u2019s published word timings \u2014 ${captions} caption(s), one per ayah: the reciter\u2019s pauses could not be read from the recording, so a long ayah is not split. Use Split to divide one, or check that the local aligner is running.`,
    noAlignerOnLoad:
      'Ayahs loaded, but the boundaries are estimates \u2014 the local aligner is not running, so the recording could not be read. Start it with ./start.sh and press \u201cAlign to audio\u201d, or set the boundaries yourself on the timeline.',
    reciterNoUrl: 'This reciter\u2019s audio has no address the aligner can fetch.',
    needLoad: 'Load the ayahs first, then align them.',
    passageTooLong: (minutes: number, limit: number) =>
      `That passage is about ${minutes} minutes long and the aligner handles up to ${limit}. Choose fewer ayahs.`,
    alignReciter: 'Align to audio',
    segments: 'Reciter timings',
    segmentsTitle:
      'Time this passage from the reciter’s own published word timings. Measured for this recording rather than worked out from the audio, and it gives every word a start.',
    segmentsLoading: 'Reading the reciter’s published timings…',
    qulSegments: 'QUL timings',
    qulSegmentsTitle:
      'Time this passage from QUL’s word timings for this reciter, and play QUL’s recording of it: the timings were measured on that recording, not on the one loaded now.',
    qulSegmentsUnavailable: (reciter: string) =>
      `No QUL timings for this reciter on this machine. Download its “with segments” surah-by-surah recitation from qul.tarteel.ai as JSON and unzip it into data/qul/recitations/${reciter}/.`,
    qulSegmentsLoading: 'Reading QUL’s timings…',
    qulSegmentsNone: 'QUL’s export has no timings for this passage. The other ways of timing it are unaffected.',
    qulSegmentsDone: (ayahs: number, timed: number, bounds: number) =>
      `Timed ${ayahs} ayah${ayahs === 1 ? '' : 's'} from QUL — ${timed} with word-by-word times${
        bounds > 0 ? `, ${bounds} with the ayah’s bounds only` : ''
      }. Now playing QUL’s recording, which those timings were measured on.`,
    segmentsUnavailable:
      'This reciter has no published timings — their recording is not one of the measured ones. Use Align to audio instead.',
    segmentsNone:
      'No published timings came back for this passage. The other two ways of timing it are unaffected.',
    segmentsDone: (ayahs: number, timed: number, bounds: number) =>
      bounds > 0
        ? `Timed ${ayahs} ayah${ayahs === 1 ? '' : 's'} from the reciter’s own recording — ${timed} with word-by-word times, ${bounds} with the ayah’s bounds only.`
        : `Timed ${ayahs} ayah${ayahs === 1 ? '' : 's'} from the reciter’s own recording, every word included.`,
    alignReciterTitle:
      'Read the reciter\u2019s own recording and place every word, instead of estimating where the ayahs fall.',
    needUpload: 'Choose a recording before matching it.',
    queued: (position: number, wait: string | null) =>
      `In the queue, number ${position}${wait ? ` -- about ${wait}` : ''}. Other people are matching first.`,
    aligning:
      'Force-aligning the selected ayah range against your audio (first run loads the model — may take longer)...',
    timingPublished: 'Timing the passage from the reciter\u2019s published word timings...',
    sendingToGemini: 'Sending audio to Gemini for analysis...',
    notConfigured: 'The matcher is not configured. Time this recording by hand instead.',
    failed: 'Matching failed. Time it by hand, or check the timing engine and try again.',
    detected: (label: string, segments: number) => `Detected ${label} — ${segments} segment(s). `,
    fallbackSurahLabel: (number: number) => `Surah ${number}`,
    confirmRange:
      'Check that this is the right surah and ayah range for your audio, then review the timings below before publishing.',
    reviewTimings: 'Review the timings and text below before publishing.',
    manualMode:
      'Timing by hand: set where each caption starts and ends on the timeline, and its ayah under Captions › More.'
  },

  audioErrors: {
    aborted: 'Audio loading was aborted.',
    network: 'Network error — could not reach the audio server. Check your internet connection.',
    decode: 'Audio decoding failed. The file may be corrupted or in an unsupported format.',
    unsupported: 'Audio source not supported or not found. The reciter URL may be incorrect for this surah.',
    unknown: (code: string | number) => `Audio failed to load (error ${code}).`,
    hint: 'Try switching reciters, or upload a custom audio file.'
  },

  draft: {
    title: 'Work from your last visit',
    describe: (project: string, when: string) => `${project} — last changed ${when}.`,
    restore: 'Restore it',
    dismiss: 'Discard',
    audioMissing: (name: string) =>
      `The recitation was your upload ${name}, which cannot be reopened for you — restore the timeline, then pick that file again.`,
    backgroundsMissing: (count: number) =>
      `${count} uploaded background${count === 1 ? '' : 's'} could not be written down. Add ${
        count === 1 ? 'it' : 'them'
      } again from your backgrounds.`,
    restored: 'Restored from your last visit.',
    savedAt: (when: string) => `Draft saved ${when}`,
    savedTitle: 'Saved in this browser, so a refresh or a crash does not lose it. It is not a saved clip.'
  },

  translations: {
    dialogLabel: 'Choose translations',
    title: 'Translations',
    help: (max: number) =>
      `Pick up to ${max}. They appear under the Arabic in the order you choose them — one language, or two side by side.`,
    selected: (count: number, max: number) => `On the card (${count}/${max}):`,
    searchPlaceholder: 'Search a language or a translator…',
    loading: 'Loading the list of translations…',
    failed: 'Could not load the list. The translation already on the card still works.',
    noMatches: (query: string) => `Nothing matches “${query}”.`,
    rtlBadge: 'RTL',
    remove: (name: string) => `Remove ${name}`,
    keepOne: 'At least one translation stays on the card — hide them with the Translation switch instead.',
    atLimit: (max: number) => `${max} is the most that fits and still reads. Remove one first.`,

    panelLabel: 'Translations',
    everyCaption: 'Shown under the Arabic of every caption',
    change: 'Change'
  },

  batch: {
    open: 'Open',
    title: 'Match several recordings',
    button: 'Match several recordings…',
    help: (matcher: string) =>
      `Choose recitations, audio or video, and each is matched in turn with the ${matcher} matcher, which finds the passage by itself. Open any result in the studio, or save them all as projects with the current look.`,
    choose: 'Choose recordings',
    start: (count: number) => `Match ${count} recording${count === 1 ? '' : 's'}`,
    stop: 'Stop after this one',
    saveAll: 'Save all as projects',
    saved: 'saved',
    remove: 'Remove from the list',
    found: (title: string, captions: number) => `${title} · ${captions} caption${captions === 1 ? '' : 's'}`,
    notReady: 'The local matcher is not running. Start the helper app, then try again.',
    keepOpen: 'Matching runs in this tab. Keep it open until the list is done.'
  },
  exportQueue: {
    label: 'Export queue',
    heading: (count: number) => `Queue · ${count} render${count === 1 ? '' : 's'}`,
    run: (count: number) => `Render queue (${count})`,
    cancel: 'Stop the queue',
    clear: 'Clear finished',
    cancelled: 'Stopped',
    moveUp: 'Earlier',
    moveDown: 'Later',
    remove: 'Remove from queue',
    keepOpen: 'The queue runs in this tab. Keep it open until every render is done.'
  },
  serverRender: {
    label: 'Background renders',
    heading: (count: number) => `Background renders · ${count}`,
    sending: 'Sending to the server…',
    note: 'These keep rendering after this tab is closed.',
    queued: 'Waiting',
    rendering: (percent: number) => `Rendering · ${percent}%`,
    finishing: 'Adding the recitation…',
    failed: 'Failed',
    cancelled: 'Cancelled',
    cancel: 'Cancel this render',
    remove: 'Remove from the list',
    sendFailed: (reason: string) => `Could not send the render: ${reason}`
  },
  presets: {
    heading: 'Presets',
    showAll: (count: number) => `All ${count}`,
    help: 'A whole look in one click: font, colours, card, layout, badge style and background. Your translations, badge text, watermark and aspect ratio stay as they are.',
    items: {
      'night-mosque': { name: 'Night Mosque', note: 'The studio’s default look: the mushaf on a moonlit mosque, soft blue accents.' },
      'gold-kaaba': { name: 'Gold Kaaba', note: 'Warm gold over the Kaaba, lightly blurred and dimmed, under a mushaf-style framed heading.' },
      starlight: { name: 'Starlight', note: 'Digital Khatt straight on a starry sky, no card, periwinkle accents.' },
      minimal: { name: 'Minimal', note: 'No card and no visualiser, just a small corner tag: large Arabic straight on a blurred sky.' },
      'madinah-green': { name: 'Madinah Green', note: 'The Prophet’s Mosque with green accents, the calligraphic surah heading, and the Arabic and translation on cards of their own.' },
      indopak: { name: 'IndoPak', note: 'Indopak Nastaleeq on a card under a moonlit minaret, a small corner tag, amber accents.' }
    }
  },
  shortcuts: {
    open: 'Shortcuts',
    openTitle: 'Every keyboard shortcut (?)',
    dialogLabel: 'Keyboard shortcuts',
    title: 'Keyboard shortcuts',
    hint:
      'These work anywhere in the studio except inside a text box — there the keys type, and Ctrl+Z undoes what you typed.',
    macNote: 'On a Mac, ⌘ works wherever Ctrl is listed.',
    playPause: 'Play or pause the recitation',
    markEnd: 'End the selected ayah at the playhead',
    nextToCheck: 'Go to the next caption marked for checking',
    undo: 'Undo the last timeline or styling change',
    redo: 'Redo a change that was undone',
    list: 'Open this list',
    dismiss: 'Close this list, or any dialog'
  },

  timeline: {
    opening: { istiadha: 'Isti\'adha', basmala: 'Basmala' },
    dragToReorder: 'drag to move it in the order',
    label: 'Timeline',
    playRecitation: 'Play recitation',
    pauseRecitation: 'Pause recitation',
    backToStart: 'Back to start',
    rippleOnTitle:
      'On: moving a caption\u2019s end shifts every caption after it, keeping the timeline packed. Untick to move one edge at a time.',
    rippleLabel: 'Shift later captions when I drag',
    rippleOffTitle:
      'Off: each edge moves on its own, and an end stops where the next caption begins. Tick to shift the captions after it again.',
    markAyahEnd: 'Mark caption end',
    markAyahEndTitle: 'End this caption at the playhead and move on to the next (B)',
    nextToCheck: (count: number) => `${count} to check · Next`,
    nextToCheckTitle: (count: number) =>
      `${count} ${count === 1 ? 'caption is' : 'captions are'} marked for checking, where the match was least sure. Go to the next one (N).`,
    toCheck: 'marked for checking',
    trimAudio: 'Trim audio',
    trimAudioTitle: 'Trim the uploaded audio — your timeline edits are kept',
    keep: (length: string) => `Keep ${length}`,
    cutDownTo: (start: string, end: string) => `Cut the audio down to ${start} – ${end}`,
    resetClip: 'Put the clip handles back to the whole recording',
    mute: 'Mute',
    unmute: 'Unmute',
    volume: 'Volume',
    readingAudio: 'reading audio…',
    waveformUnavailable: 'waveform unavailable',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    clip: 'clip',
    playhead: 'Playhead',
    backgrounds: 'Backgrounds',
    moveClipStart: 'Move the start of the clip',
    moveClipEnd: 'Move the end of the clip',
    dragClipStart: 'Drag to move where the audio starts',
    dragClipEnd: 'Drag to move where the audio ends',
    dragToEdit: ' · drag to move, drag an edge to resize',
    clipLength: (length: string) => `clip is ${length} long`,
    clipRepeats: (times: string) => `plays ${times}× here`,
    clipRepeatsAria: (name: string, times: string) => `${name} repeats ${times} times in this block`,
    moveStartOf: (name: string) => `Move start of ${name}`,
    moveEndOf: (name: string) => `Move end of ${name}`,
    empty: 'No ayahs loaded yet — pick a surah on the left, or upload a recitation.'
  },

  inspector: {
    captionOf: (n: number, total: number) => `Caption ${n} of ${total}`,
    ayahSpan: (verseKey: string, start: string, end: string, length: string) => `Ayah ${verseKey} · ${start} – ${end} · ${length}`,
    previous: 'Previous caption',
    next: 'Next caption',
    onScreen: 'On screen',
    tapToHide: 'Tap a word to hide it',
    timing: 'Timing',
    startsLabel: 'Starts',
    endsLabel: 'Ends',
    nudgeHint: 'Steps of 0.2 s. For bigger moves, drag the caption’s edge on the timeline.',
    mergeWithNext: 'Merge with next',
    splitHere: 'Split at playhead',
    delete: 'Delete',
    moreActions: 'More',
    addCaption: 'Add a caption',
    empty: 'Select an ayah on the timeline to choose its words and edit its translation.',
    matchConfidence: (percent: number) => `Match ${percent}%`,
    checkTitle: 'Worth checking',
    checkStopMark:
      'This line ends at a stop mark, but no pause was heard there. If the reciter ran straight on, merge it with the next caption.',
    checkLowMatch: (percent: number) =>
      `The aligner was unsure of this caption (${percent}%). Play it and check where it starts and ends.`,
    looksRight: 'Looks right',
    moveStartEarlier: 'Move start earlier',
    moveStartLater: 'Move start later',
    moveEndEarlier: 'Move end earlier',
    moveEndLater: 'Move end later',
    ayahNumber: 'Ayah number',
    translation: 'Translation',
    alsoAppears: (verseKey: string, count: number, examples: string) =>
      count === 1
        ? `The same words are recited at ${examples} too. This caption is labelled ${verseKey} — if the reciter was on the other one, the ayah number on the video is wrong.`
        : `The same words are recited in ${count} other places — ${examples}${count > 4 ? ', and more' : ''}. This caption is labelled ${verseKey} — if the reciter was on one of those instead, the ayah number on the video is wrong.`,
    translationFollowsWords: 'Translate only these words',
    translationFollowsWordsHint:
      'The text under the Arabic follows the selected words rather than the whole ayah, and uses quran.com’s word-by-word English.',
    oneGlossLine: (count: number) =>
      count === 1
        ? 'The other translation is hidden while this is ticked: the word-by-word glosses are a single English dataset, so it would draw the identical line. Untick to edit it on its own.'
        : `${count} other translations are hidden while this is ticked: the word-by-word glosses are a single English dataset, so they would all draw the identical line. Untick to edit them on their own.`,
    wordByWord: 'Word-by-word',
    wordByWordFrom: (language: string, provider: string) => `${language} · ${provider}`,
    moveAyahEarlier: 'Move ayah earlier',
    moveAyahLater: 'Move ayah later',
    splitHint: 'End this caption at the playhead and start the next one there',
    splitTooShort: 'Move the playhead further into this caption to split it',
    splitOneWord: 'A caption showing one word cannot be split in two',
    merge: 'Merge',
    mergeHint: 'Join this caption to the one after it',
    mergeNotSameAyah: 'Captions can only be merged within one ayah'
  },

  style: {
    tabDesign: 'Text',
    tabBackground: 'Background',
    tabCard: 'Card',
    // Shown on hover, because a label short enough for a 340px column cannot
    // also say what is inside it.
    mushafLines: 'Follow the mushaf’s lines',
    mushafLinesHint:
      'Break the Arabic where the printed page breaks it, instead of wherever the card runs out of room. A long line gets smaller type rather than a new break.',
    headingBranding: 'Watermark',

    bgModeLabel: 'How backgrounds are used:',
    bgModes: {
      single: 'One background',
      'per-ayah': 'One per segment',
      cycle: 'Cycle on a timer',
      shuffle: 'Shuffle',
      custom: 'Cut by hand'
    },
    bgModeHints: {
      single: 'A single looping clip.',
      'per-ayah': 'Steps to the next clip at the start of each segment.',
      cycle: 'Changes every few seconds.',
      shuffle: 'Picks per ayah, repeatably.',
      custom:
        'Any number of clips, each for as long as you like. Takes the layout you have now and lets you drag it on the timeline.'
    },
    secondsPerBackground: 'Seconds per background:',

    laneSummary: (blocks: number) =>
      `Cut by hand on the timeline — ${blocks} block${blocks === 1 ? '' : 's'}.`,
    laneHelp:
      'Drag a block to move it, or an edge to change how long it runs; stretching one past the clip’s own length just plays it again. In the list below, drag one by its handle to put a different clip in that slot without moving the cuts. Pick a mode above to go back to automatic.',
    removeBlockAria: (name: string, start: string) => `Remove ${name} at ${start}s`,

    sequenceEmpty:
      'Tap thumbnails below to add backgrounds. With none selected this behaves as a single background.',
    sequenceCount: (count: number) =>
      `${count} in the sequence, in play order — the same clip may appear more than once.`,
    sequenceReorder: 'Drag one by its handle to reorder it.',
    moveEarlier: (name: string) => `Move ${name} earlier`,
    moveLater: (name: string) => `Move ${name} later`,
    removeFromSequenceAria: (name: string, position: number) =>
      `Remove ${name} from position ${position}`,

    galleryLabelLane: 'Add a background to the end of the lane:',
    galleryLabelSingle: 'Backgrounds:',
    galleryLabelMulti: 'Pick your backgrounds:',
    galleryHelp:
      'Presets first, then anything you have uploaded or pasted below. Hover one of your own to delete it.',
    tileLength: (length: string) => `Runs for ${length}`,
    tileMissing: 'This file is no longer on this computer, or the link stopped working',
    tileAddToLane: 'Add a block for this clip at the end of the lane',
    tileAddToSequence: 'Add to the sequence — tap again to use it more than once',
    tileNotFound: 'File not found — add it again, or remove it',
    removeBackgroundTitle: 'Remove this background?',
    removeBackgroundMissingMessage: (name: string) =>
      `“${name}” cannot be found any more. Removing it just clears the entry.`,
    removeBackgroundMessage: (name: string, inUse: boolean) =>
      `“${name}” will be taken out of your backgrounds${
        inUse ? ', and out of this video where it is used' : ''
      }. Presets are not affected.`,
    removeBackgroundTooltip: 'Remove from your backgrounds',
    removeBackgroundAria: (name: string) => `Remove ${name} from your backgrounds`,

    browsePexels: 'Browse free stock videos on Pexels',
    browsePexelsHelp: 'Copy the page link from the address bar and paste it below.',

    pasteLinkLabel: 'Paste a video or image link:',
    pasteLinkPlaceholder: 'A .mp4 link, or a Pexels page link',
    pasteLinkHelp:
      'A Pexels page link from the address bar works here — it is looked up and turned into the video file for you.',
    urlNotALink: 'That does not look like a link.',
    urlChecking: 'Checking that link…',
    urlAdded: 'Added to your backgrounds.',
    urlLookingUp: 'Looking that up on Pexels…',
    urlPexelsFailed: 'Could not resolve that Pexels link.',
    urlAddedWithCredit: (credit: string) => `Added — ${credit} on Pexels.`,
    urlResolverUnreachable: 'Could not reach the resolver.',

    uploadLabel: 'Upload Custom Video or Image Loops:',
    uploadBrowse: 'Browse or drop video and image files',
    uploadDropHere: 'Drop them here',
    uploadHelp:
      'Pick or drop as many as you like at once. Kept in this browser, so they are still in the list next time. Clearing site data removes them, and an entry then shows as missing rather than disappearing.',
    uploadAdded: (name: string) => `“${name}” added — it will still be here next time.`,
    uploadAddedMany: (count: number) =>
      `${count} backgrounds added — they will still be here next time.`,
    uploadNotStored: (name: string) =>
      `“${name}” is in this video, but could not be stored for next time — the browser refused it, usually because it is out of space for this site.`,
    uploadSomeNotStored: (failed: number, kept: number) =>
      `${kept === 0 ? `All ${failed}` : `${failed} of ${failed + kept}`} could not be stored for next time — the browser refused them, usually because it is out of space for this site. They are in this video either way.`,

    overlayOpacity: 'Dark Overlay Opacity:',
    backgroundBlur: 'Background Blur:',

    arabicFontLabel: 'Arabic Calligraphy Font:',
    fonts: {
      'qpc-v2': 'Madani Mushaf',
      DigitalKhatt: 'Digital Khatt',
      DigitalKhattIndoPak: 'Digital Khatt IndoPak',
      IndopakNastaleeq: 'Indopak Nastaleeq'
    },
    fontNotInstalled: 'Greyed-out fonts are not installed on this server. They come from the QUL archives -- see “Mushaf fonts” in the README.',
    fontFallback: 'The chosen font is not installed on this server, so the Arabic is drawn in Amiri until it is.',
    arabicFontSize: 'Arabic Font Size:',
    translationFontSize: 'Translation Font Size:',
    ayahNumberSize: 'Ayah Number Size:',

    coloursLabel: 'Colours:',
    colourArabic: 'Arabic text',
    colourArabicDescription: 'The ayah itself.',
    colourAccent: 'Accent',
    colourAccentDescription:
      'Surah badge, ayah number, the divider, the visualiser bars and the card border.',
    colourTranslation: 'Translation text',
    colourTranslationDescription: 'The English line under the Arabic.',

    cardOpacity: 'Card Glass Opacity:',
    badgeOpacity: 'Badge Opacity:',
    badgeTextLabel: 'Surah Badge Text:',
    badgeTextPlaceholder: 'Leave blank for automatic surah/range title',
    badgeTextHelp: 'Leave empty to auto-generate from detected surah and ayah range.',
    badgeSubtitleLabel: 'Surah Badge Subtitle:',
    badgeSubtitlePlaceholder: 'Optional subtitle under the badge title',
    badgeSubtitleHelp: 'Leave empty to hide the second badge line.',
    cardBorder: 'Card border',
    textShadow: 'Text Shadow',
    audioVisualizer: 'Audio Visualizer',
    surahBadge: 'Surah Badge',
    englishTranslation: 'Translation',

    watermarkLabel: 'Watermark / Social Handle:',
    watermarkPlaceholder: '@MyDawahChannel',
    watermarkPositionLabel: 'Watermark Position:',
    watermarkPositions: {
      'bottom-right': 'Bottom Right',
      'bottom-left': 'Bottom Left',
      'top-right': 'Top Right',
      'top-left': 'Top Left'
    },

    tabMotion: 'Motion',
    transitionLabel: 'Between captions:',
    transitions: {
      cut: 'Cut',
      crossfade: 'Cross-fade',
      fadeThrough: 'Fade through',
      slide: 'Slide up',
      zoom: 'Zoom'
    },
    motionSpeedLabel: 'Speed:',
    motionSpeeds: {
      slow: 'Slow',
      normal: 'Normal',
      quick: 'Quick'
    },
    transitionHelp: 'Runs in the pause before the next caption when there is one; where captions run straight on, it is centred on the join.',
    highlightColourLabel: 'Highlight colour:',
    highlightAccent: 'Accent',
    wordEffectLabel: 'Words:',
    wordEffects: {
      none: 'All at once',
      reveal: 'Appear as recited',
      highlight: 'Highlight as recited'
    },
    wordEffectHelp: 'Needs the time of each word, which a match or a built-in reciter gives. A caption without it is drawn whole.',

    layoutLabel: 'Layout:',
    layouts: {
      card: 'Centred card',
      open: 'No card',
      split: 'Arabic and translation apart'
    },
    badgeStyleLabel: 'Badge:',
    badgeStyles: {
      none: 'None',
      pill: 'Pill',
      calligraphic: 'Calligraphic heading',
      frame: 'Mushaf frame',
      corner: 'Corner tag'
    },
    badgeFontMissing: 'The calligraphic heading needs the surah-name font, which is not installed on this server. See the README, "Mushaf fonts and QUL data".'
  },

  colorField: {
    pickAny: 'Pick any colour',
    pickAnyFor: (label: string) => `${label}: pick any colour`,
    hexValue: (label: string) => `${label} hex value`,
    hue: 'Hue',
    saturation: 'Saturation',
    lightness: 'Lightness'
  },

  backgrounds: {
    /** Preset clips. Titles, not filenames -- they name the shot. */
    titles: {
      'mosque-moon': 'Illuminated Mosque & Moon',
      'starry-sky': 'Starry Cosmic Night',
      'aerial-mosque': 'Golden Aerial Mosque',
      'milky-way': 'Celestial Milky Way Ocean',
      'clouds-night': 'Serene Night Sky Clouds',
      'prophet-mosque': 'Medina Prophet Mosque',
      'minaret-moonlit': 'Minaret & Moonlit Sky',
      'aerial-mosque-night': 'Aerial Mosque at Night',
      'urban-mosque-night': 'Urban Mosque Night Cityscape',
      'kaaba-pilgrims': 'Pilgrims at the Kaaba',
      'kaaba-daylight': 'Kaaba Daylight View'
    },
    categories: {
      Nature: 'Nature',
      Mosque: 'Mosque',
      Makkah: 'Makkah',
      Yours: 'Yours',
      Missing: 'Missing'
    },
    /** Fallback names for clips with no title of their own. */
    uploadedImage: 'Uploaded image',
    uploadedClip: 'Uploaded clip',
    pastedImage: 'Pasted image',
    pastedClip: 'Pasted clip',
    generic: 'Background'
  },

  trim: {
    dialogLabel: 'Trim or crop audio',
    title: 'Trim audio',
    help:
      'Drag the ruler to move the playhead; drag the amber handles to set what to keep. Drag this bar to move the window, or its bottom-right corner to resize everything in it.',
    resetWindow: (percent: number) => `Reset window (${percent}%)`,
    readingAudio: 'Reading audio…',
    decodeFailed:
      'Could not read this audio file for trimming. Try a different file, or continue without trimming.',
    trimFailed: 'Could not trim this audio file.',
    playhead: 'Playhead',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    dragPlayhead: 'Drag to move the playhead',
    dragSelectionStart: 'Drag to move the start of the selection',
    dragSelectionEnd: 'Drag to move the end of the selection',
    startLabel: 'Start (m:ss.s)',
    endLabel: 'End (m:ss.s)',
    selectedLength: 'Selected length',
    playFromPlayhead: 'Play from the playhead',
    previewSelection: 'Preview selection',
    previewSelectionTitle: 'Play only the selected region',
    startHere: 'Start here',
    startHereTitle: 'Move the start to the playhead',
    endHere: 'End here',
    endHereTitle: 'Move the end to the playhead',
    applyTrim: 'Apply Trim',
    trimming: 'Trimming…',
    resizeWindow: 'Resize the trim window',
    resizeWindowTitle: 'Drag to resize the whole window'
  },

  renderCheck: {
    button: 'Check this render',
    running: 'Reading the file…',
    failed: 'This browser could not read the file back to check it.',
    ok: {
      length: (seconds: string) => `Length ${seconds}, as trimmed.`,
      start: (at: string) => `Starts at ${at} in the recording, where the trim does.`,
      end: (at: string) => `Ends at ${at} in the recording, where the trim does.`
    },
    problem: {
      length: (seconds: string, expected: string) => `Length ${seconds}, but the trim is ${expected}.`,
      start: (at: string, expected: string) => `Starts at ${at} in the recording, but the trim starts at ${expected}: the beginning is cut.`,
      end: (at: string, expected: string) => `Ends at ${at} in the recording, but the trim ends at ${expected}.`
    },
    unsure: {
      length: 'Could not read the length of the file.',
      start: 'Could not match the start against the recording (too quiet there, or the recording could not be read).',
      end: 'Could not match the end against the recording (too quiet there, or the recording could not be read).',
      background: 'Could not sample the background from this file.'
    },
    backgroundOk: 'Background present and moving throughout.',
    backgroundMissing: (from: string, to: string) => `No background from ${from} to ${to}: the plain gradient shows instead.`,
    backgroundStill: (from: string, to: string) => `The background does not move from ${from} to ${to}: check it has not frozen.`
  },

  exportModal: {
    dialogLabel: 'Export video',
    title: 'Export',
    subtitle: (encoder: string) => `Encodes frame by frame with WebCodecs (${encoder})`,
    subtitleRecorder: (encoder: string) => `Records the canvas in real time via MediaRecorder (${encoder})`,
    detectedGpu: 'Detected GPU',
    gpuNotReported: 'GPU not reported by browser',
    frameRateLabel: 'Frame rate',

    beforeYouPublish: 'Before you publish:',
    beforeYouPublishBody:
      'review every ayah, its timing and its translation yourself. You are responsible for what you publish.',

    presetLabel: 'Where is it going?',
    destinationsHint: 'Pick one or more',
    relaidOut: (ratio: string) => `Re-laid out to ${ratio}`,
    tooLong: 'Longer than this platform accepts',
    fpsValue: (fps: number) => `${fps} fps`,
    videos: (count: number) => (count === 1 ? '1 video' : `${count} videos`),
    noDestination: 'Pick where the video is going',
    renderVideos: (count: number) => (count > 1 ? `Render ${count} videos` : 'Render video'),
    renderOnServer: 'Render on the server, so this tab can be closed',
    presets: {
      tiktok: 'TikTok',
      reels: 'Instagram Reels',
      shorts: 'YouTube Shorts',
      'ig-portrait': 'Instagram Portrait',
      'ig-feed': 'Instagram Feed',
      youtube: 'YouTube',
      facebook: 'Facebook Reels'
    },
    qualityLabel: 'Quality',
    qualityNames: { standard: '1080p', high: '1440p', max: '4K' },
    qualityHelp:
      'Higher is a bigger file and a longer render, and is worth it when the recitation will be watched full-screen. 1080p is what every one of these platforms shows.',
    steppedDown: (asked: string, used: string) =>
      `${asked} would not fit in one file for a clip this long, so it renders at ${used}.`,
    bitrateReduced:
      'Long clip — the bitrate was lowered so the finished file still fits in memory.',
    exceedsMemory:
      'This clip is long enough that the render may run out of memory before it finishes. Trim it, or export it in parts.',
    overLong: (platform: string, seconds: number) =>
      `${seconds}s longer than ${platform} accepts — it will be cut short or refused there.`,
    recorderOnly:
      'This project records in real time, which can only capture the preview’s own 1080p frame. Higher resolutions need the frame-by-frame path.',
    aspectFormat: 'Aspect Format:',
    encoding: 'GPU Encoding Frames...',
    speed: (speed: string) => `Speed: ${speed}`,
    realtimeCapture: 'Real-time capture',
    realtimeCaptureTitle:
      'Export records playback in real time, so a clip takes about as long as its duration.',
    complete: 'Video Render Complete!',
    renderedIn: 'Rendered in',
    renderedOn: (gpu: string) => ` on ${gpu}.`,
    cancelRender: 'Stop this render and close',
    keepTabOpenTitle: 'Keep this tab open and visible.',
    keepTabOpenBody:
      'The picture is recorded from the canvas as it plays, and browsers stop drawing a tab that is in the background. If you switch away the render pauses and waits for you \u2014 nothing is lost, but the wait is added to the total.',
    doNotSwitch: 'Recording \u2014 do not switch tabs',
    pausedNotice: (times: number) =>
      times === 1
        ? 'Paused once while this tab was in the background, then carried on. Nothing was lost \u2014 the wait is why it took longer.'
        : `Paused ${times} times while this tab was in the background, then carried on each time. Nothing was lost \u2014 the waiting is why it took longer.`,
    frozenWarning: (seconds: number) =>
      `About ${seconds}s of this recording has a frozen picture. The canvas stopped painting while it recorded — usually because the tab went to the background or the screen slept. Export again and leave this tab visible.`,
    choppyWarning:
      'The render could not keep up with the frame rate you asked for, so the picture will stutter. Try a lower frame rate, or close other windows using the GPU.',
    download: (container: string) => `Download ${container} video`,
    downloadWithCaption: (container: string) => `Download ${container} & caption`,
    previewButton: 'Preview the cuts first',
    previewRendering: (percent: number) => `Rendering preview… ${percent}%`,
    previewNote: (width: number, height: number) =>
      `Preview at ${width}×${height}: the picture, the timing and where the backgrounds change — not the quality. It runs the whole clip, so it takes about as long as a 1080p render and rather less than a 4K one.`,
    previewClear: 'Close preview',
    previewFailed:
      'The preview did not finish. Nothing is wrong with the export itself — try it, or run the preview again.',
    renderAnother: 'Render Another Export',
    done: 'Done',
    warningsHeading: 'Before you render',
    warnGap: (from: string, to: string) => `No background from ${from} to ${to}: the frame shows the plain gradient there. Drag a block over it on the timeline.`,
    warnSeeking: (name: string) => `${name} cannot be decoded frame by frame here, so it is read by seeking. It will render correctly, but slowly.`,
    warnUnreadable: (name: string) => `${name} cannot be read by this browser: the frame shows the plain gradient wherever it should be. Replace it, or re-add the file.`
  },

  youtube: {
    upload: 'Upload to my YouTube',
    privacyLabel: 'Who can see it',
    privacy: { private: 'Private', unlisted: 'Unlisted', public: 'Public', scheduled: 'Scheduled' },
    scheduleLabel: 'Goes public at (your time)',
    schedulePast: 'That time has already passed. Pick one in the future.',
    scheduleInvalid: 'Pick a date and time for it to go public.',
    help:
      'Signs in to Google in a pop-up and uploads this file to your channel with the caption below. Quran Clipper keeps nothing, and the sign-in ends when you close this tab. Until this studio\'s Google app is verified, YouTube keeps uploads private whatever you choose.',
    privateUntilVerified: 'Private until this studio\'s Google app is verified. Why?',
    signingIn: 'Waiting for Google sign-in in the pop-up…',
    cancel: 'Cancel',
    done: 'Uploaded. YouTube is processing it now.',
    doneScheduled: (when: string) =>
      `Uploaded and scheduled to go public at ${when}. It stays private until then, and until this studio's Google app passes YouTube's audit.`,
    openStudio: 'Open in YouTube Studio',
    failed: {
      signin: 'Google sign-in did not finish, so nothing was uploaded. Press the button to try again.',
      quota: 'This studio has used its YouTube upload allowance for today. Try again tomorrow, or upload the downloaded file on youtube.com.',
      limit: 'YouTube says this channel has reached its upload limit for now. Try again later.',
      forbidden:
        'YouTube refused the upload. The Google account may have no YouTube channel yet, or not be a test user of this studio\'s Google app.',
      network: 'The connection dropped during the upload. Press the button to start again.',
      other: 'YouTube did not accept the upload. Download the file and upload it on youtube.com instead.',
      cancelled: 'Upload cancelled.'
    }
  },
  post: {
    sendTo: 'Send it to',
    computer: 'This computer',
    computerHelp: 'Download the video, with or without its caption',
    uploadsHelp: 'Uploads to your channel. You sign in to Google, never to Quran Clipper',
    openHelp: 'Opens the upload page with the caption copied',
    youtubePage: 'Or open YouTube\'s upload page instead',
    share: 'Another app on this device',
    shareHelp: 'Opens this device\'s share menu',
    platforms: { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' },
    openTitle: (name: string) => `Copy the caption and open ${name}'s upload page`,
    openedCopied: (name: string) => `${name} is open in a new tab, and the caption is on the clipboard. Add the downloaded file there and paste the caption.`,
    openedNotCopied: (name: string) =>
      `${name} is open in a new tab. This browser would not let the page copy the caption, so copy it from "Caption for this clip" below.`,
    popupBlocked: (name: string) => `The browser blocked the new tab. Allow pop-ups for this page, then press ${name} again.`,
    shared: 'Sent to the app. Finish the post there.',
    sharedCopied: 'Sent to the app, and the caption is on the clipboard in case the app left it out. Finish the post there.',
    shareFailed: 'This device could not share the video. Download it and use one of the upload pages instead.'
  },
  publish: {
    title: 'Caption for this clip',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed:
      'This browser would not let the page write to the clipboard. Select the text above and copy it by hand.',
    titleField: 'Title',
    descriptionField: 'Description',
    tagsField: 'Tags',
    includeText: 'Include the ayah text and translation',
    includeTextHelp:
      'Off by default, so the description stays short. The source is credited either way; with this on, that credit is what the text is published under.',
    truncated:
      'Something was shortened to fit what the platform accepts. The credits and hashtags are kept whole.'
  },

  projects: {
    dialogLabel: 'Projects',
    heading: 'Projects',
    tabProjects: (count: number) => `Projects (${count})`,
    tabExports: (count: number) => `Rendered videos (${count})`,
    loading: 'Loading saved items...',
    noProjects: 'No saved projects yet.',
    emptyBody: 'The clip you’re working on is kept in this browser automatically. Save it here to keep it alongside your other clips.',
    saveCurrent: 'Save the current clip',
    searchPlaceholder: 'Search surah, reciter or file',
    newClip: 'New clip',
    noMatches: (query: string) => `No project matches “${query}”.`,
    footerNote: 'The clip you’re working on is also kept in this browser automatically.',
    colPassage: 'Passage',
    colAudio: 'Audio',
    colLength: 'Length',
    colFrame: 'Frame',
    colRendered: 'Rendered',
    colEdited: 'Last edited',
    colActions: 'Actions',
    open: 'Open',
    notRendered: 'Not yet',
    yourRecording: (file: string) => `Your recording · ${file}`,
    noExports: 'No exported video clips yet. Click “Export Video” to render your first clip.',
    openRenderedProject: 'Open the project it was rendered from',
    openInStudio: 'Open in Studio',
    passage: (surah: string, number: number, start: number, end: number) =>
      `${surah} (${number}:${start}-${end})`,
    gpu: (device: string) => `GPU: ${device}`,
    unknownGpu: 'Unknown GPU',
    fps: (fps: number) => `${fps} FPS`,
    clipLength: (length: string) => `${length} long`,
    renderTook: (seconds: string) => `rendered in ${seconds}s`,
    noFileName: 'Rendered before file names were recorded',
    savedToDownloads: 'Saved wherever your browser puts downloads',
    deleteRenderTitle: (title: string) => `Remove the record of ${title}`,
    deleteRenderAria: (title: string) => `Remove the render record for ${title}`,
    deleteTitle: (title: string) => `Delete “${title}”`,
    deleteAria: (title: string) => `Delete ${title}`,
    confirmDeleteTitle: 'Delete this saved project?',
    confirmDeleteMessage: (title: string) =>
      `“${title}” will be removed for good. Anything you have not saved elsewhere — its timings, styling and background choices — goes with it.`,
    confirmDeleteLabel: 'Delete project',
    deleteFailed: (status: number) => `Could not delete that project (HTTP ${status}).`,
    serverUnreachable: 'Could not reach the server.'
  }
};

/**
 * The shape every locale must fill.
 *
 * Derived rather than declared: adding a key to `en` immediately makes every
 * other locale fail to compile until it carries the same key, which is the
 * whole point of typing this at all.
 */
export type Dictionary = typeof en;
