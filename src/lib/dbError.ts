/**
 * Turns a database failure into something a person can act on.
 *
 * Drizzle wraps every failure in an error whose *message* is the SQL it tried
 * to run and whose `cause` is the reason it failed. Reporting `error.message`
 * therefore sent the browser a wall of SELECT and no reason at all -- a stopped
 * Postgres container and a missing column produced byte-identical output, and
 * neither said which it was.
 *
 * The deepest cause is the reason; the two failures that are almost always
 * environment rather than code get the fix appended.
 */
export function describeDbError(err: unknown): string {
  let current: unknown = err;
  let reason = err instanceof Error ? err.message : String(err);

  // Bounded: `cause` chains are short in practice, and a cyclic one would
  // otherwise spin here forever.
  for (let depth = 0; depth < 5; depth++) {
    const cause = (current as { cause?: unknown } | null | undefined)?.cause;
    if (!(cause instanceof Error)) break;
    reason = cause.message;
    current = cause;
  }

  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|Connection terminated/i.test(reason)) {
    return `${reason} — the database named by DATABASE_URL is not reachable. Start it with \`npm run db:start\`, or unset DATABASE_URL to keep saving in memory.`;
  }
  if (/(column|relation|table).*does not exist/i.test(reason)) {
    return `${reason} — the database is missing part of the schema. Run \`npm run db:push\`.`;
  }
  return reason;
}
