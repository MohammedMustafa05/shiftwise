import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api, isApiConfigured } from '../lib/api';
import type { Employee } from '../lib/types';
import { mockEmployees } from '../lib/mockData';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export function useWorkplaceId(): string | null {
  const { user } = useAuth();
  return user?.workplaceId ?? null;
}

export function useEmployees() {
  const workplaceId = useWorkplaceId();
  const [employees, setEmployees] = useState<Employee[]>(isApiConfigured ? [] : mockEmployees);
  const [loading, setLoading] = useState(isApiConfigured);

  const refresh = useCallback(async () => {
    if (!isApiConfigured || !workplaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api.getEmployees(workplaceId);
      setEmployees(data);
    } catch {
      /* keep previous */
    } finally {
      setLoading(false);
    }
  }, [workplaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isApiConfigured || !workplaceId) return;
    if (!isSupabaseConfigured || !supabase) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 350);
    };

    const channel = supabase
      .channel(`employees-${workplaceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'employee_profiles', filter: `workplace_id=eq.${workplaceId}` },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'users', filter: `workplace_id=eq.${workplaceId}` },
        scheduleRefresh
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase?.removeChannel(channel);
    };
  }, [workplaceId, refresh]);

  return { employees, setEmployees, loading, refresh, workplaceId };
}
