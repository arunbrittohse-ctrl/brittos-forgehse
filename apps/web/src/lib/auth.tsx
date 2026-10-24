import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Permission, RoleAssignment } from '@forgehse/shared';
import { api, setAuthHandlers } from './api';
import { navigate } from './router';
import { setTimezone } from './format';

export interface Me {
  user: { id: string; email: string; fullName: string; jobTitle: string; mustChangePassword: boolean };
  organization: { id: string; name: string; slug: string; settings: { timezone?: string } };
  organizations: { id: string; name: string }[];
  assignments: (RoleAssignment & { roleLabel: string })[];
  permissions: Permission[];
  projects: { id: string; code: string; name: string; status: string; sites: { id: string; code: string; name: string }[] }[];
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  reload: () => Promise<Me | null>;
  logout: () => Promise<void>;
  /** UI hint only — the server enforces every permission. */
  can: (p: Permission) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      const m = await api<Me>('/auth/me');
      setTimezone(m.organization.settings?.timezone ?? 'Asia/Dubai');
      setMe(m);
      return m;
    } catch {
      setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setAuthHandlers({
      unauthorized: () => { setMe(null); if (location.pathname.startsWith('/app')) navigate('/login?next=' + encodeURIComponent(location.pathname)); },
      passwordChange: () => navigate('/app/account?required=1'),
    });
    void reload();
  }, []);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setMe(null);
    navigate('/login');
  };

  return <Ctx.Provider value={{ me, loading, reload, logout, can: (p) => !!me?.permissions.includes(p) }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
