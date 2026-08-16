import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return Response.json({ ok: true, database: "not_configured", storage: "memory_fallback" });
  }

  try {
    const { db } = await import("@/db");
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, database: "connected" });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
