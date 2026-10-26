import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import './styles.css';
import { AuthProvider, useAuth } from './lib/auth';
import { navigate, useLocation, match } from './lib/router';
import { readPref } from './lib/hooks';
import { ToastProvider, Loading } from './components/ui';
import { AppShell, applyTheme } from './components/AppShell';
import { PublicSite } from './pages/PublicSite';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { ObservationList } from './pages/ObservationList';
import { ObservationForm } from './pages/ObservationForm';
import { ObservationDetail } from './pages/ObservationDetail';
import { Assistant } from './pages/Assistant';
import { Studio } from './pages/Studio';
import { StudioLibrary, StudioItemPage } from './pages/StudioLibrary';
import { applyMotion } from './lib/motion';
import { AdminProjects } from './pages/AdminProjects';
import { AdminUsers } from './pages/AdminUsers';
import { AuditTrail } from './pages/AuditTrail';
import { AiUsage } from './pages/AiUsage';
import { Account } from './pages/Account';
import { NotFound } from './pages/NotFound';
import { ModuleWorkspace, type HseModuleKey } from './pages/ModuleWorkspace';

applyTheme(readPref('theme', 'light'));
applyMotion();

function AppRoutes({ path }: { path: string }) {
  let m: Record<string, string> | null;
  if (path === '/app') return <Dashboard />;
  if (path === '/app/observations') return <ObservationList />;
  if (path === '/app/report') return <ObservationForm />;
  if ((m = match('/app/observations/:id/edit', path))) return <ObservationForm id={m.id} />;
  if ((m = match('/app/observations/:id', path))) return <ObservationDetail id={m.id!} />;
  if (path === '/app/assistant') return <Assistant />;
  if (path === '/app/studio') return <Studio />;
  if (path === '/app/studio/library') return <StudioLibrary />;
  if ((m = match('/app/studio/items/:id', path))) return <StudioItemPage id={m.id!} />;
  if (path === '/app/admin/projects') return <AdminProjects />;
  if (path === '/app/admin/users') return <AdminUsers />;
  if (path === '/app/audit') return <AuditTrail />;
  if (path === '/app/ai-usage') return <AiUsage />;
  if (path === '/app/account') return <Account />;
  const moduleRoutes: Record<string, HseModuleKey> = {
    '/app/risk-assessments': 'risk-assessments', '/app/permits': 'permits',
    '/app/inspections-audits': 'inspections-audits', '/app/incidents': 'incidents',
    '/app/actions': 'actions', '/app/training': 'training', '/app/contractors': 'contractors',
    '/app/environmental-health': 'environmental-health', '/app/emergency': 'emergency',
    '/app/documents': 'documents', '/app/analytics': 'analytics', '/app/settings': 'settings',
  };
  if (moduleRoutes[path]) return <ModuleWorkspace moduleKey={moduleRoutes[path]} />;
  return <NotFound />;
}

function App() {
  const { path } = useLocation();
  const { me, loading } = useAuth();
  const inApp = path === '/app' || path.startsWith('/app/');

  useEffect(() => {
    if (!loading && inApp && !me) navigate('/login?next=' + encodeURIComponent(path), { replace: true });
    if (!loading && me?.user.mustChangePassword && inApp && path !== '/app/account') navigate('/app/account?required=1', { replace: true });
  }, [loading, me, inApp, path]);

  useEffect(() => {
    const titles: Record<string, string> = { '/': 'AI-powered HSE platform', '/login': 'Sign in', '/app/studio': 'AI Studio', '/app/studio/library': 'Studio library' };
    document.title = `${titles[path] ?? 'Workspace'} — BRITTO'S FORGEHSE`;
  }, [path]);

  if (path === '/login') return <Login />;
  if (!inApp) return path === '/' ? <PublicSite /> : <NotFound publicPage />;
  if (loading || !me) return <Loading label="Opening your workspace" />;
  return <AppShell><AppRoutes path={path} /></AppShell>;
}

createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <AuthProvider>
      <App />
    </AuthProvider>
  </ToastProvider>,
);
