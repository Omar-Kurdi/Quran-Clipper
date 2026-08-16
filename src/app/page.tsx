'use client';

import React from 'react';
import Link from 'next/link';
import { 
  Video, 
  Cpu, 
  Sparkles, 
  Layers, 
  Zap, 
  Clock, 
  Type, 
  CheckCircle, 
  Download, 
  ShieldCheck, 
  BookOpen, 
  ChevronRight,
  Music,
  Sliders
} from 'lucide-react';
import { SURAHS_LIST, RECITERS, BACKGROUND_VIDEOS } from '@/lib/quranData';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200">
      {/* Navigation Header */}
      <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-tr from-amber-500 to-amber-400 rounded-xl text-slate-950 shadow-md">
              <Video className="w-5 h-5 fill-current" />
            </div>
            <div>
              <span className="font-extrabold text-base tracking-tight text-slate-100">
                Quran Clip Helper
              </span>
              <span className="ml-2 text-xs font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                Video Creator
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
              <Cpu className="w-3.5 h-3.5 animate-pulse" />
              <span>NVIDIA RTX 5080 GPU HW Ready</span>
            </div>

            <Link
              href="/video-creator"
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 via-amber-600 to-emerald-500 hover:from-amber-600 hover:to-emerald-600 text-slate-950 font-bold text-xs rounded-xl shadow-lg transition-all hover:scale-105 active:scale-95"
            >
              <Sparkles className="w-4 h-4 fill-current" />
              <span>Launch Studio</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-12 pb-20 overflow-hidden">
        {/* Glow Gradients Background */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-amber-500/15 rounded-full blur-[140px] pointer-events-none"></div>
        <div className="absolute top-1/3 left-1/3 w-[400px] h-[300px] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none"></div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900 border border-amber-500/30 text-amber-400 text-xs font-semibold mb-6 shadow-md">
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span>Replicated for Local GPU Performance (RTX 5080 Accelerated)</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-black text-slate-100 tracking-tight leading-tight sm:leading-tight">
            Create Stunning <span className="bg-gradient-to-r from-amber-400 via-amber-300 to-emerald-400 bg-clip-text text-transparent">Quran Video Clips</span> with Real-Time Audio Sync
          </h1>

          <p className="mt-5 text-base sm:text-lg text-slate-400 max-w-2xl mx-auto font-normal leading-relaxed">
            Replication of <code className="text-amber-300 bg-slate-900 px-1.5 py-0.5 rounded font-mono text-sm">qurancliphelper.com/video-creator</code> for your local webapp.
            Design 60 FPS vertical Shorts, TikToks, and YouTube videos with authentic Uthmani calligraphy, custom audio uploads, tap-to-sync verse timings, and hardware WebCodecs video encoding.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/video-creator"
              className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-amber-500 via-amber-600 to-emerald-500 hover:from-amber-600 hover:to-emerald-600 text-slate-950 font-extrabold text-sm rounded-2xl shadow-xl flex items-center justify-center gap-2.5 transition-all hover:scale-105 active:scale-95"
            >
              <Video className="w-5 h-5 fill-current" />
              <span>Open Quran Video Creator (/video-creator)</span>
              <ChevronRight className="w-4 h-4" />
            </Link>

            <a
              href="#features"
              className="w-full sm:w-auto px-6 py-4 bg-slate-900 hover:bg-slate-800 text-slate-200 font-semibold text-sm rounded-2xl border border-slate-800 transition-colors flex items-center justify-center gap-2"
            >
              <span>Explore Features</span>
            </a>
          </div>

          {/* GPU Hardware Card Badge */}
          <div className="mt-12 p-4 bg-slate-900/90 border border-slate-800 rounded-2xl max-w-xl mx-auto shadow-2xl flex items-center justify-between text-left">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
                <Cpu className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-200 block">NVIDIA GeForce RTX 5080 GPU Acceleration</span>
                <span className="text-[11px] text-emerald-400 font-mono">60 FPS 1080p/4K OffscreenCanvas & WebCodecs Rendering</span>
              </div>
            </div>
            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-mono px-2.5 py-1 rounded-md font-semibold">
              ACTIVE
            </span>
          </div>
        </div>
      </section>

      {/* Feature Highlights Grid */}
      <section id="features" className="py-16 bg-slate-900/40 border-t border-slate-800/80">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-xl mx-auto mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-100">
              Everything in QuranClipHelper, Powered Locally
            </h2>
            <p className="text-slate-400 text-xs sm:text-sm mt-2">
              Full suite of typography, timing sync, aspect ratios, background loops, and video rendering.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 bg-slate-900/90 border border-slate-800 rounded-2xl hover:border-amber-500/40 transition-all">
              <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl w-fit mb-4">
                <Clock className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-slate-100 text-base mb-1">Tap-To-Sync Timestamps</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Play recitation audio and tap spacebar to set verse timings by ear with millisecond accuracy and waveform visualization.
              </p>
            </div>

            <div className="p-6 bg-slate-900/90 border border-slate-800 rounded-2xl hover:border-amber-500/40 transition-all">
              <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl w-fit mb-4">
                <Type className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-slate-100 text-base mb-1">Authentic Uthmani Typography</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Choose from Amiri Uthmani, Scheherazade, Noto Naskh, and Kufi Calligraphy with customizable sizes, shadows, stroke, and colors.
              </p>
            </div>

            <div className="p-6 bg-slate-900/90 border border-slate-800 rounded-2xl hover:border-amber-500/40 transition-all">
              <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl w-fit mb-4">
                <Layers className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-slate-100 text-base mb-1">All Social Media Formats</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Create 9:16 Vertical for TikTok/Shorts/Reels, 16:9 Widescreen for YouTube, 1:1 Square, and 4:5 Instagram feed posts.
              </p>
            </div>

            <div className="p-6 bg-slate-900/90 border border-slate-800 rounded-2xl hover:border-amber-500/40 transition-all">
              <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl w-fit mb-4">
                <Music className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-slate-100 text-base mb-1">Custom Audio Uploads</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Select from famous reciters such as Sudais, Muaiqly, Yasser Al-Dosari, Shuraim, and Ghamdi, or upload your own MP3/WAV audio files under 5 minutes.
              </p>
            </div>

            <div className="p-6 bg-slate-900/90 border border-slate-800 rounded-2xl hover:border-amber-500/40 transition-all">
              <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl w-fit mb-4">
                <Cpu className="w-6 h-6 text-emerald-400" />
              </div>
              <h3 className="font-bold text-slate-100 text-base mb-1">GPU Hardware Render</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Offload video rendering directly to your local GPU (NVIDIA RTX 5080) for 60 FPS high-bitrate video export in seconds.
              </p>
            </div>

            <div className="p-6 bg-slate-900/90 border border-slate-800 rounded-2xl hover:border-amber-500/40 transition-all">
              <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl w-fit mb-4">
                <Sliders className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-slate-100 text-base mb-1">Dynamic Video Loops</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Choose stock video loops of Mecca, Medina, mosques, starry night sky, celestial waves, or upload custom video clips.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Preset Video Loop Gallery Preview */}
      <section className="py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xl font-bold text-slate-100">Stock Video Loop Library</h3>
              <p className="text-xs text-slate-400 mt-1">Included motion background loops for your video clips</p>
            </div>
            <Link
              href="/video-creator"
              className="text-xs text-amber-400 font-semibold hover:underline flex items-center gap-1"
            >
              <span>Open Studio</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {BACKGROUND_VIDEOS.map((bg) => (
              <div key={bg.id} className="relative rounded-xl overflow-hidden aspect-[9/16] border border-slate-800 group">
                <img src={bg.thumbnail} alt={bg.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent flex flex-col justify-end p-2 text-left">
                  <span className="text-[10px] font-bold text-slate-100">{bg.title}</span>
                  <span className="text-[8px] text-amber-400 uppercase">{bg.category}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom Launch Banner */}
      <section className="py-12 bg-gradient-to-r from-amber-500/10 via-amber-600/5 to-emerald-500/10 border-t border-slate-800">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h3 className="text-2xl font-bold text-slate-100">Ready to create your Quran video clip?</h3>
          <p className="text-xs text-slate-400 mt-2 mb-6">
            Launch the local GPU-accelerated video studio and start creating respectfully styled Ayah clips.
          </p>
          <Link
            href="/video-creator"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-amber-500 via-amber-600 to-emerald-500 text-slate-950 font-bold text-sm rounded-xl shadow-lg transition-all hover:scale-105"
          >
            <Video className="w-4 h-4 fill-current" />
            <span>Launch /video-creator Studio</span>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        <p>Quran Clip Helper Video Creator • Local GPU Hardware Acceleration (RTX 5080)</p>
      </footer>
    </div>
  );
}
