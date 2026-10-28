#!/usr/bin/env node
/**
 * CI only. prisma/cloud-deploy-action@v1 runs `prisma deploy <module>` with the module as a
 * positional argument, but the Prisma CLI in this repository (8.0.0-rc.28) only accepts
 * `--entry <module>` and exits with "Too many arguments". This script replaces the local
 * node_modules/.bin/prisma link with a small wrapper that turns `deploy <file>` / `destroy <file>`
 * into `deploy --entry <file>` and passes everything else through unchanged.
 * Remove it once the action and the CLI agree.
 */
import { existsSync, lstatSync, readlinkSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';

const bin = path.resolve('node_modules/.bin/prisma');
if (!existsSync(bin)) { console.error('prisma is not installed'); process.exit(1); }
const target = lstatSync(bin).isSymbolicLink() ? path.resolve(path.dirname(bin), readlinkSync(bin)) : null;
if (!target) { console.log('prisma bin is already a wrapper; nothing to do'); process.exit(0); }

const wrapper = `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if ((args[0] === 'deploy' || args[0] === 'destroy') && args[1] && !args[1].startsWith('-') && /\\.[cm]?[jt]s$/.test(args[1])) {
  args.splice(1, 1, '--entry', args[1]);
}
const r = spawnSync(process.execPath, [${JSON.stringify(target)}, ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);
`;
rmSync(bin);
writeFileSync(bin, wrapper);
chmodSync(bin, 0o755);
console.log(`prisma bin wrapped (deploy <module> → deploy --entry <module>), real CLI: ${target}`);
