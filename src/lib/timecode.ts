/**
 * The studio's timecodes: `M:SS.s` under an hour and `H:MM:SS.s` from an hour
 * on, so a stretch an hour into a whole surah reads as `1:08:00.0` rather
 * than `68:00.0`.
 */

/** Hours, minutes and tenths of a second, the tenths rounded first so 59.96 s is `1:00.0`, never `0:60.0`. */
function split(seconds: number): { hours: number; minutes: number; secs: number } {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  return {
    hours: Math.floor(tenths / 36000),
    minutes: Math.floor((tenths % 36000) / 600),
    secs: (tenths % 600) / 10,
  };
}

/** `M:SS.s`, or `H:MM:SS.s` from an hour on, matching the format used for durations elsewhere in the studio. */
export function formatDuration(seconds: number): string {
  const { hours, minutes, secs } = split(seconds);
  const ss = secs.toFixed(1).padStart(4, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}

/** A ruler tick's label: the decimal dropped once the ticks are a second or more apart. */
export function formatTick(seconds: number, step: number): string {
  if (step < 1) return formatDuration(seconds);
  const whole = Math.round(Math.max(0, seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const ss = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}

/**
 * Parses the timecodes the trim inputs accept: `3:31.7`, `3:31`, `1:02:05.4`,
 * or a bare `211.7`. Returns null for anything unparseable -- including the
 * empty field and a half-typed `3:` -- so the caller reverts to the previous
 * value instead of committing a NaN.
 */
export function parseTimecode(input: string): number | null {
  const parts = input.trim().split(':');
  if (parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(part)) return null;
    total = total * 60 + Number(part);
  }
  return Number.isFinite(total) ? total : null;
}
