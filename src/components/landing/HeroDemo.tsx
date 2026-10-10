'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { FALLBACK_ARABIC_FAMILY, qpcPageFamily, qpcPageUrl } from '@/lib/mushafFonts';
import { DEMO_AUDIO_URL, DEMO_CAPTIONS, DEMO_LENGTH, DEMO_PAGE, DEMO_WAVEFORM, captionAt, type DemoCaption } from './demoPassage';
import type { LandingCopy } from './landingCopy';

/** Where a still page holds the demo: mid-way through the first ayah. */
const STILL_AT = 3.9;
const TICKS = [0, 5, 10, 15, 20];
/** Where Listen stops: just after the last captioned word, not on into the rest of the surah. */
const LISTEN_UNTIL = DEMO_CAPTIONS[DEMO_CAPTIONS.length - 1].end + 0.3;
/** Unicode Arabic for when the page font is not installed: the studio's own fallback face, then Amiri. */
const TEXT_FACE = `'${FALLBACK_ARABIC_FAMILY}', 'Amiri', serif`;

/**
 * The page's thesis, running: a vertical clip whose caption follows the
 * recitation word by word, over the studio's own timeline for it.
 *
 * Silent, it plays itself on the published word times. "Listen" plays the
 * recording, and then the recording is the clock -- what lights up is what is
 * heard. With reduced motion asked for, it holds one frame until Listen.
 */
export function HeroDemo({ copy }: { copy: LandingCopy['hero'] }) {
  const [t, setT] = useState(STILL_AT);
  const [listening, setListening] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const position = useCallback(() => audioRef.current?.currentTime ?? 0, []);
  const stop = useCallback(() => {
    audioRef.current?.pause();
    setListening(false);
  }, []);
  useDemoClock(listening, position, setT, stop);
  const mushaf = usePageFont(DEMO_PAGE);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (listening) {
      audio.pause();
      setListening(false);
      return;
    }
    audio.currentTime = 0;
    audio.play().then(() => setListening(true)).catch(() => setListening(false));
  }, [listening]);

  const { caption, spoken } = captionAt(t);
  return (
    <div className="hero-demo">
      <div className="hero-stage">
        <audio ref={audioRef} src={DEMO_AUDIO_URL} preload="none" onEnded={() => setListening(false)} />
        <PhoneFrame caption={caption} spoken={spoken} label={copy.demoLabel} mushaf={mushaf} />
        <div className="hero-controls">
          <button type="button" className="listen" onClick={toggle} aria-pressed={listening}>
            {listening ? <Pause aria-hidden className="h-4 w-4" /> : <Play aria-hidden className="h-4 w-4" />}
            {listening ? copy.pause : copy.listen}
          </button>
          <span className="caption-count" aria-live="polite">
            {copy.captionOf(DEMO_CAPTIONS.indexOf(caption) + 1, DEMO_CAPTIONS.length)}
          </span>
        </div>
      </div>
      <DemoTimeline t={t} label={copy.timelineLabel} />
    </div>
  );
}

/**
 * The clip itself: the caption on screen at this moment, its spoken words lit,
 * in the studio's default Madani face -- the printed page's own glyphs -- or,
 * where that page's font is not installed, the same words as text.
 */
function PhoneFrame({ caption, spoken, label, mushaf }: { caption: DemoCaption; spoken: number; label: string; mushaf: boolean }) {
  const face = mushaf ? `'${qpcPageFamily(DEMO_PAGE)}'` : TEXT_FACE;
  return (
  <figure className="phone" aria-label={label}>
    <div className="phone-screen">
      <ClipBackground />
      <p className="phone-surah" dir="rtl" lang="ar" style={{ fontFamily: TEXT_FACE }}>سورة الملك</p>
      <div className="phone-card">
        <p className="phone-ayah" dir="rtl" lang="ar" style={{ fontFamily: face }} aria-label={caption.words.map(w => w.text).join(' ')}>
          {caption.words.map((word, i) => (
            <span key={i} aria-hidden className={i < spoken - 1 ? 'w-said' : i === spoken - 1 ? 'w-now' : 'w-next'}>
              {mushaf ? word.glyph : word.text}{' '}
            </span>
          ))}
          <span className="phone-number" aria-hidden>{mushaf ? caption.endGlyph : `﴿${toArabicDigits(caption.ayah)}﴾`}</span>
        </p>
        <p className="phone-translation" lang="en" dir="ltr">{caption.translation}</p>
      </div>
    </div>
    <figcaption className="phone-caption">{label}</figcaption>
  </figure>
  );
}

