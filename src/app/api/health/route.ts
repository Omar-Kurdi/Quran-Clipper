import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * One answer to "is the studio actually working?".
 *
 * There are three moving parts -- this app, a Postgres container, and a Python
 * sidecar holding the alignment model -- each logging somewhere else, and the
 * app used to report only on the one it is. So "is the database loaded?" and
 * "is the model up?" were questions you answered by reading three terminals,
 * or by uploading a file and seeing what broke.
 *
 * Every probe is bounded. The sidecar being *down* is exactly when this
 * endpoint matters, and an unbounded fetch to a dead host is the one thing
 * that would make the status strip hang instead of saying so.
 */
const PROBE_TIMEOUT_MS = 2000;

export type ServiceState = "up" | "down" | "not_configured";

export interface HealthReport {
  ok: boolean;
  database: { state: ServiceState; detail?: string };
  aligner: {
    state: ServiceState;
    /** The align model, once the sidecar has said which one it loaded. */
    model?: string;
    /** False when the sidecar is up but its align backend failed to load. */
    ready?: boolean;
    /** Whether the passage can be worked out from the audio. */
    canAutoDetectRange?: boolean;
    detail?: string;
  };
}

async function probeDatabase(): Promise<HealthReport["database"]> {
  if (!process.env.DATABASE_URL) {
    return { state: "not_configured", detail: "Saving to memory; projects will not survive a restart." };
  }
  try {
    const { db } = await import("@/db");
    await db.execute(sql`select 1`);
    return { state: "up" };
  } catch (err) {
    const { describeDbError } = await import("@/lib/dbError");
    return { state: "down", detail: describeDbError(err) };
  }
}

async function probeAligner(): Promise<HealthReport["aligner"]> {
  const base = (process.env.ASR_SERVICE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { state: "down", detail: `${base} answered ${res.status}.` };
    const body = await res.json();
    return {
      state: "up",
      model: typeof body.alignModel === "string" ? body.alignModel : undefined,
      ready: body.alignReady !== false,
      canAutoDetectRange: body.canAutoDetectRange === true,
      // The sidecar's own reason, when it has one -- it knows why its backend
      // did not load and this route would only be guessing.
      detail: typeof body.alignError === "string" ? body.alignError : undefined,
    };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      state: "down",
      detail: timedOut
        ? `${base} did not answer within ${PROBE_TIMEOUT_MS}ms.`
        : `${base} is not reachable. Start it with ./start.sh, or see asr-service/README.md.`,
    };
  }
}

export async function GET() {
  const [database, aligner] = await Promise.all([probeDatabase(), probeAligner()]);
  // "ok" means nothing is *broken*, not that everything is present. Neither
  // piece is required: the app saves to memory without a database and matches
  // with Gemini without the sidecar. Reporting a deliberate setup as a failure
  // would make the indicator something to ignore.
  const ok = database.state !== "down" && aligner.state !== "down";
  const report: HealthReport = { ok, database, aligner };
  return Response.json(report);
}
