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
 *     the Clear Quran translation are the user's content, and flipping the
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
    title: 'Quran Clip Helper — Quran Recitation Video Studio',
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
      verdigris: 'Verdigris'
    },
    notes: {
      nocturne: 'Navy and pearl',
      slate: 'The original',
      mushaf: 'Gold and lapis',
      graphite: 'Neutral grey',
      verdigris: 'Green and brass'
    }
  },

  header: {
    wordmark: 'Quran Clip',
    wordmarkSuffix: 'Studio',
    pageTitle: (surah: string, number: number, start: number, end: number) =>
      `Quran Clip Studio — ${surah} ${number}:${start}–${end}`,
    undo: 'Undo',
    undoTitle: 'Undo the last change (Ctrl+Z)',
    redo: 'Redo',
    redoTitle: 'Redo the last undone change (Ctrl+Shift+Z)',
    savedClips: 'Saved clips',
    saveProject: 'Save project',
    saveProjectTitle: 'Save this clip to the saved-projects list',
    healthDatabase: 'Database',
    healthAligner: 'Aligner',
    groundTruth: 'Ground truth',
    groundTruthTitle:
      'Download this timeline as a ground-truth file, so a change to the aligner can be scored against the captions you corrected by ear',
    trimAudio: 'Trim audio',
    trimAudioWithLength: (length: string) => `Trim audio (${length})`,
    trimAudioTitle: 'Trim the uploaded audio — your timeline edits are kept',
    export: 'Export',
    saving: 'Saving…',
    saved: 'Project Saved!',
    savedThisSession: 'Saved (this session)',
    saveFailed: 'Save Failed',
    saveFailedStatus: (status: number) => `The server answered ${status}.`
  },

  surfaces: {
    source: 'Source',
    preview: 'Preview',
    inspector: 'Inspector',
    edit: 'Edit',
    switchView: 'Switch view'
  },

  source: {
    sampleTitle: 'This is a sample.',
    sampleBody:
      'The timeline is pre-filled with Al-Fatihah so the preview isn’t blank. Load a surah or upload a recitation to replace it.',

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
    step5: 'Click a block to edit its text and words in the panel on the right.',
    step6Before: 'Switch that panel to',
    step6Strong: 'Style',
    step6After: ', then export.',
    howItWorksNoteBefore: 'Note: reciters marked',
    howItWorksNoteTimed: 'timed',
    howItWorksNoteMiddle:
      'come with ayah boundaries measured from the recording; the rest are estimates you set yourself on the timeline. Auto-matching only works on',
    howItWorksNoteUploaded: 'uploaded',
    howItWorksNoteEnd: 'files.',

    uploadLabel: 'Upload Recitation — Audio or Video:',
    uploadHelp:
      'Audio (MP3 / WAV / M4A / OGG) or video (MP4 / MOV / WebM / MKV). For a video, the audio track is used for matching and the footage becomes the background. AI auto-matching supports files up to ~18 MB (roughly 15–20 minutes of MP3); compress or split longer recordings.',
    chooseFile: 'Choose Audio or Video File',

    matcherLabel: 'AI Matcher:',
    matcherUses: (technical: string) => `Uses ${technical}`,
    matcherLocal: 'Local',
    matcherLocalTechnical: 'local forced alignment',
    matcherLocalBlurb:
      'Finds the passage in the audio, then times every word against the real Quran text, so no word can be dropped or misheard. Nothing leaves your machine.',
    matcherLocalFix: 'This needs the local helper app running. Start it, then reload this page.',
    matcherOnline: 'Online',
    matcherOnlineTechnical: 'Gemini cloud matching',
    matcherOnlineBlurb:
      'Works with nothing installed, but the timing is estimated rather than measured, so expect to correct it by hand. Your audio is sent to Google.',
    matcherOnlineFix: 'Add a Gemini API key to use this option.',
    matcherChecking: 'Checking…',
    matcherReady: 'Ready',
    matcherHelperNotRunning: 'Helper not running',
    matcherHelperNeedsRestart: 'Helper needs restarting',
    matcherNeedsApiKey: 'Needs an API key',
    matcherDetectionOffBefore:
      'Passage detection is switched off on your helper, so it will time the surah and range selected above instead of finding them in the audio. Unset',
    matcherDetectionOffAfter: 'and restart it to turn detection back on.',
    matcherEngineFailedTitle:
      'The helper is running but could not load its alignment engine, so matching will fail.',
    matcherEngineFailedBody:
      'This is almost always the service being started by the wrong Python. Restart it from its virtualenv:',

    useVideoAsBackground: 'Use this video as the background',
    useVideoAsBackgroundHelp: 'Its frames follow the audio, so the recitation stays in sync',
    useVideoAsBackgroundOffset: (offset: string) => ` (offset ${offset} after trimming)`,

    autoMatch: 'AI Auto-match',
    manualMatch: 'Manual Match',
    trimHelp:
      'Trim before matching to crop dead air first, or after to cut the AI-matched timeline down — either way the segment times adjust to the new clip automatically.',

    selectSurah: 'Select Surah:',
    surahOption: (number: number, english: string, arabic: string, ayahs: number) =>
      `${number}. ${english} (${arabic}) - ${ayahs} Ayahs`,
    startAyah: 'Start Ayah:',
    endAyah: 'End Ayah:',

    selectReciter: 'Select Reciter / Voice:',
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
      'Your uploaded file is still the audio being played, and these times belong to the reciter’s recording — not to it. Run AI Auto-match, or set the boundaries on the timeline.',
    loadedMeasured: (seeked: boolean) =>
      `Ayah boundaries came from the recording itself${
        seeked ? ', and the playhead has moved to the first one' : ''
      }.`,
    loadedEstimated:
      'This reciter has no published timings, so the boundaries are estimated — set them on the timeline before exporting.'
  },

  match: {
    videoUploaded:
      'Video uploaded — its audio will be used for matching, and its footage as the background. Choose AI Auto-match to detect and sync ayahs, or Manual Match to time segments yourself.',
    audioUploaded:
      'Audio uploaded. Choose AI Auto-match to detect and sync ayahs, or Manual Match to time segments yourself.',
    trimmed: (length: string) =>
      `Trimmed to ${length}. Re-run AI Auto-match for the trimmed clip, or review the adjusted timeline below.`,
    trimmingRange: 'Trimming the audio to the clip you marked…',
    trimRangeFailed: 'Could not trim this file. Try the Trim audio dialog, which reports what went wrong.',
    alignLostAyahs: (count: number, keys: string) =>
      `Ayahs loaded with their published timings. Reading the recording was tried too, but it lost ${count} ayah(s) (${keys}), so the loaded timings were kept instead \u2014 use \u201cAlign to audio\u201d if you want the phrase-level split anyway.`,
    noAlignerOnLoad:
      'Ayahs loaded, but the boundaries are estimates \u2014 the local aligner is not running, so the recording could not be read. Start it with ./start.sh and press \u201cAlign to audio\u201d, or set the boundaries yourself on the timeline.',
    reciterNoUrl: 'This reciter\u2019s audio has no address the aligner can fetch.',
    needLoad: 'Load the ayahs first, then align them.',
    passageTooLong: (minutes: number, limit: number) =>
      `That passage is about ${minutes} minutes long and the aligner handles up to ${limit}. Choose fewer ayahs.`,
    alignReciter: 'Align to audio',
    alignReciterTitle:
      'Read the reciter\u2019s own recording and place every word, instead of estimating where the ayahs fall.',
    needUpload: 'Upload an audio file before running AI auto-match.',
    aligning:
      'Force-aligning the selected ayah range against your audio (first run loads the model — may take longer)...',
    sendingToGemini: 'Sending audio to Gemini for analysis...',
    notConfigured: 'AI matcher is not configured. Use manual matching for this audio.',
    failed: 'AI matcher failed. Use manual matching, or configure the server-side AI matcher and try again.',
    detected: (label: string, segments: number) => `Detected ${label} — ${segments} segment(s). `,
    fallbackSurahLabel: (number: number) => `Surah ${number}`,
    confirmRange:
      'Check that this is the right surah and ayah range for your audio, then review the timings below before publishing.',
    reviewTimings: 'Review the timings and text below before publishing.',
    manualMode:
      'Manual matching mode: assign ayah numbers and adjust start/end times for each audio segment.'
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
    panelHelp: 'What appears under the Arabic. Choose a language, or show two at once.',
    choose: 'Choose translations',
    defaultName: 'Saheeh International',
    publicListNote:
      'This is quran.com’s open list. The Clear Quran (Dr. Mustafa Khattab) is not in it — it comes from the Quran Foundation API, which needs a free client id and secret. See .env.example.'
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
    undo: 'Undo the last timeline or styling change',
    redo: 'Redo a change that was undone',
    list: 'Open this list',
    dismiss: 'Close this list, or any dialog'
  },

  timeline: {
    label: 'Timeline',
    playRecitation: 'Play recitation',
    pauseRecitation: 'Pause recitation',
    backToStart: 'Back to start',
    rippleOn: 'Linked',
    rippleOnTitle:
      'Linked: moving a segment\u2019s end shifts every segment after it, keeping the timeline packed. Click to unlink and move one edge at a time.',
    rippleOff: 'Unlinked',
    rippleOffTitle:
      'Unlinked: each edge moves on its own, and an end stops where the next segment begins. Click to link them again.',
    markAyahEnd: 'Mark ayah end',
    markAyahEndTitle: 'Mark the end of this ayah at the playhead (B)',
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
    tabAyah: 'Ayah',
    tabStyle: 'Style',
    empty: 'Select an ayah on the timeline to edit its text, translation and words.',
    matchConfidence: (percent: number) => `Match ${percent}%`,
    starts: (time: string) => `Starts ${time}`,
    ends: (time: string) => `Ends ${time}`,
    edgeStart: 'start',
    edgeEnd: 'end',
    moveStartEarlier: 'Move start earlier',
    moveStartLater: 'Move start later',
    moveEndEarlier: 'Move end earlier',
    moveEndLater: 'Move end later',
    ayahNumber: 'Ayah number',
    arabic: 'Arabic',
    translation: 'Translation',
    dragToResize: 'drag the corner to resize',
    wordsOnScreen: 'Words in this ayah',
    wordsHint: 'Highlighted words are on screen for this caption. Tap one to show or hide it.',
    moveAyahEarlier: 'Move ayah earlier',
    moveAyahLater: 'Move ayah later',
    deleteAyah: 'Delete ayah',
    split: 'Split',
    splitHint: 'End this caption at the playhead and start the next one there',
    splitTooShort: 'Move the playhead further into this caption to split it',
    splitOneWord: 'A caption showing one word cannot be split in two',
    merge: 'Merge',
    mergeHint: 'Join this caption to the one after it',
    mergeNotSameAyah: 'Captions can only be merged within one ayah',
    beforeYouPublish: 'Before you publish:',
    beforeYouPublishBody:
      'review every ayah, its timing and its translation yourself. You are responsible for what you publish.'
  },

  style: {
    tabDesign: 'Layout & Text',
    tabBackground: 'Background',
    tabCard: 'Card & FX',

    headingFormat: 'Format',
    headingTypography: 'Typography',
    headingBranding: 'Branding',

    aspectRatioLabel: 'Select Video Aspect Ratio:',
    aspectRatios: {
      '9:16': '9:16 Vertical (Shorts / TikTok / Reels)',
      '16:9': '16:9 Widescreen (YouTube)',
      '1:1': '1:1 Square (Instagram Feed)',
      '4:5': '4:5 Portrait (Instagram Post)'
    },

    bgModeLabel: 'How backgrounds are used:',
    bgModes: {
      single: 'One background',
      'per-ayah': 'One per segment',
      cycle: 'Cycle on a timer',
      shuffle: 'Shuffle'
    },
    bgModeHints: {
      single: 'A single looping clip.',
      'per-ayah': 'Steps to the next clip at the start of each segment.',
      cycle: 'Changes every few seconds.',
      shuffle: 'Picks per ayah, repeatably.'
    },
    secondsPerBackground: 'Seconds per background:',

    laneSummary: (blocks: number) =>
      `Cut by hand on the timeline — ${blocks} block${blocks === 1 ? '' : 's'}.`,
    laneHelp:
      'Drag a block to move it, or an edge to change how long it runs; stretching one past the clip’s own length just plays it again. Pick a mode above to go back to automatic.',
    removeBlockTitle: 'Remove this block?',
    removeBlockMessage: (name: string, start: string, end: string) =>
      `“${name}” runs from ${start}s to ${end}s. Removing it leaves a gap there, which shows the plain gradient.`,
    removeBlockConfirm: 'Remove block',
    removeBlockAria: (name: string, start: string) => `Remove ${name} at ${start}s`,

    sequenceEmpty:
      'Tap thumbnails below to add backgrounds. With none selected this behaves as a single background.',
    sequenceCount: (count: number) =>
      `${count} in the sequence, in play order — the same clip may appear more than once.`,
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

    uploadLabel: 'Upload Custom Video or Image Loop:',
    uploadBrowse: 'Browse Video or Image file',
    uploadHelp:
      'Kept in this browser, so it is still in the list next time. Clearing site data removes it, and the entry then shows as missing rather than disappearing.',
    uploadAdded: (name: string) => `“${name}” added — it will still be here next time.`,
    uploadNotStored: (name: string) =>
      `“${name}” is in this video, but could not be stored for next time — the browser refused it, usually because it is out of space for this site.`,

    overlayOpacity: 'Dark Overlay Opacity:',
    backgroundBlur: 'Background Blur:',

    arabicFontLabel: 'Arabic Calligraphy Font:',
    fonts: {
      Amiri: 'Amiri Uthmani',
      'Scheherazade New': 'Scheherazade',
      'Noto Naskh Arabic': 'Noto Naskh',
      'Reem Kufi': 'Kufi Calligraphy',
      'Aref Ruqaa': 'Aref Ruqaa'
    },
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
    }
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

  exportModal: {
    dialogLabel: 'Export video',
    title: 'Video Export',
    subtitle: (encoder: string) => `Encodes frame by frame with WebCodecs (${encoder})`,
    subtitleRecorder: (encoder: string) => `Records the canvas in real time via MediaRecorder (${encoder})`,
    detectedGpu: 'Detected GPU',
    gpuNotReported: 'GPU not reported by browser',
    frameRateLabel: 'Target Frame Rate:',
    fps60: '60 FPS Ultra',
    fps30: '30 FPS Standard',
    resolutionLabel: 'Output Resolution:',

    presetLabel: 'Where is this going?',
    presetHelp:
      'Sets the frame shape, the resolution and the bitrate for that platform. Every one of them re-encodes what you upload, so these render well above what they keep — their pass then has something clean to work from.',
    presets: {
      tiktok: 'TikTok',
      reels: 'Instagram Reels',
      shorts: 'YouTube Shorts',
      'ig-portrait': 'Instagram Portrait',
      'ig-feed': 'Instagram Feed',
      youtube: 'YouTube',
      facebook: 'Facebook Reels'
    },
    presetLimit: (seconds: number) =>
      seconds >= 60 ? `up to ${Math.round(seconds / 60)} min` : `up to ${seconds}s`,
    presetNoLimit: 'no length limit',
    qualityLabel: 'Quality:',
    qualityNames: { standard: '1080p', high: '1440p', max: '4K' },
    qualityHelp:
      'Higher is a bigger file and a longer render, and is worth it when the recitation will be watched full-screen. 1080p is what every one of these platforms shows.',
    estimatedSize: 'Estimated file:',
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
    clipTitle: 'Clip Title:',
    clipLength: 'Clip Length:',
    aspectFormat: 'Aspect Format:',
    bitrateTarget: 'Bitrate Target:',
    encoding: 'GPU Encoding Frames...',
    speed: (speed: string) => `Speed: ${speed}`,
    realtimeCapture: 'Real-time capture',
    realtimeCaptureTitle:
      'Export records playback in real time, so a clip takes about as long as its duration.',
    startRender: (fps: number) => `Start ${fps} FPS Video Render`,
    complete: 'Video Render Complete!',
    renderedIn: 'Rendered in',
    renderedOn: (gpu: string) => ` on ${gpu}.`,
    cancelRender: 'Stop this render and close',
    fastPathTitle: 'Encoded frame by frame.',
    fastPathBody:
      'This browser can encode with WebCodecs, so the clip is rendered as fast as the machine manages rather than in real time \u2014 measured at 6\u201310\u00d7 \u2014 and written as MP4. Video backgrounds are decoded frame by frame and come along. You can switch tabs while it runs.',
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
    renderAnother: 'Render Another Export'
  },

  projects: {
    dialogLabel: 'Saved projects and exports',
    heading: 'Saved Projects & Exports',
    tabProjects: (count: number) => `Projects (${count})`,
    tabExports: (count: number) => `Rendered Videos (${count})`,
    loading: 'Loading saved items...',
    noProjects: 'No saved projects yet. Click “Save Project” in the studio!',
    noExports: 'No exported video clips yet. Click “Export Video” to render your first clip.',
    openInStudio: 'Open in Studio',
    passage: (surah: string, number: number, start: number, end: number) =>
      `${surah} (${number}:${start}-${end})`,
    gpu: (device: string) => `GPU: ${device}`,
    unknownGpu: 'Unknown GPU',
    fps: (fps: number) => `${fps} FPS`,
    downloadWebm: 'Download WebM File',
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
