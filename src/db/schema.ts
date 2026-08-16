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
  
  // Customization & Style Settings
  aspectRatio: text('aspect_ratio').notNull().default('9:16'), // '9:16', '16:9', '1:1', '4:5'
  fontArabic: text('font_arabic').notNull().default('Scheherazade New'),
  fontTranslation: text('font_translation').notNull().default('Inter'),
  arabicFontSize: integer('arabic_font_size').notNull().default(38),
  transliterationFontSize: integer('transliteration_font_size').notNull().default(24),
  translationFontSize: integer('translation_font_size').notNull().default(20),
  ayahNumberFontSize: integer('ayah_number_font_size').notNull().default(34),
  textAlignment: text('text_alignment').notNull().default('center'),
  textColor: text('text_color').notNull().default('#ffffff'),
  accentColor: text('accent_color').notNull().default('#fbbf24'),
  translationColor: text('translation_color').notNull().default('#e2e8f0'),
  textShadow: boolean('text_shadow').notNull().default(true),
  showTransliteration: boolean('show_transliteration').notNull().default(true),
  showTranslation: boolean('show_translation').notNull().default(true),
  showWaveform: boolean('show_waveform').notNull().default(true),
  showSurahBadge: boolean('show_surah_badge').notNull().default(true),
  surahBadgeText: text('surah_badge_text').default(''),
  surahBadgeSubtitleText: text('surah_badge_subtitle_text').default(''),
  
  // Background Settings
  bgType: text('bg_type').notNull().default('video'), // 'video', 'image', 'gradient', 'color'
  bgUrl: text('bg_url').notNull().default('https://videos.pexels.com/video-files/18953366/18953366-hd_1080_1920_30fps.mp4'),
  bgOverlayOpacity: integer('bg_overlay_opacity').notNull().default(40), // 0-100
  bgBlur: integer('bg_blur').notNull().default(0), // 0-20
  cardBgOpacity: integer('card_bg_opacity').notNull().default(30), // 0-100
  cardBorder: boolean('card_border').notNull().default(true),
  
  // Branding
  watermarkText: text('watermark_text').default('@QuranClips'),
  watermarkPosition: text('watermark_position').default('bottom-right'),
  
  // Timestamps JSON array: [{ verseNumber, verseKey, arabicText, translationText, transliterationText, startTime, endTime }]
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
  fileUrl: text('file_url').notNull(),
  aspectRatio: text('aspect_ratio').notNull().default('9:16'),
  duration: integer('duration').notNull().default(0), // seconds
  resolution: text('resolution').notNull().default('1080x1920'),
  fileSizeBytes: integer('file_size_bytes').notNull().default(0),
  fps: integer('fps').notNull().default(60),
  renderTimeMs: integer('render_time_ms').notNull().default(0),
  gpuDevice: text('gpu_device').default('NVIDIA GeForce RTX 5080'),
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
