'use client';

import React, { useMemo, useState } from 'react';
import { exportFileName } from '@/lib/exportName';
import { ExportHealth, ExportVerdict, exportVerdict } from '@/lib/exportHealth';
import { Cpu, Film, Download, CheckCircle, AlertTriangle, X, Sparkles, Loader2, Play } from 'lucide-react';
import { detectGpuRenderer, describeEncoder } from '@/lib/gpuInfo';
import { Dialog } from './Dialog';
import { useT } from './LocaleProvider';

// Re-exported so existing importers of this module keep working; the function
// itself lives in `lib` now so it can be tested without mounting React.
export { exportFileName };

interface GpuExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartExport: (
    targetFps: number,
    onComplete: (blob: Blob, renderMs: number, health: ExportHealth) => void
  ) => void;
  isExporting: boolean;
  exportProgress: number;
  exportSpeed: string;
  surahNameEnglish: string;
  surahNumber: number;
  ayahStart: number;
  ayahEnd: number;
  aspectRatio: string;
  onSaveExportRecord: (downloadUrl: string, durationSec: number, renderMs: number) => void;
  /** Length of the clip that will be rendered -- the ayah range, not the whole file. */
  exportSeconds: number;
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
  onSaveExportRecord,
  exportSeconds
}) => {
  const t = useT();
  // Report what this machine actually has rather than a hardcoded model name.
  // The raw renderer string is read directly rather than through `describeGpu`,
  // whose fallback wording is the value written to the `exports` record and is
  // deliberately English there. What is shown here is a label, so it is
  // translated; what is stored stays searchable.
  const renderer = useMemo(() => detectGpuRenderer(), []);
  const gpuName = renderer ?? t.exportModal.gpuNotReported;
  const encoderName = useMemo(() => describeEncoder(), []);

  const [selectedFps, setSelectedFps] = useState<number>(60);
  const [exportedBlobUrl, setExportedBlobUrl] = useState<string | null>(null);
  const [renderedMs, setRenderedMs] = useState<number>(0);
  // Whether the finished file is actually watchable, which is not the same
  // question as whether the export succeeded -- see `exportHealth.ts`.
  const [verdict, setVerdict] = useState<ExportVerdict>('clean');
  const [starvedSeconds, setStarvedSeconds] = useState<number>(0);
  const [downloadFileName, setDownloadFileName] = useState<string>('QuranClip.webm');

  // Clear the previous render whenever the modal is reopened. Without this the
  // result screen from the last export is still mounted, so a second export --
  // after trimming or any other edit -- has no way in and looks blocked. This
  // is the documented "adjust state when a prop changes" pattern: done during
  // render rather than in an effect, so it never paints the stale screen first.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setExportedBlobUrl(null);
  }


  const handleExport = () => {
    setExportedBlobUrl(null);
    setDownloadFileName(exportFileName(surahNameEnglish, surahNumber, ayahStart, ayahEnd));
    onStartExport(selectedFps, (blob, renderMs, health) => {
      const url = URL.createObjectURL(blob);
      setExportedBlobUrl(url);
      setRenderedMs(renderMs);
      setVerdict(exportVerdict(health, selectedFps));
      setStarvedSeconds(health.starvedSeconds);
      // Was hardcoded to 45 seconds, so every saved record claimed the same
      // length regardless of what was rendered.
      onSaveExportRecord(url, exportSeconds, renderMs);
    });
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      label={t.exportModal.dialogLabel}
      // Closing mid-render would orphan the recorder, so the dialog refuses to
      // dismiss while an export is in flight.
      dismissible={!isExporting}
      panelClassName="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl overflow-hidden"
    >
      <div>
        {/* Glow Header */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-amber-500 via-emerald-500 to-amber-500"></div>

        <button
          onClick={onClose}
          disabled={isExporting}
          aria-label={t.common.close}
          className="absolute top-4 end-4 p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="p-3 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
            <Cpu className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              {t.exportModal.title}
            </h3>
            <p className="text-xs text-slate-400">{t.exportModal.subtitle(encoderName)}</p>
          </div>
        </div>

        {!exportedBlobUrl ? (
          <div className="flex flex-col gap-4">
            {/* GPU Device Card */}
            <div className="p-3.5 bg-slate-950 rounded-xl border border-emerald-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></div>
                <div>
                  <span className="text-xs font-semibold text-slate-200 block">{t.exportModal.detectedGpu}</span>
                  {/* Mono only for a real renderer string, which is a literal value.
                      The fallback is a translated sentence, and the mono rule pins
                      those left-to-right. */}
                  <span className={`text-[11px] text-emerald-400 ${renderer ? 'font-mono' : ''}`}>
                    {gpuName}
                  </span>
                </div>
              </div>
              <span className="text-[11px] bg-slate-800 text-slate-300 font-mono px-2 py-1 rounded">
                {encoderName}
              </span>
            </div>

            {/* Export Settings */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">{t.exportModal.frameRateLabel}</label>
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
                    {t.exportModal.fps60}
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
                    {t.exportModal.fps30}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {t.exportModal.resolutionLabel}
                </label>
                <div className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200">
                  {aspectRatio === '16:9'
                    ? t.exportModal.resolutions['16:9']
                    : aspectRatio === '1:1'
                    ? t.exportModal.resolutions['1:1']
                    : aspectRatio === '4:5'
                    ? t.exportModal.resolutions['4:5']
                    : t.exportModal.resolutions['9:16']}
                </div>
              </div>
            </div>

            {/* Render Details Summary */}
            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 text-xs text-slate-300 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">{t.exportModal.clipTitle}</span>
                <span className="font-semibold text-slate-100">
                  {t.projects.passage(surahNameEnglish, surahNumber, ayahStart, ayahEnd)}
                </span>
              </div>
              {/* Stated up front: capture is real-time, so this number is also
                  roughly how long the export will take. */}
              <div className="flex justify-between">
                <span className="text-slate-400">{t.exportModal.clipLength}</span>
                <span className="font-mono text-amber-400" dir="ltr">
                  {Math.floor(exportSeconds / 60)}:{Math.floor(exportSeconds % 60).toString().padStart(2, '0')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">{t.exportModal.aspectFormat}</span>
                <span className="font-mono text-amber-400" dir="ltr">{aspectRatio}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">{t.exportModal.bitrateTarget}</span>
                <span className="text-emerald-400">{t.exportModal.bitrateValue}</span>
              </div>
            </div>

            {/* Render Progress Bar */}
            {isExporting ? (
              <div className="p-4 bg-slate-950 rounded-xl border border-amber-500/30 flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                    <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                    {t.exportModal.encoding}
                  </span>
                  <span className="font-mono text-amber-400 font-bold">{exportProgress}%</span>
                </div>

                <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-amber-500 to-emerald-400 h-full transition-all duration-300 rounded-full"
                    style={{ width: `${exportProgress}%` }}
                  ></div>
                </div>

                <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                  <span>{t.exportModal.speed(exportSpeed)}</span>
                  <span title={t.exportModal.realtimeCaptureTitle}>{t.exportModal.realtimeCapture}</span>
                </div>
              </div>
            ) : (
              <button
                onClick={handleExport}
                className="w-full py-3.5 bg-gradient-to-r from-amber-500 via-amber-600 to-emerald-500 hover:from-amber-600 hover:to-emerald-600 text-slate-950 font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all active:scale-98"
              >
                <Sparkles className="w-5 h-5 text-slate-950 fill-current" />
                <span>{t.exportModal.startRender(selectedFps)}</span>
              </button>
            )}
          </div>
        ) : (
          /* Completed Export View */
          <div className="flex flex-col items-center gap-4 text-center py-2 animate-fade-in">
            <div
              className={`p-4 rounded-full border ${
                verdict === 'clean'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                  : 'bg-amber-500/20 text-amber-400 border-amber-500/40'
              }`}
            >
              {verdict === 'clean' ? <CheckCircle className="w-10 h-10" /> : <AlertTriangle className="w-10 h-10" />}
            </div>

            <div>
              <h4 className="text-lg font-bold text-slate-100">{t.exportModal.complete}</h4>
              <p className="text-xs text-slate-400 mt-1">
                {t.exportModal.renderedIn}{' '}
                <span className="font-mono text-emerald-400" dir="ltr">{Math.round(renderedMs / 100) / 10}s</span>
                {t.exportModal.renderedOn(gpuName)}
              </p>
            </div>

            {/* The export can succeed and still be unwatchable: capture is
                real-time off the canvas, so anything that stopped the canvas
                painting -- a backgrounded tab, a slept display -- leaves the
                picture frozen while the audio plays on. The file gives no sign
                of it, so this has to. */}
            {verdict !== 'clean' && (
              <p className="w-full text-start text-[11px] leading-relaxed text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                {verdict === 'frozen'
                  ? t.exportModal.frozenWarning(Math.round(starvedSeconds))
                  : t.exportModal.choppyWarning}
              </p>
            )}

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
              <span>{t.exportModal.download}</span>
            </a>

            {/* Renders are repeatable -- the previous blob URL is left alive on
                purpose so the saved export record keeps working. */}
            <button
              onClick={() => setExportedBlobUrl(null)}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
            >
              <Film className="w-3.5 h-3.5 text-amber-400" />
              <span>{t.exportModal.renderAnother}</span>
            </button>
          </div>
        )}
      </div>
    </Dialog>
  );
};
