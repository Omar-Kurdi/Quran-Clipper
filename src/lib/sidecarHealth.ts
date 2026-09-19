/**
 * What the sidecar's `/health` answer says it can do, with every field
 * defaulted for a sidecar that could not be reached or answered with nothing.
 */
export function sidecarStatus(reachable: boolean, health: unknown) {
  const h = (typeof health === 'object' && health !== null ? health : {}) as Record<string, unknown>;
  return {
    asrAvailable: reachable,
    // Whether the sidecar can work the ayah range out from the audio on its own.
    // False on a CPU-only host, where the align backend is the character model
    // rather than NeMo -- `align` then aligns the UI's selected range instead.
    canAutoDetectRange: reachable && Boolean(h.canAutoDetectRange),
    // A sidecar can be reachable and still be unable to align at all, if its
    // backend failed to import. Surfacing that here means the studio can say so
    // before someone uploads a file, rather than after a failed match. Absent on
    // an older sidecar, which is indistinguishable from healthy.
    alignReady: h.alignReady !== false,
    alignError: typeof h.alignError === 'string' ? h.alignError : null,
    qulAssist: reachable && Boolean(h.qulAssist),
    // A helper started from code older than QUL support reports no such field
    // at all, which is a restart to ask for -- not missing files.
    qulSupported: reachable && 'qulAssist' in h,
  };
}
