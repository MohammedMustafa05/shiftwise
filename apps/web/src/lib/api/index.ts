import type { AuthResponse } from '@shiftagent/shared';
import { apiFetch, API_URL, getToken, ApiError } from './client';
import {
  mapEmployeeFromApi,
  mapEmployeeToApi,
  mapScheduleFromApi,
  mapShiftUpdatesToApi,
  mapAvailabilityFromApi,
  mapTimeOffFromApi,
  mapPreferencesFromApi,
  mapPreferencesToApi,
  mapSalesFromApi,
} from './mappers';
import type { Employee, Preferences, SalesData } from '../types';

export { isApiConfigured, getStoredUser, clearAuth, setAuth } from './client';
export { weekStartMonday } from './mappers';

type GenerateResult = {
  scheduleId: string;
  status?: string;
  shifts?: unknown[];
  workersNeeded?: {
    byHour: Array<{ date: string; hour: number; sales: number; workers: number }>;
    byDay: Array<{ date: string; sales: number; workers: number }>;
  };
  flags?: Array<{ type: string; date?: string; hour?: number; message?: string }>;
};

type GenerateJobStatus = {
  jobId: string;
  state: string;
  result: GenerateResult | null;
  failedReason: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollGenerateJob(jobId: string, maxWaitMs = 600_000): Promise<GenerateResult> {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    await sleep(2000);
    const job = await apiFetch<GenerateJobStatus>(`/api/schedules/generate/jobs/${jobId}`);
    if (job.state === 'completed' && job.result) return job.result;
    if (job.state === 'failed') {
      throw new ApiError(job.failedReason ?? 'Schedule generation failed', 500);
    }
  }
  throw new ApiError('Schedule generation timed out — try again in a minute', 504);
}

