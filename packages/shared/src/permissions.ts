/**
 * Role-based access control matrix.
 *
 * This file is the single source of truth for which role may do what.
 * The API enforces it server-side on every request; the web and mobile
 * clients only use it to hide controls the user cannot use.
 */

export const PERMISSIONS = [
  'org.admin', // organisation settings
  'project.manage', // create / edit projects and sites
  'user.manage', // create users, assign roles
  'audit.view',
  'dashboard.view',
  'observation.view',
  'observation.create',
  'observation.edit', // edit any open observation (reporters can always edit their own while open)
  'observation.assign',
  'observation.action', // submit corrective action (assignees always may on their own items)
  'observation.verify', // verify & close, reject action, reopen
  'observation.archive', // cancel / void with reason
  'report.export',
  'ai.use',
  'ai.usage.view',
  'studio.review', // mark AI-generated Studio drafts as reviewed
  'document.view', // read controlled HSE documents
  'document.create', // prepare, edit and submit HSE documents
  'document.approve', // approve or return HSE documents (never their own submission)
  'risk.view', // read the hazard register and risk insights
  'risk.manage', // create, assess, submit and review hazard register entries
  'risk.approve', // approve high/critical risk assessments (never their own submission)
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  'super_admin',
  'org_admin',
  'corporate_hse_manager',
  'project_hse_manager',
  'hse_engineer',
  'hse_officer',
  'project_manager',
  'site_engineer',
  'supervisor',
  'viewer',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Administrator',
  org_admin: 'Organization Administrator',
  corporate_hse_manager: 'Corporate HSE Manager',
  project_hse_manager: 'Project HSE Manager',
  hse_engineer: 'HSE Engineer',
  hse_officer: 'HSE Officer',
  project_manager: 'Project Manager',
  site_engineer: 'Site Engineer',
  supervisor: 'Supervisor / Foreman',
  viewer: 'Authorized Viewer / Client Representative',
};

/** Roles that apply across the whole organisation rather than to one project/site. */
export const ORG_WIDE_ROLES: ReadonlySet<Role> = new Set<Role>([
  'super_admin',
  'org_admin',
  'corporate_hse_manager',
]);

const ALL = [...PERMISSIONS];
const FIELD_REPORTER: Permission[] = ['dashboard.view', 'observation.view', 'observation.create', 'observation.action', 'ai.use', 'document.view', 'risk.view'];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  super_admin: new Set(ALL),
  org_admin: new Set<Permission>([
    'org.admin', 'project.manage', 'user.manage', 'audit.view', 'dashboard.view',
    'observation.view', 'report.export', 'ai.usage.view', 'document.view', 'risk.view',
  ]),
  corporate_hse_manager: new Set<Permission>([
    'audit.view', 'dashboard.view', 'observation.view', 'observation.create', 'observation.edit',
    'observation.assign', 'observation.action', 'observation.verify', 'observation.archive',
    'report.export', 'ai.use', 'ai.usage.view', 'studio.review',
    'document.view', 'document.create', 'document.approve', 'risk.view', 'risk.manage', 'risk.approve',
  ]),
  project_hse_manager: new Set<Permission>([
    'audit.view', 'dashboard.view', 'observation.view', 'observation.create', 'observation.edit',
    'observation.assign', 'observation.action', 'observation.verify', 'observation.archive',
    'report.export', 'ai.use', 'studio.review',
    'document.view', 'document.create', 'document.approve', 'risk.view', 'risk.manage', 'risk.approve',
  ]),
  hse_engineer: new Set<Permission>([
    'dashboard.view', 'observation.view', 'observation.create', 'observation.edit',
    'observation.assign', 'observation.action', 'observation.verify', 'report.export', 'ai.use', 'studio.review',
    'document.view', 'document.create', 'risk.view', 'risk.manage',
  ]),
  hse_officer: new Set<Permission>([
    'dashboard.view', 'observation.view', 'observation.create', 'observation.edit',
    'observation.assign', 'observation.action', 'report.export', 'ai.use',
    'document.view', 'document.create', 'risk.view', 'risk.manage',
  ]),
  project_manager: new Set<Permission>([
    'dashboard.view', 'observation.view', 'observation.create', 'observation.assign',
    'observation.action', 'report.export', 'ai.use',
    'document.view', 'document.create', 'risk.view', 'risk.manage',
  ]),
  site_engineer: new Set<Permission>(FIELD_REPORTER),
  supervisor: new Set<Permission>(FIELD_REPORTER),
  viewer: new Set<Permission>(['dashboard.view', 'observation.view', 'report.export', 'document.view', 'risk.view']),
};

export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/** A user's role grant inside one organisation, optionally limited to a project and site. */
export interface RoleAssignment {
  organizationId: string;
  role: Role;
  projectId: string | null; // null = all projects in the organisation
  siteId: string | null; // null = all sites in the project
}

export interface ScopeTarget {
  organizationId: string;
  projectId?: string | null;
  siteId?: string | null;
}

/** Does any of the user's assignments grant `permission` for the given scope? */
export function can(assignments: readonly RoleAssignment[], permission: Permission, target: ScopeTarget): boolean {
  return assignments.some((a) => {
    if (a.organizationId !== target.organizationId) return false;
    if (!roleHas(a.role, permission)) return false;
    if (a.projectId && target.projectId !== undefined && a.projectId !== target.projectId) return false;
    if (a.projectId && target.projectId === undefined) return false; // project-scoped grant cannot satisfy an org-wide check
    if (a.siteId && target.siteId !== undefined && target.siteId !== null && a.siteId !== target.siteId) return false;
    if (a.siteId && (target.siteId === undefined || target.siteId === null)) return false;
    return true;
  });
}

/**
 * For list queries: the set of (projectId, siteId) scopes in which the user holds `permission`.
 * `orgWide: true` means every project in the organisation.
 */
export function scopesFor(
  assignments: readonly RoleAssignment[],
  permission: Permission,
  organizationId: string,
): { orgWide: boolean; projects: string[]; sites: { projectId: string; siteId: string }[] } {
  let orgWide = false;
  const projects = new Set<string>();
  const sites: { projectId: string; siteId: string }[] = [];
  for (const a of assignments) {
    if (a.organizationId !== organizationId || !roleHas(a.role, permission)) continue;
    if (!a.projectId) orgWide = true;
    else if (!a.siteId) projects.add(a.projectId);
    else sites.push({ projectId: a.projectId, siteId: a.siteId });
  }
  return { orgWide, projects: [...projects], sites };
}
