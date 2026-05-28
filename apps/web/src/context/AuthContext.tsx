import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthResponse } from '@shiftwise/shared';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { api, isApiConfigured } from '../lib/api';
import { clearAuth, getStoredUser, setAuth } from '../lib/api/client';

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: 'EMPLOYER' | 'EMPLOYEE';
  workplaceId: string | null;
  user_metadata?: { name?: string };
}

interface AuthContextType {
  user: AppUser | null;
  token: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const MOCK_USER: AppUser = {
  id: 'mock-user-1',
  email: 'manager@shiftagent.com',
  name: 'Restaurant Manager',
  role: 'EMPLOYER',
  workplaceId: null,
  user_metadata: { name: 'Restaurant Manager' },
};

function toAppUser(u: AuthResponse['user']): AppUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    workplaceId: u.workplaceId,
    user_metadata: { name: u.name },
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      if (isApiConfigured) {
        localStorage.removeItem('shiftagent_mock_auth');
        const stored = getStoredUser();
        const t = localStorage.getItem('shiftwise_token');
        if (stored && t) {
          setUser(toAppUser(stored));
          setToken(t);
        }
        setLoading(false);
        return;
      }

      if (isSupabaseConfigured && supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setUser({
            id: session.user.id,
            email: session.user.email ?? '',
            name: (session.user.user_metadata?.name as string) ?? session.user.email?.split('@')[0] ?? 'User',
            role: 'EMPLOYER',
            workplaceId: null,
            user_metadata: session.user.user_metadata as { name?: string },
          });
        }
        setLoading(false);

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
          if (session?.user) {
            setUser({
              id: session.user.id,
              email: session.user.email ?? '',
              name: (session.user.user_metadata?.name as string) ?? 'User',
              role: 'EMPLOYER',
              workplaceId: null,
              user_metadata: session.user.user_metadata as { name?: string },
            });
          } else {
            setUser(null);
          }
        });
        return () => subscription.unsubscribe();
      }

      if (localStorage.getItem('shiftagent_mock_auth')) setUser(MOCK_USER);
      setLoading(false);
    }
    void init();
  }, []);

  async function signIn(email: string, password: string): Promise<{ error: string | null }> {
    if (isApiConfigured) {
      try {
        const res = await api.login(email, password);
        setAuth(res);
        setUser(toAppUser(res.user));
        setToken(res.token);
        return { error: null };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Login failed' };
      }
    }

    if (!isSupabaseConfigured || !supabase) {
      if (email && password.length >= 4) {
        localStorage.setItem('shiftagent_mock_auth', '1');
        setUser({
          ...MOCK_USER,
          email,
          name: email.split('@')[0] ?? 'Manager',
          user_metadata: { name: email.split('@')[0] ?? 'Manager' },
        });
        return { error: null };
      }
      return { error: 'Invalid email or password' };
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signOut() {
    if (isApiConfigured) {
      clearAuth();
      setUser(null);
      setToken(null);
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      localStorage.removeItem('shiftagent_mock_auth');
      setUser(null);
      return;
    }
    await supabase.auth.signOut();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
