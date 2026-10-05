'use client';

import React, { useMemo, useState } from 'react';
import { exportFileName } from '@/lib/exportName';
import { ExportHealth, ExportVerdict, exportVerdict } from '@/lib/exportHealth';
import { AlertTriangle, X, Loader2, Eye } from 'lucide-react';
import { detectGpuRenderer, describeEncoder } from '@/lib/gpuInfo';
import {
  QUALITY_TIERS, QualityTier, ExportPlan,
  planExport, presetById, dimensionsFor, formatBytes, previewPlan
} from '@/lib/exportPresets';
import { exportRoute } from '@/lib/exportRoute';
import { DestinationPicker, Segmented } from './ExportChoices';
import { Dialog } from './Dialog';
import { ExportResult } from './ExportResult';
import { StudioVideo } from './StudioVideo';
import { buildPublishMetadata, captionFileText, PublishInput } from '@/lib/publishMetadata';
import { creditedTranslationNames } from '@/lib/translations';
import { loadTranslationCatalogue } from '@/lib/translationCatalogue';
import { useT } from './LocaleProvider';
import { FrameSkeleton } from './Skeleton';
import { ExportQueuePanel } from './ExportQueuePanel';
import { useExportQueue } from '@/hooks/useExportQueue';
import { ServerRendersPanel } from './ServerRendersPanel';
import { ExportWarnings, type ExportLane } from './ExportWarnings';
import type { RenderCheckInput } from '@/lib/renderCheckRunner';
import { useServerRenders } from '@/hooks/useServerRenders';

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
  /** The platform the frame is shaped for (see `framePreset`), which the dialog opens on. */
  framePresetId: string;
  /**
   * Switches the studio to the shape the chosen platform wants.
   *
   * Picking "Reels" has to change the preview too, or the frame being rendered
   * is not the frame that was being looked at. Undo covers it.
   */
  onAspectRatio: (aspectRatio: string) => void;
  /**
    * The note that this render happened. A name and a size rather than a link:
    * the blob url this used to pass is scoped to the document, so the record
    * pointed at nothing the moment the page reloaded.
    */
  onSaveExportRecord: (record: { fileName: string; fileSizeBytes: number; durationSec: number; renderMs: number }) => void;
  /** Length of the clip that will be rendered -- the ayah range, not the whole file. */
  exportSeconds: number;
  /**
   * What the finished clip is, for the caption offered beside the download.
   *
   * Everything except whether to include the ayah text, which is the one part
   * the panel itself owns -- it is a choice about the post, not about the
   * project.
   */
  publish: Omit<PublishInput, 'includeVerseText' | 'translationNames'>;
  /** Which translations are on screen, for the caption's credit line. */
  translationIds: string[];
  /**
   * Renders a small, quick version of the whole clip to look at first.
   *
   * Resolves to `null` when it produced nothing -- cancelled, or an encoder
   * that refused. Only offered on the frame-by-frame path: a real-time
   * "preview" would take as long as watching the clip.
   */
  onRenderPreview: (output: { width: number; height: number; fps: number; bitrate: number }) => Promise<Blob | null>;
  isPreviewing: boolean;
  previewProgress: number;
  /**
   * Everything a server render needs, gathered from the studio: the project,
   * the recording and any uploaded backgrounds. See `lib/serverRender.ts`.
   */
  buildServerRender: (plan: ExportPlan) => Promise<FormData>;
  /** The background lane over the render's range, for what to warn about first. */
  exportLane: ExportLane;
  /** What the finished file is checked against, on request. */
  renderCheck: RenderCheckInput;
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
  framePresetId,
  onAspectRatio,
  onSaveExportRecord,
  publish,
  translationIds,
  onRenderPreview,
  isPreviewing,
  previewProgress,
  exportSeconds,
  buildServerRender,
  exportLane,
  renderCheck
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

  // The platform's own frame rate, as choosing it would set: opening on Shorts
  // with 60 fps selected was not what clicking Shorts gives.
  const [selectedFps, setSelectedFps] = useState<number>(() => presetById(framePresetId).fps);
  /**
   * Which platforms to render for -- one render each. Kept here rather than in
   * the project: the same timeline is exported for Reels on Monday and for
   * YouTube on Friday, and neither is a property of the recitation.
   */
  const [destinations, setDestinations] = useState<string[]>(() => [framePresetId]);
  /** Whether to hand the renders to the studio's server, so the tab can be closed. */
  const [onServer, setOnServer] = useState(false);
  const [tier, setTier] = useState<QualityTier>('standard');
  const [exportedBlobUrl, setExportedBlobUrl] = useState<string | null>(null);
  /** The file itself, for the render check to read back. */
  const [exportedBlob, setExportedBlob] = useState<Blob | null>(null);
  const [renderedMs, setRenderedMs] = useState<number>(0);
  // Whether the finished file is actually watchable, which is not the same
  // question as whether the export succeeded -- see `exportHealth.ts`.
  const [verdict, setVerdict] = useState<ExportVerdict>('clean');
  const [starvedSeconds, setStarvedSeconds] = useState<number>(0);
  const [pauses, setPauses] = useState<number>(0);
  const [downloadFileName, setDownloadFileName] = useState<string>('QuranClipper.webm');
  /**
   * The throwaway preview, if one has been made.
   *
   * Revoked whenever it is replaced or dismissed, unlike the export's own blob
   * url, which is deliberately left alive. Nothing refers back to a preview --
   * it is not downloaded, not recorded, and not the file anyone keeps.
   */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  /**
   * Kept here rather than in the caption panel, which unmounts whenever the
   * result screen does -- so rendering again would quietly forget it.
   */
  const [captionIncludesText, setCaptionIncludesText] = useState(false);

  /** One file, by the same anchor click the plain download button is. */
  const save = (href: string, name: string) => {
    const link = document.createElement('a');
    link.href = href;
    link.download = name;
    link.click();
  };

  /** Set while the caption is being fetched and written, so the button can say so. */
  const [savingCaption, setSavingCaption] = useState(false);

  /**
   * The video and its caption, from one click.
   *
   * Two files rather than one, because the caption is text and the video is
   * not, and the next thing that happens to both is an upload form that wants
   * them separately. They share a stem so the pair stays obvious in a downloads
   * folder holding a dozen renders -- the container is stripped rather than
   * assumed, since a fallback render writes `.webm`.
   *
   * The catalogue is fetched here rather than held in state: this is the same
   * "about to be published" moment that justifies the caption panel fetching it
   * on open, and going to the network on a click nobody made would put the
   * studio's startup back on it. `loadTranslationCatalogue` serves the cache
   * after the first call, so opening the panel first costs nothing here.
   *
   * The text goes first. Browsers meter downloads that a single gesture starts,
   * and the small one is the one that suffers if the second is held back -- and
   * if the browser does ask to allow multiple downloads, the video is the file
   * whose prompt is obviously worth answering.
   */
  /** The caption as posted, with the translators credited by name -- see `downloadWithCaption`. */
  const buildCaption = async () => {
    const catalogue = await loadTranslationCatalogue();
    return buildPublishMetadata({
      ...publish,
      translationNames: creditedTranslationNames(
        catalogue, translationIds, publish.verses, publish.wordByWord
      ),
      includeVerseText: captionIncludesText
    });
  };

  const downloadWithCaption = async () => {
    if (!exportedBlobUrl || savingCaption) return;
    setSavingCaption(true);
    try {
      const meta = await buildCaption();
      const caption = URL.createObjectURL(
        new Blob([captionFileText(meta)], { type: 'text/plain;charset=utf-8' })
      );
      save(caption, `${downloadFileName.replace(/\.[^./]+$/, '')}.txt`);
      // Revoking straight away cancels a download the browser has not started
      // reading yet; the URL is dropped once it plainly has.
      window.setTimeout(() => URL.revokeObjectURL(caption), 10_000);
      save(exportedBlobUrl, downloadFileName);
    } finally {
      setSavingCaption(false);
    }
  };

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
      setExportedBlob(null);
      setPreviewUrl(current => { if (current) URL.revokeObjectURL(current); return null; });
      setPreviewFailed(false);
      // Open on the platform the frame is shaped for, so the frame in the
      // preview is the frame being offered.
      setDestinations([framePresetId]);
      setSelectedFps(presetById(framePresetId).fps);
      setTier('standard');
    }
  }

  /**
   * The render, as numbers.
   *
   * Everything the user chose goes in and one set of dimensions, one bitrate
   * and one honest file-size estimate come out -- including the adjustments
   * made for them, which are shown rather than applied quietly.
   */
  const plans = useMemo(
    () => destinations.map(presetId => planExport({ presetId, tier, fps: selectedFps, seconds: exportSeconds })),
    [destinations, tier, selectedFps, exportSeconds]
  );
  /** The render in the studio's own shape: what a preview shows. */
  const plan = useMemo(
    () => planExport({ presetId: framePresetId, tier, fps: selectedFps, seconds: exportSeconds }),
    [framePresetId, tier, selectedFps, exportSeconds]
  );

  /**
   * The recorder captures the on-screen canvas, so it cannot produce a frame
   * larger than the preview. Offering 4K on that path would promise something
   * only the frame-by-frame encoder can deliver.
   */
  const canChooseResolution = fastPath;

  const toggleDestination = (id: string) =>
    setDestinations(current => (current.includes(id) ? current.filter(d => d !== id) : [...current, id]));


  /**
   * Several renders in a row -- one per platform, usually. Runs through the
   * same `onStartExport` as a single render; see `useExportQueue`.
   */
  const queue = useExportQueue({
    aspectRatio,
    onAspectRatio,
    onStartExport,
    onCancelExport,
    isExporting,
    exportProgress,
    exportSeconds,
    fileNameFor: blob =>
      exportFileName(surahNameEnglish, surahNumber, ayahStart, ayahEnd, blob.type.includes('mp4') ? 'mp4' : 'webm'),
    onSaveExportRecord
  });
  const server = useServerRenders(isOpen);
  const describeJob = (job: { presetId: string; tier: QualityTier; fps: number }) =>
    `${t.exportModal.presets[job.presetId as keyof typeof t.exportModal.presets] ?? job.presetId} · ` +
    `${t.exportModal.qualityNames[job.tier]} · ${job.fps}fps`;

  /** Closing mid-render means stopping it, not leaving it running unseen. */
  const handleClose = () => {
    if (queue.running) queue.cancel();
    else if (isExporting) onCancelExport();
    onClose();
  };

  const dropPreview = () => {
    setPreviewUrl(current => { if (current) URL.revokeObjectURL(current); return null; });
    setPreviewFailed(false);
  };

  const handlePreview = async () => {
    dropPreview();
    const blob = await onRenderPreview(previewPlan(plan));
    if (!blob) { setPreviewFailed(true); return; }
    setPreviewUrl(URL.createObjectURL(blob));
  };

  const handleExport = (plan: ExportPlan) => {
    setExportedBlobUrl(null);
    setExportedBlob(null);
    onStartExport(plan, (blob, renderMs, health) => {
      // Named here rather than up front: which container was produced is only
      // known once the export has chosen its path.
      // Named into a local first: the record needs the same string this
      // renders, and the state set below is not readable until the next render.
      const fileName = exportFileName(
        surahNameEnglish, surahNumber, ayahStart, ayahEnd, blob.type.includes('mp4') ? 'mp4' : 'webm'
      );
      setDownloadFileName(fileName);
      const url = URL.createObjectURL(blob);
      setExportedBlob(blob);
      setExportedBlobUrl(url);
      setRenderedMs(renderMs);
      setVerdict(exportVerdict(health, selectedFps));
      setStarvedSeconds(health.starvedSeconds);
      setPauses(health.pauses);
      // Was hardcoded to 45 seconds, so every saved record claimed the same
      // length regardless of what was rendered.
      onSaveExportRecord({ fileName, fileSizeBytes: blob.size, durationSec: exportSeconds, renderMs });
    });
  };

  /** One render straight away, several through the queue, or all to the server -- see `exportRoute`. */
  const serverReady = server.available && fastPath;
  /** While anything renders, the choices it was started with stay as they are. */
  const busy = isExporting || queue.running;
  const render = async () => {
    const route = exportRoute(plans.map(p => p.aspectRatio), aspectRatio, onServer && serverReady);
    if (route === 'single') return handleExport(plans[0]);
    if (route === 'queue') return queue.runAll(destinations.map(presetId => ({ presetId, tier, fps: selectedFps })));
    // One after another, on purpose: each send uploads the whole recording,
    // and the server lists its renders in the order they arrive.
    await plans.reduce<Promise<void>>(
      (sent, each) => sent.then(() => server.send(() => buildServerRender(each))),
      Promise.resolve()
    );
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
        <button
          onClick={handleClose}
          aria-label={isExporting ? t.exportModal.cancelRender : t.common.close}
          title={isExporting ? t.exportModal.cancelRender : t.common.close}
          className="absolute top-4 end-4 p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-5 pe-10">
          <h3 className="text-xl font-bold text-slate-100">{t.exportModal.title}</h3>
          <p className="text-[13px] text-slate-400">
            {t.projects.passage(surahNameEnglish, surahNumber, ayahStart, ayahEnd)}
            {' · '}
            <span className="font-mono" dir="ltr">
              {Math.floor(exportSeconds / 60)}:{Math.floor(exportSeconds % 60).toString().padStart(2, '0')}
            </span>
          </p>
        </div>

        {!(exportedBlobUrl && exportedBlob) ? (
          <div className="flex flex-col gap-5">
            {/* Where it is going, first: it decides the shape, the resolution
                and the bitrate of each render. Several can be ticked -- one
                render each -- which is what a queue of platform renders was
                for, without having to learn that a queue exists. */}
            <DestinationPicker
              selected={destinations}
              onToggle={toggleDestination}
              studioAspect={aspectRatio}
              plans={Object.fromEntries(plans.map(p => [p.presetId, p]))}
              disabled={busy}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Segmented
                legend={t.exportModal.qualityLabel}
                name="export-quality"
                value={tier}
                onChange={setTier}
                disabled={busy}
                options={QUALITY_TIERS.map(option => {
                  // The recorder captures the on-screen canvas, so it cannot
                  // produce a frame larger than the preview.
                  const allowed = canChooseResolution || option === 'standard';
                  const size = dimensionsFor(plan.aspectRatio, option);
                  return {
                    value: option,
                    label: t.exportModal.qualityNames[option],
                    disabled: !allowed,
                    title: allowed ? `${size.width}×${size.height}` : t.exportModal.recorderOnly
                  };
                })}
              />
              <Segmented
                legend={t.exportModal.frameRateLabel}
                name="export-fps"
                value={selectedFps}
                onChange={setSelectedFps}
                disabled={busy}
                options={[30, 60].map(fps => ({ value: fps, label: t.exportModal.fpsValue(fps) }))}
              />
            </div>

            {/* The renders as numbers, in one line: how many, how big, how
                heavy. Stated up front, since the recorder's capture is real
                time and this is also roughly how long it takes. */}
            <p className="rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-[13px] text-slate-300">
              {plans.length === 0 ? t.exportModal.noDestination : (
                <>
                  <span className="font-semibold text-slate-100">{t.exportModal.videos(plans.length)}</span>
                  {' · '}
                  <span className="font-mono text-slate-400" dir="ltr">{[...new Set(plans.map(p => `${p.width}×${p.height}`))].join(', ')}</span>
                  {' · '}
                  <span className="text-slate-400">{t.exportModal.fpsValue(selectedFps)}</span>
                  {' · '}
                  <span className="font-mono text-slate-400" dir="ltr">≈ {formatBytes(plans.reduce((sum, p) => sum + p.estimatedBytes, 0))}</span>
                </>
              )}
            </p>

            {/* Everything a plan had to change, and everything a platform
                will not accept. Said before the render, which is the only time
                it can still be acted on. */}
            <PlanNotes plans={plans} recorderOnly={!canChooseResolution} />

            <ServerRendersPanel jobs={server.jobs} onDiscard={id => void server.discard(id)} />

            <ExportQueuePanel
              jobs={queue.jobs}
              running={queue.running}
              describe={describeJob}
              onRun={queue.run}
              onCancel={queue.cancel}
              onRemove={queue.remove}
              onMove={queue.move}
              onClearFinished={queue.clearFinished}
            />

            {/* Render Progress Bar. A running queue shows its own, per job. */}
            {queue.running ? null : isExporting ? (
              <div className="p-4 bg-slate-950 rounded-xl border border-amber-500/30 flex flex-col gap-2">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                    <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                    {t.exportModal.encoding}
                  </span>
                  <span className="font-mono text-amber-400 font-bold">{exportProgress}%</span>
                </div>

                <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="bg-amber-500 h-full transition-all duration-300 rounded-full"
                    style={{ width: `${exportProgress}%` }}
                  ></div>
                </div>

                <div className="flex justify-between text-xs text-slate-400 mt-1">
                  <span>{t.exportModal.speed(exportSpeed)}</span>
                  {/* Only when it is true: frame-by-frame renders are the
                      opposite of real-time capture. */}
                  {!fastPath && (
                    <span title={t.exportModal.realtimeCaptureTitle}>{t.exportModal.realtimeCapture}</span>
                  )}
                </div>

                {/* Kept in front of the person for the whole render, because
                    the consequence of switching away is invisible until it is
                    too late to undo. Switching away no longer damages the file
                    -- the recording holds and resumes -- but it does stretch a
                    two-minute clip into however long the detour took. */}
                <div className={`mt-2 items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 ${fastPath ? 'hidden' : 'flex'}`}>
                  <span className="relative inline-flex h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  <span className="text-xs font-bold text-amber-300">{t.exportModal.doNotSwitch}</span>
                </div>
              </div>
            ) : (
              <>
              {/* What the exporter cannot check for you, said where the render
                  is actually started. */}
              <p className="flex items-start gap-2.5 text-xs leading-relaxed text-amber-100">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-300 mt-0.5" aria-hidden="true" />
                <span>
                  <strong className="text-amber-200">{t.exportModal.beforeYouPublish}</strong>{' '}
                  {t.exportModal.beforeYouPublishBody}
                </span>
              </p>
              {/* Said before it costs anything, so it is a known rule rather
                  than a surprise afterwards. */}
              {!fastPath && (
                <p className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs leading-relaxed text-slate-300">
                  <strong className="text-amber-300">{t.exportModal.keepTabOpenTitle}</strong>{' '}
                  {t.exportModal.keepTabOpenBody}
                </p>
              )}
              {/* Offered only where it can be quick. On the recorder there is
                  no such thing as a fast preview -- it captures in real time,
                  so watching the clip and previewing it cost the same. */}
              {fastPath && (isPreviewing || previewUrl) && (
                isPreviewing ? (
                  <FrameSkeleton aspect={plan.aspectRatio} label={t.exportModal.previewRendering(previewProgress)} />
                ) : (
                  <div className="rounded-lg border border-slate-700 bg-slate-950 p-2">
                    <StudioVideo
                      src={previewUrl ?? undefined}
                      controls
                      autoPlay
                      className="w-full max-h-64 rounded-md bg-black object-contain"
                    />
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-400">
                        {t.exportModal.previewNote(previewPlan(plan).width, previewPlan(plan).height)}
                      </span>
                      <button
                        onClick={dropPreview}
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-slate-300 hover:text-slate-100 hover:bg-slate-800"
                      >
                        {t.exportModal.previewClear}
                      </button>
                    </div>
                  </div>
                )
              )}
              {previewFailed && (
                <p role="status" className="text-xs text-amber-300/90">{t.exportModal.previewFailed}</p>
              )}

              <div className="empty:hidden">
                <ExportWarnings lane={exportLane} offline={fastPath} />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {fastPath && !previewUrl && (
                  <button
                    onClick={handlePreview}
                    disabled={isPreviewing}
                    className="h-11 px-4 rounded-xl border border-slate-700 text-[13px] font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-60 flex items-center gap-1.5"
                  >
                    <Eye className="w-4 h-4 text-amber-400" />
                    {t.exportModal.previewButton}
                  </button>
                )}
                {serverReady && (
                  <label className="flex items-center gap-2 text-[13px] text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={onServer} onChange={e => setOnServer(e.target.checked)} className="w-4 h-4 accent-amber-500" />
                    {t.exportModal.renderOnServer}
                  </label>
                )}
                <button
                  onClick={() => void render()}
                  disabled={plans.length === 0 || server.sending}
                  title={plans.length === 0 ? t.exportModal.noDestination : undefined}
                  className="ms-auto h-11 px-5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 text-[15px] font-bold transition-colors"
                >
                  {server.sending ? t.serverRender.sending : t.exportModal.renderVideos(plans.length)}
                </button>
              </div>
              {server.error && (
                <p role="alert" className="text-xs text-red-300">{t.serverRender.sendFailed(server.error)}</p>
              )}
              </>
            )}

            {/* What will do the encoding, for when something goes wrong: a
                diagnosis, not a decision, so it is folded away. */}
            <details className="text-xs text-slate-400">
              <summary className="cursor-pointer select-none hover:text-slate-200">
                {fastPath ? t.exportModal.subtitle(encoderName) : t.exportModal.subtitleRecorder(encoderName)}
              </summary>
              <p className="mt-1.5">
                {t.exportModal.detectedGpu}: <span className={renderer ? 'font-mono' : ''}>{gpuName}</span>
              </p>
            </details>
          </div>
        ) : (
          /* Completed Export View */
          <ExportResult
            blob={exportedBlob}
            blobUrl={exportedBlobUrl}
            fileName={downloadFileName}
            renderedMs={renderedMs}
            gpuName={gpuName}
            verdict={verdict}
            starvedSeconds={starvedSeconds}
            pauses={pauses}
            renderCheck={renderCheck}
            publish={publish}
            translationIds={translationIds}
            captionIncludesText={captionIncludesText}
            onCaptionIncludesText={setCaptionIncludesText}
            presetIds={destinations}
            caption={buildCaption}
            savingCaption={savingCaption}
            onDownloadWithCaption={downloadWithCaption}
            // Renders are repeatable -- the previous blob URL is left alive on
            // purpose so the saved export record keeps working.
            onRenderAnother={() => { setExportedBlobUrl(null); setExportedBlob(null); }}
            onDone={handleClose}
          />
        )}
      </div>
    </Dialog>
  );
};

