/**
 * Prisma Compute service declaration for BRITTO'S FORGEHSE (API + web app in one server).
 * The database is a declared dependency; Composer injects its URL at runtime (no DATABASE_URL to copy).
 */
import node from '@prisma/composer/node';
import { compute, rawPostgres } from '@prisma/composer-prisma-cloud';

export default compute({
  name: 'forgehse',
  deps: { db: rawPostgres() },
  build: node({ module: import.meta.url, entry: '../../dist/compute/server.mjs' }),
});
