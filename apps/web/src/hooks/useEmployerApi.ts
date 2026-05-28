import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api, isApiConfigured } from '../lib/api';
import type { Employee } from '../lib/types';
import { mockEmployees } from '../lib/mockData';

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

  return { employees, setEmployees, loading, refresh, workplaceId };
}