/**
 * What the plans had to change, and what a platform will not take, once each:
 * several destinations can share a note.
 */
const PlanNotes: React.FC<{ plans: ExportPlan[]; recorderOnly: boolean }> = ({ plans, recorderOnly }) => {
  const t = useT();
  const notes = new Map<string, 'warn' | 'error' | 'info'>();
  for (const plan of plans) {
    if (plan.steppedDownFrom) {
      notes.set(t.exportModal.steppedDown(t.exportModal.qualityNames[plan.steppedDownFrom], t.exportModal.qualityNames[plan.tier]), 'warn');
    }
    if (plan.bitrateReduced && !plan.exceedsMemory) notes.set(t.exportModal.bitrateReduced, 'info');
    if (plan.exceedsMemory) notes.set(t.exportModal.exceedsMemory, 'error');
    if (plan.overLongBy) {
      notes.set(t.exportModal.overLong(t.exportModal.presets[plan.presetId as keyof typeof t.exportModal.presets], plan.overLongBy), 'warn');
    }
  }
  if (recorderOnly) notes.set(t.exportModal.recorderOnly, 'info');
  if (notes.size === 0) return null;
  const tone = { warn: 'border-amber-500/40 bg-amber-500/10 text-amber-200', error: 'border-red-500/40 bg-red-500/10 text-red-200', info: 'border-slate-700 bg-slate-950 text-slate-300' };
  return (
    <ul className="flex flex-col gap-1.5 text-xs leading-relaxed">
      {[...notes].map(([text, kind]) => (
        <li key={text} className={`rounded-lg border px-3 py-2 ${tone[kind]}`}>{text}</li>
      ))}
    </ul>
  );
};
