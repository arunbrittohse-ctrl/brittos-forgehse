import { scopesFor } from '@forgehse/shared';
import type { Queryable } from '../db/db';
import type { AuthContext } from '../auth/session';

export interface AccessibleProject {
  id: string;
  code: string;
  name: string;
  status: string;
  sites: { id: string; code: string; name: string }[];
}

/**
 * Projects (and the sites within them) the user can see. A site-scoped role
 * exposes only that site; project- or org-wide roles expose all active sites.
 */
export async function accessibleProjects(q: Queryable, auth: AuthContext): Promise<AccessibleProject[]> {
  const s = scopesFor(auth.assignments, 'observation.view', auth.organizationId);
  // Admins without observation.view still need to see projects to manage them.
  const admin = scopesFor(auth.assignments, 'project.manage', auth.organizationId);
  const orgWide = s.orgWide || admin.orgWide;
  const fullProjects = new Set([...s.projects, ...admin.projects]);
  const siteOnly = new Map<string, Set<string>>();
  for (const x of s.sites) {
    if (!siteOnly.has(x.projectId)) siteOnly.set(x.projectId, new Set());
    siteOnly.get(x.projectId)!.add(x.siteId);
  }
  const rows = (await q.query<{ id: string; code: string; name: string; status: string; sites: { id: string; code: string; name: string; active: boolean }[] | null }>(
    `SELECT p.id, p.code, p.name, p.status,
            (SELECT json_agg(json_build_object('id', s.id, 'code', s.code, 'name', s.name, 'active', s.active) ORDER BY s.code)
               FROM sites s WHERE s.project_id = p.id) AS sites
       FROM projects p WHERE p.organization_id = $1 ORDER BY p.code`,
    [auth.organizationId])).rows;

  const out: AccessibleProject[] = [];
  for (const p of rows) {
    const sites = (p.sites ?? []).filter((x) => x.active);
    if (orgWide || fullProjects.has(p.id)) out.push({ id: p.id, code: p.code, name: p.name, status: p.status, sites: sites.map(({ active: _a, ...rest }) => rest) });
    else if (siteOnly.has(p.id)) {
      const allowed = siteOnly.get(p.id)!;
      out.push({ id: p.id, code: p.code, name: p.name, status: p.status, sites: sites.filter((x) => allowed.has(x.id)).map(({ active: _a, ...rest }) => rest) });
    }
  }
  return out;
}
