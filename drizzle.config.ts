import { config as loadEnv } from 'dotenv';
import type { Config } from 'drizzle-kit';

// Read the same DATABASE_URL the app reads. The previous drizzle.config.json
// hardcoded a connection string, so `drizzle-kit push` could happily create
// tables in a different database than the one the app talks to -- leaving you
// with a working app and an empty schema.
//
// Next.js loads .env.local itself; drizzle-kit does not, so load it here.
loadEnv({ path: '.env.local' });
loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and set it, ' +
      'or run: DATABASE_URL=postgres://... npx drizzle-kit push'
  );
}

export default {
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url }
} satisfies Config;
