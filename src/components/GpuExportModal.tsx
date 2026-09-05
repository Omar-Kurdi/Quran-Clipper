'use client';

import React, { useMemo, useState } from 'react';
import { exportFileName } from '@/lib/exportName';
import { ExportHealth, ExportVerdict, exportVerdict } from '@/lib/exportHealth';
import { Cpu, Film, Download, CheckCircle, AlertTriangle, X, Sparkles, Loader2, Play } from 'lucide-react';
import { detectGpuRenderer, describeEncoder } from '@/lib/gpuInfo';
import {
  EXPORT_PRESETS, QUALITY_TIERS, QualityTier, ExportPlan,
  planExport, presetForAspect, dimensionsFor, formatBytes, formatBitrate
} from '@/lib/exportPresets';
import { Dialog } from './Dialog';
import { useT } from './LocaleProvider';

// Re-exported so existing importers of this module keep working; the function
// itself lives in `lib` now so it can be tested without mounting React.
export { exportFileName };

interface GpuExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * True when the render will be encoded frame by frame rather than recorded
   * in real time. Worth saying before someone commits to a long render: it is
   * the difference between minutes and seconds, and between MP4 and WebM.
   */
  fastPath: boolean;
  /** Stops a render in progress and discards it. */
  onCancelExport: () => void;
  onStartExport: (
    plan: ExportPlan,
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
  /**
   * Switches the studio to the shape the chosen platform wants.
   *
   * Picking "Reels" has to change the preview too, or the frame being rendered
   * is not the frame that was being looked at. Undo covers it.
   */
  onAspectRatio: (aspectRatio: string) => void;
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
  fastPath,
  onCancelExport,
  surahNameEnglish,
  surahNumber,
  ayahStart,
  ayahEnd,
  aspectRatio,
  onAspectRatio,
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
  const encoderName = useMemo(() => describeEncoder(fastPath), [fastPath]);

  const [selectedFps, setSelectedFps] = useState<number>(60);
  /**
   * Which platform this render is for, and how much of the frame to spend on
   * it. Kept here rather than in the project: the same timeline is exported for
   * Reels on Monday and for YouTube on Friday, and neither is a property of the
   * recitation.
   */
  const [presetId, setPresetId] = useState<string>(() => presetForAspect(aspectRatio).id);
  const [tier, setTier] = useState<QualityTier>('standard');
  const [exportedBlobUrl, setExportedBlobUrl] = useState<string | null>(null);
  const [renderedMs, setRenderedMs] = useState<number>(0);
  // Whether the finished file is actually watchable, which is not the same
  // question as whether the export succeeded -- see `exportHealth.ts`.
  const [verdict, setVerdict] = useState<ExportVerdict>('clean');
  const [starvedSeconds, setStarvedSeconds] = useState<number>(0);
  const [pauses, setPauses] = useState<number>(0);
  const [downloadFileName, setDownloadFileName] = useState<string>('QuranClip.webm');

  // Clear the previous render whenever the modal is reopened. Without this the
  // result screen from the last export is still mounted, so a second export --
  // after trimming or any other edit -- has no way in and looks blocked. This
  // is the documented "adjust state when a prop changes" pattern: done during
  // render rather than in an effect, so it never paints the stale screen first.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setExportedBlobUrl(null);
      // Open on the platform that matches the shape the studio is already set
      // to, so the frame in the preview is the frame being offered.
      setPresetId(presetForAspect(aspectRatio).id);
    }
  }

  /**
   * The render, as numbers.
   *
   * Everything the user chose goes in and one set of dimensions, one bitrate
   * and one honest file-size estimate come out -- including the adjustments
   * made for them, which are shown rather than applied quietly.
   */
  const plan = useMemo(
    () => planExport({ presetId, tier, fps: selectedFps, seconds: exportSeconds }),
    [presetId, tier, selectedFps, exportSeconds]
  );

  /**
   * The recorder captures the on-screen canvas, so it cannot produce a frame
   * larger than the preview. Offering 4K on that path would promise something
   * only the frame-by-frame encoder can deliver.
   */
  const canChooseResolution = fastPath;

  const choosePreset = (id: string) => {
    const preset = EXPORT_PRESETS.find(p => p.id === id);
    if (!preset) return;
    setPresetId(id);
    setSelectedFps(preset.fps);
    if (preset.aspectRatio !== aspectRatio) onAspectRatio(preset.aspectRatio);
  };


  /** Closing mid-render means stopping it, not leaving it running unseen. */
  const handleClose = () => {
    if (isExporting) onCancelExport();
    onClose();
  };

  const handleExport = () => {
    setExportedBlobUrl(null);
    onStartExport(plan, (blob, renderMs, health) => {
      // Named here rather than up front: which container was produced is only
      // known once the export has chosen its path.
      setDownloadFileName(
        exportFileName(surahNameEnglish, surahNumber, ayahStart, ayahEnd, blob.type.includes('mp4') ? 'mp4' : 'webm')
      );
      const url = URL.createObjectURL(blob);
      setExportedBlobUrl(url);
      setRenderedMs(renderMs);
      setVerdict(exportVerdict(health, selectedFps));
      setStarvedSeconds(health.starvedSeconds);
      setPauses(health.pauses);
      // Was hardcoded to 45 seconds, so every saved record claimed the same
      // length regardless of what was rendered.
      onSaveExportRecord(url, exportSeconds, renderMs);
    });
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      label={t.exportModal.dialogLabel}
      // Closing mid-render would orphan the recorder, so the dialog refuses to
      // dismiss while an export is in flight.
      // Dismissible throughout. It used to refuse while rendering, on the
      // grounds that closing would orphan the recorder -- but that left the
      // only visible control inert at exactly the moment someone wants out,
      // with no way to stop a ten-minute render. Closing now cancels it.
      dismissible
      panelClassName="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl overflow-hidden"
    >
      <div>
        {/* Glow Header */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-amber-500 via-emerald-500 to-amber-500"></div>

        <button
          onClick={handleClose}
          aria-label={isExporting ? t.exportModal.cancelRender : t.common.close}
          title={isExporting ? t.exportModal.cancelRender : t.common.close}
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
            <p className="text-xs text-slate-400">
              {fastPath
                ? t.exportModal.subtitle(encoderName)
                : t.exportModal.subtitleRecorder(encoderName)}
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

            {/* Where it is going.

                First, because it decides the other three: shape, resolution
                and bitrate all follow from the platform, and choosing them one
                by one is how an export ends up 16:9 for Reels. */}
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">{t.exportModal.presetLabel}</label>
              <div className="grid grid-cols-3 gap-1.5">
                {EXPORT_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => choosePreset(preset.id)}
                    disabled={isExporting}
                    title={
                      preset.maxSeconds
                        ? `${preset.aspectRatio} · ${t.exportModal.presetLimit(preset.maxSeconds)}`
                        : `${preset.aspectRatio} · ${t.exportModal.presetNoLimit}`
                    }
                    className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors text-start leading-tight ${
                      presetId === preset.id
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'
                    }`}
                  >
                    <span className="block truncate">{t.exportModal.presets[preset.id as keyof typeof t.exportModal.presets]}</span>
                    <span className={`block font-mono text-[10px] ${presetId === preset.id ? 'text-slate-900' : 'text-slate-500'}`} dir="ltr">
                      {preset.aspectRatio}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{t.exportModal.presetHelp}</p>
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
                  {t.exportModal.qualityLabel}
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {QUALITY_TIERS.map(option => {
                    const size = dimensionsFor(plan.aspectRatio, option);
                    const allowed = canChooseResolution || option === 'standard';
                    return (
                      <button
                        key={option}
                        onClick={() => setTier(option)}
                        disabled={isExporting || !allowed}
                        title={allowed ? `${size.width}×${size.height}` : t.exportModal.recorderOnly}
                        className={`py-2 px-1 rounded-lg text-[11px] font-bold transition-all border ${
                          tier === option && allowed
                            ? 'bg-amber-500 text-slate-950 border-amber-400'
                            : 'bg-slate-950 text-slate-400 border-slate-800'
                        } ${allowed ? '' : 'opacity-40 cursor-not-allowed'}`}
                      >
                        {t.exportModal.qualityNames[option]}
                      </button>
                    );
                  })}
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
                <span className="text-slate-400">{t.exportModal.resolutionLabel}</span>
                <span className="font-mono text-amber-400" dir="ltr">
                  {plan.width}×{plan.height}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">{t.exportModal.bitrateTarget}</span>
                <span className="font-mono text-emerald-400" dir="ltr">{formatBitrate(plan.bitrate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">{t.exportModal.estimatedSize}</span>
                <span className="font-mono text-slate-200" dir="ltr">{formatBytes(plan.estimatedBytes)}</span>
              </div>
            </div>

            {/* Everything the plan had to change, and everything the platform
                will not accept. Said before the render, which is the only time
                it can still be acted on. */}
            {(plan.steppedDownFrom || plan.bitrateReduced || plan.exceedsMemory || plan.overLongBy || !canChooseResolution) && (
              <ul className="flex flex-col gap-1.5 text-[11px] leading-relaxed">
                {plan.steppedDownFrom && (
                  <li className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200">
                    {t.exportModal.steppedDown(
                      t.exportModal.qualityNames[plan.steppedDownFrom],
                      t.exportModal.qualityNames[plan.tier]
                    )}
                  </li>
                )}
                {plan.bitrateReduced && !plan.exceedsMemory && (
                  <li className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-300">
                    {t.exportModal.bitrateReduced}
                  </li>
                )}
                {plan.exceedsMemory && (
                  <li className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-200">
                    {t.exportModal.exceedsMemory}
                  </li>
                )}
                {plan.overLongBy && (
                  <li className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200">
                    {t.exportModal.overLong(
                      t.exportModal.presets[plan.presetId as keyof typeof t.exportModal.presets],
                      plan.overLongBy
                    )}
                  </li>
                )}
                {!canChooseResolution && (
                  <li className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-400">
                    {t.exportModal.recorderOnly}
                  </li>
                )}
              </ul>
            )}

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

                {/* Kept in front of the person for the whole render, because
                    the consequence of switching away is invisible until it is
                    too late to undo. Switching away no longer damages the file
                    -- the recording holds and resumes -- but it does stretch a
                    two-minute clip into however long the detour took, which is
                    reason enough to say so while it matters. */}
                <div className={`mt-2 items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 ${fastPath ? 'hidden' : 'flex'}`}>
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                  </span>
                  <span className="text-[11px] font-bold text-amber-300">{t.exportModal.doNotSwitch}</span>
                </div>
              </div>
            ) : (
              <>
              {/* Said before it costs anything, so it is a known rule rather
                  than a surprise afterwards. */}
              {fastPath ? (
                <p className="mb-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-200">
                  <strong>{t.exportModal.fastPathTitle}</strong> {t.exportModal.fastPathBody}
                </p>
              ) : (
                <p className="mb-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
                  <strong className="text-amber-300">{t.exportModal.keepTabOpenTitle}</strong>{' '}
                  {t.exportModal.keepTabOpenBody}
                </p>
              )}
              <button
                onClick={handleExport}
                className="w-full py-3.5 bg-gradient-to-r from-amber-500 via-amber-600 to-emerald-500 hover:from-amber-600 hover:to-emerald-600 text-slate-950 font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all active:scale-98"
              >
                <Sparkles className="w-5 h-5 text-slate-950 fill-current" />
                <span>{t.exportModal.startRender(selectedFps)}</span>
              </button>
              </>
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
            {pauses > 0 && (
              <p className="w-full text-start text-[11px] leading-relaxed text-slate-300 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2">
                {t.exportModal.pausedNotice(pauses)}
              </p>
            )}

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
              {/* The container is only known once the render has chosen its
                   path, so the label follows the file rather than promising
                   WebM for a render that produced MP4. */}
              <span>{t.exportModal.download(downloadFileName.endsWith('.mp4') ? 'MP4' : 'WebM')}</span>
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