export const api = {
  async login(email: string, password: string): Promise<AuthResponse> {
    return apiFetch<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  async signup(body: {
    email: string;
    password: string;
    name: string;
    workplaceName: string;
    timezone?: string;
  }): Promise<AuthResponse> {
    return apiFetch<AuthResponse>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async joinInfo(slug: string): Promise<{ workplaceName: string; workplaceId: string }> {
    return apiFetch<{ workplaceName: string; workplaceId: string }>(`/api/auth/join/${slug}/info`);
  },

  async join(
    slug: string,
    body: { email: string; password: string; name: string }
  ): Promise<AuthResponse> {
    return apiFetch<AuthResponse>(`/api/auth/join/${slug}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async getEmployees(workplaceId: string): Promise<Employee[]> {
    const rows = await apiFetch<Array<Parameters<typeof mapEmployeeFromApi>[0]>>(
      `/api/workplace/${workplaceId}/employees`
    );
    return rows.map((r) => mapEmployeeFromApi(r));
  },

  async createEmployee(workplaceId: string, emp: Employee, password?: string): Promise<Employee> {
    const created = await apiFetch<Parameters<typeof mapEmployeeFromApi>[0]>(
      `/api/workplace/${workplaceId}/employees`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...mapEmployeeToApi(emp),
          name: emp.name,
          email: emp.email,
          ...(password ? { password } : {}),
        }),
      }
    );
    return mapEmployeeFromApi(created);
  },

  async updateEmployee(workplaceId: string, emp: Employee): Promise<Employee> {
    const updated = await apiFetch<Parameters<typeof mapEmployeeFromApi>[0]>(
      `/api/workplace/${workplaceId}/employees/${emp.id}`,
      { method: 'PATCH', body: JSON.stringify(mapEmployeeToApi(emp)) }
    );
    return mapEmployeeFromApi(updated);
  },

  async deleteEmployee(workplaceId: string, profileId: string) {
    return apiFetch<{ ok: boolean }>(`/api/workplace/${workplaceId}/employees/${profileId}`, {
      method: 'DELETE',
    });
  },

  async getScheduleByWeek(_workplaceId: string, weekStart: string) {
    try {
      const detail = await apiFetch<{
        id: string;
        weekStart: string;
        status: 'draft' | 'published';
        exportedAt: string | null;
        mlMetadata?: Record<string, unknown>;
        shifts: Array<{
          id: string;
          employeeId: string;
          shiftDate: string;
          startTime: string;
          endTime: string;
          role: string;
          isLocked?: boolean;
        }>;
      }>(`/api/schedules/week/${weekStart}`);
      return detail;
    } catch (e) {
      if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 404) {
        return null;
      }
      throw e;
    }
  },

  async generateSchedule(weekStart: string): Promise<GenerateResult> {
    const res = await apiFetch<GenerateResult & { jobId?: string; status?: string }>(
      '/api/schedules/generate',
      {
        method: 'POST',
        body: JSON.stringify({ weekStart }),
      }
    );
    if (res.jobId && res.status === 'queued') {
      return pollGenerateJob(res.jobId);
    }
    return res;
  },

  async overrideShift(
    scheduleId: string,
    shiftId: string,
    data: {
      overrideReason: string;
      notes?: string;
      startTime?: string;
      endTime?: string;
      role?: string;
      employeeId?: string;
    }
  ) {
    return apiFetch(`/api/schedules/${scheduleId}/shifts/${shiftId}/override`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateShift(
    scheduleId: string,
    shiftId: string,
    updates: Record<string, unknown>,
    employees: Employee[]
  ) {
    return apiFetch(`/api/schedules/${scheduleId}/shifts/${shiftId}`, {
      method: 'PUT',
      body: JSON.stringify(mapShiftUpdatesToApi(updates, employees)),
    });
  },

  async createShift(
    scheduleId: string,
    data: {
      employeeId: string;
      shiftDate: string;
      startTime: string;
      endTime: string;
      role: string;
      isLocked?: boolean;
    },
    employees: Employee[]
  ) {
    const emp = employees.find((e) => e.id === data.employeeId);
    const userId = (emp as Employee & { userId?: string })?.userId ?? data.employeeId;
    return apiFetch<{ shiftId: string }>(`/api/schedules/${scheduleId}/shifts`, {
      method: 'POST',
      body: JSON.stringify({
        employeeId: userId,
        shiftDate: data.shiftDate,
        startTime: data.startTime,
        endTime: data.endTime,
        role: data.role.toUpperCase(),
        isLocked: data.isLocked ?? false,
      }),
    });
  },

  async deleteShift(scheduleId: string, shiftId: string) {
    return apiFetch(`/api/schedules/${scheduleId}/shifts/${shiftId}`, { method: 'DELETE' });
  },

  async publishSchedule(scheduleId: string) {
    return apiFetch<{ downloadUrl: string }>(`/api/schedules/${scheduleId}/publish`, {
      method: 'POST',
    });
  },

  async getPreferences(workplaceId: string): Promise<Preferences> {
    const data = await apiFetch<{ preferences: Parameters<typeof mapPreferencesFromApi>[0] }>(
      `/api/workplace/${workplaceId}`
    );
    return mapPreferencesFromApi(data.preferences);
  },

  async savePreferences(workplaceId: string, prefs: Preferences) {
    return apiFetch(`/api/workplace/${workplaceId}/web-preferences`, {
      method: 'PUT',
      body: JSON.stringify(mapPreferencesToApi(prefs)),
    });
  },

  async getSales(workplaceId: string, weekStart: string): Promise<SalesData[]> {
    const data = await apiFetch<{ weekStart: string; days: Array<{ date: string; hourlySales: Record<string, number> }> }>(
      `/api/workplace/${workplaceId}/sales?weekStart=${weekStart}`
    );
    return mapSalesFromApi(data);
  },

  async saveSales(workplaceId: string, weekStart: string, days: SalesData[]) {
    return apiFetch(`/api/workplace/${workplaceId}/sales`, {
      method: 'PUT',
      body: JSON.stringify({
        weekStart,
        days: days.map((d) => ({ date: d.date, hourlySales: d.hourly_sales })),
      }),
    });
  },

  async uploadSalesCsv(
    workplaceId: string,
    file: File,
    saleDate?: string
  ): Promise<{
    rowsAccepted: number;
    rowsRejected: number;
    format?: 'standard' | 'drop_chart' | 'clearview_cash_sheet';
    dateRange: { from: string | null; to: string | null };
  }> {
    const token = getToken();
    const form = new FormData();
    form.append('file', file);
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const qs = saleDate ? `?saleDate=${encodeURIComponent(saleDate)}` : '';
    const res = await fetch(`${API_URL}/api/workplace/${workplaceId}/sales-data${qs}`, {
      method: 'POST',
      headers,
      body: form,
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = await res.json();
        message = body.error ?? message;
      } catch {
        /* ignore */
      }
      throw new ApiError(message, res.status);
    }
    return res.json();
  },

  async getAvailabilityRequests(employees: Employee[]) {
    const items = await apiFetch<Array<Parameters<typeof mapAvailabilityFromApi>[0][number]>>(
      '/api/approvals/availability'
    );
    return mapAvailabilityFromApi(items, employees);
  },

  async getTimeOffRequests(employees: Employee[]) {
    const items = await apiFetch<Array<Parameters<typeof mapTimeOffFromApi>[0][number]>>(
      '/api/approvals/time-off'
    );
    return mapTimeOffFromApi(items, employees);
  },

  async updateAvailabilityStatus(id: string, status: 'approved' | 'rejected') {
    return apiFetch(`/api/approvals/availability/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  async updateTimeOffStatus(id: string, status: 'approved' | 'rejected') {
    return apiFetch(`/api/approvals/time-off/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  async getDashboardSummary(weekStart: string) {
    return apiFetch<{
      pendingApprovals: number;
      scheduledHours: number;
      laborCost: number;
      laborBudget: number;
      laborCostPct: number;
      weekStart: string;
    }>(`/api/dashboard/summary?weekStart=${weekStart}`);
  },

  async getActivity() {
    return apiFetch<Array<{ id: string; type: string; message: string; timestamp: string; actor: string | null }>>(
      '/api/dashboard/activity'
    );
  },
};

export function loadScheduleWithEmployees(
  detail: NonNullable<Awaited<ReturnType<typeof api.getScheduleByWeek>>>,
  employees: Employee[]
) {
  return mapScheduleFromApi(detail, employees);
}
