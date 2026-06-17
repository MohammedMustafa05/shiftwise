import { useCallback, useEffect, useState } from 'react';
import { format, startOfWeek } from 'date-fns';
import { api, isApiConfigured } from '../lib/api';
import { useWorkplaceId } from './useEmployerApi';
import { approvalChangeSignal } from './approvalChangeSignal';

export function usePendingApprovals() {
  const workplaceId = useWorkplaceId();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!isApiConfigured) return;
    try {
      const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const summary = await api.getDashboardSummary(weekStart);
      setCount(summary.pendingApprovals);
    } catch {
      /* ignore */
    }
  }, [workplaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unsub = approvalChangeSignal.subscribe(() => void refresh());
    return () => { unsub; };
  }, [refresh]);

  return { count, refresh };
}