/**
 * Behind the caption, as in the studio: its default background, Illuminated
 * Mosque & Moon (Pexels 18953366), a twelve-second loop cut small and blurred 6px
 * so it stays behind the words. Held on its poster frame for anyone who asked
 * for less motion.
 */
function ClipBackground() {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) ref.current?.play().catch(() => {});
  }, []);
  return (
    <div className="phone-bg" aria-hidden>
      <video ref={ref} muted loop playsInline preload="auto" poster="/landing/clip-bg.jpg">
        <source src="/landing/clip-bg.webm" type="video/webm" />
        <source src="/landing/clip-bg.mp4" type="video/mp4" />
      </video>
    </div>
  );
}

/**
 * Whether a page of the Madani mushaf can be drawn: its font is fetched as the
 * studio fetches it, and anything but a loaded face -- a clone that has not
 * imported QUL's fonts -- leaves the text face in place rather than boxes.
 */
function usePageFont(page: number): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof FontFace === 'undefined') return;
    let live = true;
    const face = new FontFace(qpcPageFamily(page), `url(${qpcPageUrl(page)}) format('woff2')`);
    face.load().then(loaded => {
      document.fonts.add(loaded);
      if (live) setReady(true);
    }).catch(() => {});
    return () => { live = false; };
  }, [page]);
  return ready;
}

/**
 * Advances `t`: the recording's own position while it plays, else the published
 * times on a loop. A recording past the captioned ayahs is stopped there.
 */
function useDemoClock(listening: boolean, position: () => number, setT: (t: number) => void, stop: () => void) {
  useEffect(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still && !listening) return;
    let frame = 0;
    const began = performance.now() - STILL_AT * 1000;
    const tick = (now: number) => {
      if (listening && position() >= LISTEN_UNTIL) {
        stop();
        return;
      }
      setT(listening ? position() : ((now - began) / 1000) % DEMO_LENGTH);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [listening, position, setT, stop]);
}

/** The studio's timeline for the clip: a ruler, the recitation's loudness, a block per caption and the playhead. */
function DemoTimeline({ t, label }: { t: number; label: string }) {
  const at = (seconds: number) => `${(seconds / DEMO_LENGTH) * 100}%`;
  return (
    <div className="timeline" dir="ltr" role="img" aria-label={label}>
      <div className="timeline-ruler" aria-hidden>
        {TICKS.map(s => (
          <span key={s} style={{ left: at(s) }}>{`0:${String(s).padStart(2, '0')}`}</span>
        ))}
      </div>
      <div className="timeline-track" aria-hidden>
        <div className="timeline-wave">
          {DEMO_WAVEFORM.map((v, i) => (
            <i key={i} style={{ height: `${Math.max(6, v * 100)}%` }} />
          ))}
        </div>
        {DEMO_CAPTIONS.map(c => (
          <div
            key={c.verseKey}
            className={`timeline-block${t >= c.start && t < c.end ? ' is-on' : ''}`}
            style={{ left: at(c.start), width: `calc(${at(c.end - c.start)} - 3px)` }}
          >
            <span className="timeline-key">{c.verseKey}</span>
            <span className="timeline-text" dir="rtl" lang="ar" style={{ fontFamily: TEXT_FACE }}>{c.words.map(w => w.text).join(' ')}</span>
          </div>
        ))}
        <div className="timeline-head" style={{ left: at(Math.min(t, DEMO_LENGTH)) }} />
      </div>
    </div>
  );
}

function toArabicDigits(n: number): string {
  return String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}
