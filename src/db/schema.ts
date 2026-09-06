import { pgTable, text, timestamp, integer, boolean, jsonb } from 'drizzle-orm/pg-core';

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  surahNumber: integer('surah_number').notNull(),
  surahNameArabic: text('surah_name_arabic').notNull(),
  surahNameEnglish: text('surah_name_english').notNull(),
  ayahStart: integer('ayah_start').notNull(),
  ayahEnd: integer('ayah_end').notNull(),
  reciterId: text('reciter_id').notNull(),
  reciterName: text('reciter_name').notNull(),
  audioUrl: text('audio_url').notNull(),
  audioDuration: text('audio_duration'),

  /**
   * What makes a project built from an uploaded recitation openable again.
   * All three are empty or null for a built-in reciter.
   *
   * `audioUrl` is a `blob:` url for an upload and dies with the tab, so it
   * cannot be the answer on its own. `audioKey` addresses the audio itself in
   * the browser's IndexedDB -- keyed by the recording rather than by the
   * project, since several projects can be cut from one upload. If that has
   * been evicted, `audioFileName` says which file to ask for and `trimWindow`
   * says where in it this project's audio sits, which together rebuild exactly
   * the clip the saved timeline was written against.
   */
  audioFileName: text('audio_file_name').default(''),
  audioKey: text('audio_key').default(''),
  trimWindow: jsonb('trim_window').$type<{ start: number; end: number } | null>(),


  // Customization & Style Settings
  aspectRatio: text('aspect_ratio').notNull().default('9:16'), // '9:16', '16:9', '1:1', '4:5'
  fontArabic: text('font_arabic').notNull().default('Scheherazade New'),
  fontTranslation: text('font_translation').notNull().default('Inter'),
  arabicFontSize: integer('arabic_font_size').notNull().default(38),
  /** @deprecated The studio no longer renders transliteration. Kept so existing rows load; nothing writes it. */
  transliterationFontSize: integer('transliteration_font_size').notNull().default(24),
  translationFontSize: integer('translation_font_size').notNull().default(38),
  ayahNumberFontSize: integer('ayah_number_font_size').notNull().default(40),
  textAlignment: text('text_alignment').notNull().default('center'),
  textColor: text('text_color').notNull().default('#ffffff'),
  accentColor: text('accent_color').notNull().default('#b8c7dc'),
  translationColor: text('translation_color').notNull().default('#d5dfec'),
  textShadow: boolean('text_shadow').notNull().default(true),
  /** @deprecated The studio no longer renders transliteration. Kept so existing rows load; nothing writes it. */
  showTransliteration: boolean('show_transliteration').notNull().default(true),
  showTranslation: boolean('show_translation').notNull().default(true),
  showWaveform: boolean('show_waveform').notNull().default(true),
  showSurahBadge: boolean('show_surah_badge').notNull().default(true),
  surahBadgeText: text('surah_badge_text').default(''),
  surahBadgeSubtitleText: text('surah_badge_subtitle_text').default(''),
  
  // Background Settings
  bgType: text('bg_type').notNull().default('video'), // 'video', 'image', 'gradient', 'color'
  bgUrl: text('bg_url').notNull().default('https://videos.pexels.com/video-files/18953366/18953366-hd_1080_1920_30fps.mp4'),
  bgUrls: jsonb('bg_urls').$type<string[]>().default([]),
  bgMode: text('bg_mode').default('single'),
  /** Hand-placed background blocks: [{ url, start, end }]. Used when bgMode is 'custom'. */
  bgSegments: jsonb('bg_segments').$type<{ url: string; start: number; end: number }[]>().default([]),
  bgCycleSeconds: integer('bg_cycle_seconds').default(5),
  bgOverlayOpacity: integer('bg_overlay_opacity').notNull().default(40), // 0-100
  bgBlur: integer('bg_blur').notNull().default(0), // 0-20
  cardBgOpacity: integer('card_bg_opacity').notNull().default(30), // 0-100
  cardBorder: boolean('card_border').notNull().default(true),
  
  // Branding
  watermarkText: text('watermark_text').default('@QuranClipper'),
  watermarkPosition: text('watermark_position').default('bottom-right'),
  
  // Timestamps JSON array: [{ verseNumber, verseKey, arabicText, translationText, startTime, endTime }]
  versesJson: jsonb('verses_json').notNull().default([]),
  
  // GPU settings
  fps: integer('fps').notNull().default(60),
  gpuAccelerated: boolean('gpu_accelerated').notNull().default(true),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const exports = pgTable('exports', {
  id: text('id').primaryKey(),
  projectId: text('project_id'),
  title: text('title').notNull(),
  /**
   * The name the export was offered under, not a link to it.
   *
   * This used to hold `URL.createObjectURL(blob)`, which is scoped to the
   * document that made it -- so the row's download button was dead as soon as
   * the page reloaded, and there was never a moment when it was more useful
   * than the export dialog's own button still on screen. The browser is never
   * told where the file was saved, so the name is the most a record can
   * honestly carry: enough to find it on disk.
   */
  fileName: text('file_name').notNull().default(''),
  aspectRatio: text('aspect_ratio').notNull().default('9:16'),
  duration: integer('duration').notNull().default(0), // seconds
  resolution: text('resolution').notNull().default('1080x1920'),
  fileSizeBytes: integer('file_size_bytes').notNull().default(0),
  fps: integer('fps').notNull().default(60),
  renderTimeMs: integer('render_time_ms').notNull().default(0),
  gpuDevice: text('gpu_device').default('Unknown GPU'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const presetTemplates = pgTable('preset_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  category: text('category').notNull(), // 'Shorts', 'Reels', 'Widescreen', 'Minimal'
  previewImage: text('preview_image').notNull(),
  configJson: jsonb('config_json').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
