/** Prisma Composer app: one service (API + web) and its Prisma Postgres database. */
import { module } from '@prisma/composer';
import { rawPostgres } from '@prisma/composer-prisma-cloud';
import forgehse from './deploy/compute/service.ts';

// App name = the Prisma project the repository is connected to.
export default module('brittos-forgehse', ({ provision }) => {
  const db = provision(rawPostgres({ name: 'database' }));
  provision(forgehse, { deps: { db } });
});
