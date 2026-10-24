import { createDb } from '../db/db';
import { migrateDown, migrateUp } from '../db/migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const db = createDb(url, { max: 1 });
const cmd = process.argv[2] ?? 'up';
try {
  if (cmd === 'up') {
    const applied = await migrateUp(db, console.log);
    console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Database is up to date.');
  } else if (cmd === 'down') {
    const reverted = await migrateDown(db, console.log);
    console.log(reverted ? `Reverted ${reverted}.` : 'Nothing to revert.');
  } else {
    console.error('Usage: migrate [up|down]');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('Migration failed:', (e as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
