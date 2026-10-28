/** Prisma Composer app: one service (API + web) and its Prisma Postgres database. */
import { module } from '@prisma/composer';
import { rawPostgres } from '@prisma/composer-prisma-cloud';
import forgehse from './deploy/compute/service.ts';

// App name = Prisma project name. 'brittos-forgehse' already holds a database created outside Composer, so the app deploys as its own project.
export default module('forgehse-platform', ({ provision }) => {
  const db = provision(rawPostgres({ name: 'database' }));
  provision(forgehse, { deps: { db } });
});
