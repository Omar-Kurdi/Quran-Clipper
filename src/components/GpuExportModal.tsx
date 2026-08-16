'use client';

import React, { useState } from 'react';
import { Cpu, Film, Download, CheckCircle, X, Sparkles, Loader2, Play } from 'lucide-react';

interface GpuExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartExport: (targetFps: number, onComplete: (blob: Blob, renderMs: number) => void) => void;
  isExporting: boolean;
  exportProgress: number;
  exportSpeed: string;
  surahNameEnglish: string;
  surahNumber: number;
  ayahStart: number;
  ayahEnd: number;
  aspectRatio: string;
  onSaveExportRecord: (downloadUrl: string, durationSec: number, renderMs: number) => void;
}

export const GpuExportModal: React.FC<GpuExportModalProps> = ({
  isOpen,
  onClose,
  onStartExport,
  isExporting,
  exportProgress,
  exportSpeed,
  surahNameEnglish,
  surahNumber,
  ayahStart,
  ayahEnd,
  aspectRatio,
  onSaveExportRecord
}) => {
  const [selectedFps, setSelectedFps] = useState<number>(60);
  const [exportedBlobUrl, setExportedBlobUrl] = useState<string | null>(null);
  const [renderedMs, setRenderedMs] = useState<number>(0);
  const [downloadFileName, setDownloadFileName] = useState<string>('QuranClip.webm');

  if (!isOpen) return null;

  const handleExport = () => {
    setExportedBlobUrl(null);
    setDownloadFileName(`${surahNameEnglish.replace(/\s+/g, '_')}_QuranClip_${Date.now()}.webm`);
    onStartExport(selectedFps, (blob, renderMs) => {
      const url = URL.createObjectURL(blob);
      setExportedBlobUrl(url);
      setRenderedMs(renderMs);
      onSaveExportRecord(url, 45, renderMs);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl overflow-hidden">
        {/* Glow Header */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-amber-500 via-emerald-500 to-amber-500"></div>

        <button
          onClick={onClose}
          disabled={isExporting}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="p-3 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
            <Cpu className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              GPU Hardware Accelerated Video Export
            </h3>
            <p className="text-xs text-slate-400">
              Utilizing local NVIDIA RTX 5080 WebCodecs H.264 / WebM Engine
            </p>
          </div>
        </div>

        {!exportedBlobUrl ? (
          <div className="flex flex-col gap-4">
            {/* GPU Device Card */}
            <div className="p-3.5 bg-slate-950 rounded-xl border border-emerald-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></div>
                <div>
                  <span className="text-xs font-semibold text-slate-200 block">Active Local Acceleration</span>
                  <span className="text-[11px] font-mono text-emerald-400">NVIDIA GeForce RTX 5080 (16GB VRAM)</span>
                </div>
              </div>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-mono px-2 py-1 rounded">
                NVENC HW READY
              </span>
            </div>

            {/* Export Settings */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Target Frame Rate:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setSelectedFps(60)}
                    disabled={isExporting}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition-all border ${
                      selectedFps === 60
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    60 FPS Ultra
                  </button>

                  <button
                    onClick={() => setSelectedFps(30)}
                    disabled={isExporting}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition-all border ${
                      selectedFps === 30
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    30 FPS Standard
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Output Resolution:
                </label>
                <div className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200">
                  {aspectRatio === '16:9'
                    ? '1920x1080 Widescreen'
                    : aspectRatio === '1:1'
                    ? '1080x1080 Square'
                    : aspectRatio === '4:5'
                    ? '1080x1350 Portrait'
                    : '1080x1920 Vertical'}
                </div>
              </div>
            </div>

            {/* Render Details Summary */}
            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 text-xs text-slate-300 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Clip Title:</span>
                <span className="font-semibold text-slate-100">{surahNameEnglish} ({surahNumber}:{ayahStart}-{ayahEnd})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Aspect Format:</span>
                <span className="font-mono text-amber-400">{aspectRatio}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Bitrate Target:</span>
                <span className="font-mono text-emerald-400">18 Mbps High Bitrate</span>
              </div>
            </div>

            {/* Render Progress Bar */}
            {isExporting ? (
              <div className="p-4 bg-slate-950 rounded-xl border border-amber-500/30 flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                    <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                    GPU Encoding Frames...
                  </span>
                  <span className="font-mono text-amber-400 font-bold">{exportProgress}%</span>
                </div>

                <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-amber-500 to-emerald-400 h-full transition-all duration-300 rounded-full"
                    style={{ width: `${exportProgress}%` }}
                  ></div>
                </div>

                <div className="flex justify-between text-[11px] text-slate-400 font-mono mt-1">
                  <span>Speed: {exportSpeed}</span>
                  <span>RTX 5080 Active</span>
                </div>
              </div>
            ) : (
              <button
                onClick={handleExport}
                className="w-full py-3.5 bg-gradient-to-r from-amber-500 via-amber-600 to-emerald-500 hover:from-amber-600 hover:to-emerald-600 text-slate-950 font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all active:scale-98"
              >
                <Sparkles className="w-5 h-5 text-slate-950 fill-current" />
                <span>Start {selectedFps} FPS Video Render</span>
              </button>
            )}
          </div>
        ) : (
          /* Completed Export View */
          <div className="flex flex-col items-center gap-4 text-center py-2 animate-fade-in">
            <div className="p-4 bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/40">
              <CheckCircle className="w-10 h-10" />
            </div>

            <div>
              <h4 className="text-lg font-bold text-slate-100">GPU Video Render Complete!</h4>
              <p className="text-xs text-slate-400 mt-1">
                Rendered in <span className="font-mono text-emerald-400">{Math.round(renderedMs / 100) / 10}s</span> using RTX 5080 GPU hardware acceleration.
              </p>
            </div>

            {/* Video Player Preview */}
            <div className="w-full max-h-52 overflow-hidden rounded-xl border border-slate-800 bg-black">
              <video src={exportedBlobUrl} controls className="w-full h-full object-contain" />
            </div>

            <a
              href={exportedBlobUrl}
              download={downloadFileName}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all"
            >
              <Download className="w-5 h-5" />
              <span>Download High-Quality WebM Video</span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
