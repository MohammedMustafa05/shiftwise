import { useState, useEffect } from 'react';
import { ClipboardCheck, Check, X, Calendar, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { mockAvailabilityRequests, mockTimeOffRequests } from '../lib/mockData';
import type { AvailabilityRequest, TimeOffRequest, ApprovalStatus, DayKey } from '../lib/types';
import { api, isApiConfigured } from '../lib/api';
import { useEmployees } from '../hooks/useEmployerApi';
import { DAY_KEYS, DAY_LABELS, getRoleBadgeClass, getInitials, getAvatarColor } from '../lib/utils';

const GRID_HOURS = [
  '10:00','11:00','12:00','13:00','14:00',
  '15:00','16:00','17:00','18:00','19:00',
  '20:00','21:00','22:00',
];

function fmtGridHour(h: string): string {
  const hr = parseInt(h.split(':')[0]);
  if (hr === 12) return '12p';
  return hr > 12 ? `${hr - 12}p` : `${hr}a`;
}

function safeFormatDate(iso: string, pattern: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '—';
  const d = parseISO(iso.slice(0, 10));
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, pattern);
}

function safeFormatDistance(iso: string): string {
  if (!iso) return 'recently';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'recently';
  return formatDistanceToNow(d, { addSuffix: true });
}

function AvailabilityGrid({ grid }: { grid: AvailabilityRequest['availability_grid'] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table style={{ borderCollapse: 'separate', borderSpacing: 3 }}>
        <thead>
          <tr>
            <th style={{ width: 36 }} />
            {DAY_KEYS.map(day => (
              <th key={day} className="text-center text-xs font-medium px-1" style={{ color: '#71717A', width: 34 }}>
                {DAY_LABELS[day]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GRID_HOURS.map(hour => (
            <tr key={hour}>
              <td className="text-xs pr-1.5 text-right" style={{ color: '#71717A', width: 36 }}>
                {fmtGridHour(hour)}
              </td>
              {DAY_KEYS.map(day => {
                const avail = grid?.[day as DayKey]?.includes(hour) ?? false;
                return (
                  <td key={`${day}-${hour}`}>
                    <div
                      className="rounded-sm"
                      style={{
                        width: 30,
                        height: 16,
                        backgroundColor: avail ? 'rgba(129,140,248,0.18)' : '#27272A',
                        border: `1px solid ${avail ? 'rgba(129,140,248,0.35)' : '#3F3F46'}`,
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-4 mt-2.5">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(129,140,248,0.18)', border: '1px solid rgba(129,140,248,0.35)' }} />
          <span className="text-xs" style={{ color: '#A1A1AA' }}>Available</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46' }} />
          <span className="text-xs" style={{ color: '#A1A1AA' }}>Unavailable</span>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ApprovalStatus }) {
  if (status === 'approved') {
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
        style={{ backgroundColor: 'rgba(52,211,153,0.12)', color: '#34D399', border: '1px solid rgba(52,211,153,0.2)' }}>
        <CheckCircle2 size={11} /> Approved
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ backgroundColor: 'rgba(248,113,113,0.12)', color: '#F87171', border: '1px solid rgba(248,113,113,0.2)' }}>
      <XCircle size={11} /> Rejected
    </span>
  );
}

function ActionButtons({ onApprove, onReject }: { onApprove: () => void; onReject: () => void }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <button
        onClick={onReject}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
        style={{ backgroundColor: 'rgba(248,113,113,0.08)', color: '#F87171', border: '1px solid rgba(248,113,113,0.18)' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(248,113,113,0.16)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(248,113,113,0.08)'}
      >
        <X size={12} /> Reject
      </button>
      <button
        onClick={onApprove}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
        style={{ backgroundColor: 'rgba(52,211,153,0.08)', color: '#34D399', border: '1px solid rgba(52,211,153,0.18)' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(52,211,153,0.16)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(52,211,153,0.08)'}
      >
        <Check size={12} /> Approve
      </button>
    </div>
  );
}

function EmployeeRow({ request }: { request: AvailabilityRequest | TimeOffRequest }) {
  const emp = request.employee;
  const name = emp?.name ?? 'Employee';
  const roles = emp?.role ?? [];
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex items-center justify-center w-9 h-9 rounded-full text-xs font-semibold shrink-0"
        style={{ backgroundColor: getAvatarColor(name), color: '#FFFFFF' }}
      >
        {getInitials(name)}
      </div>
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium" style={{ color: '#FAFAFA' }}>{name}</span>
          {roles.map(r => (
            <span key={r} className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeClass(r)}`}>
              {r}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <Clock size={10} style={{ color: '#71717A' }} />
          <span className="text-xs" style={{ color: '#71717A' }}>
            {safeFormatDistance(request.submitted_at)}
          </span>
        </div>
      </div>
    </div>
  );
}

type TabType = 'availability' | 'timeoff';

export default function Approvals() {
  const { employees } = useEmployees();
  const [availRequests, setAvailRequests] = useState<AvailabilityRequest[]>(isApiConfigured ? [] : mockAvailabilityRequests);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>(isApiConfigured ? [] : mockTimeOffRequests);
  const [activeTab, setActiveTab] = useState<TabType>('availability');
  const [availStatuses, setAvailStatuses] = useState<Record<string, ApprovalStatus>>({});
  const [timeOffStatuses, setTimeOffStatuses] = useState<Record<string, ApprovalStatus>>({});

  useEffect(() => {
    if (!isApiConfigured) {
      setAvailStatuses(Object.fromEntries(mockAvailabilityRequests.map(r => [r.id, r.status])));
      setTimeOffStatuses(Object.fromEntries(mockTimeOffRequests.map(r => [r.id, r.status])));
      return;
    }
    void (async () => {
      try {
        const [avail, toff] = await Promise.all([
          api.getAvailabilityRequests(employees),
          api.getTimeOffRequests(employees),
        ]);
        setAvailRequests(avail);
        setTimeOffRequests(toff);
        setAvailStatuses(Object.fromEntries(avail.map(r => [r.id, r.status])));
        setTimeOffStatuses(Object.fromEntries(toff.map(r => [r.id, r.status])));
      } catch {
        /* keep mocks */
      }
    })();
  }, [employees]);

  async function setAvailStatus(id: string, status: ApprovalStatus) {
    setAvailStatuses(s => ({ ...s, [id]: status }));
    if (isApiConfigured && status !== 'pending') {
      await api.updateAvailabilityStatus(id, status as 'approved' | 'rejected');
    }
  }

  async function setTimeOffStatus(id: string, status: ApprovalStatus) {
    setTimeOffStatuses(s => ({ ...s, [id]: status }));
    if (isApiConfigured && status !== 'pending') {
      await api.updateTimeOffStatus(id, status as 'approved' | 'rejected');
    }
  }

  const pendingAvail = availRequests.filter(r => availStatuses[r.id] === 'pending').length;
  const pendingTimeOff = timeOffRequests.filter(r => timeOffStatuses[r.id] === 'pending').length;
  const totalPending = pendingAvail + pendingTimeOff;

  const tabs: { id: TabType; label: string; count: number }[] = [
    { id: 'availability', label: 'Availability Requests', count: pendingAvail },
    { id: 'timeoff', label: 'Time Off', count: pendingTimeOff },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold" style={{ color: '#FAFAFA' }}>Approvals</h1>
            {totalPending > 0 && (
              <span
                className="flex items-center justify-center text-xs font-semibold rounded-full min-w-[22px] h-5.5 px-2"
                style={{ backgroundColor: 'rgba(129,140,248,0.15)', color: '#818CF8', border: '1px solid rgba(129,140,248,0.25)' }}
              >
                {totalPending}
              </span>
            )}
          </div>
          <p className="text-sm mt-0.5" style={{ color: '#A1A1AA' }}>
            Review and respond to employee requests
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 mb-6 rounded-xl w-fit" style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={
              activeTab === tab.id
                ? { backgroundColor: '#818CF8', color: '#FFFFFF' }
                : { color: '#A1A1AA', backgroundColor: 'transparent' }
            }
            onMouseEnter={e => { if (activeTab !== tab.id) (e.currentTarget as HTMLElement).style.color = '#FAFAFA'; }}
            onMouseLeave={e => { if (activeTab !== tab.id) (e.currentTarget as HTMLElement).style.color = '#A1A1AA'; }}
          >
            {tab.label}
            {tab.count > 0 && (
              <span
                className="flex items-center justify-center text-xs font-semibold rounded-full min-w-[18px] h-4.5 px-1.5"
                style={
                  activeTab === tab.id
                    ? { backgroundColor: 'rgba(255,255,255,0.2)', color: '#FFFFFF' }
                    : { backgroundColor: 'rgba(129,140,248,0.15)', color: '#818CF8' }
                }
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Availability Requests Tab */}
      {activeTab === 'availability' && (
        <div className="space-y-4">
          {availRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 rounded-xl"
              style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46' }}>
              <ClipboardCheck size={36} style={{ color: '#3F3F46' }} />
              <div className="text-sm font-medium mt-3" style={{ color: '#71717A' }}>No availability requests</div>
              <div className="text-xs mt-1" style={{ color: '#71717A' }}>Employees haven't submitted any yet</div>
            </div>
          ) : (
            availRequests.map(req => {
              const status = availStatuses[req.id] ?? req.status ?? 'pending';
              return (
                <div
                  key={req.id}
                  className="rounded-xl p-5"
                  style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <EmployeeRow request={req} />
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                        style={{ backgroundColor: '#18181B', border: '1px solid #3F3F46', color: '#71717A' }}>
                        <Calendar size={10} />
                        Week of {safeFormatDate(req.week_start_date, 'MMM d')}
                      </div>
                      {status === 'pending' ? (
                        <ActionButtons
                          onApprove={() => void setAvailStatus(req.id, 'approved')}
                          onReject={() => void setAvailStatus(req.id, 'rejected')}
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <StatusBadge status={status} />
                          <button
                            onClick={() => setAvailStatuses(s => ({ ...s, [req.id]: 'pending' }))}
                            className="text-xs transition-colors"
                            style={{ color: '#71717A' }}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#A1A1AA'}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#71717A'}
                          >
                            Undo
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <AvailabilityGrid grid={req.availability_grid} />
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Time Off Tab */}
      {activeTab === 'timeoff' && (
        <div className="space-y-4">
          {timeOffRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 rounded-xl"
              style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46' }}>
              <ClipboardCheck size={36} style={{ color: '#3F3F46' }} />
              <div className="text-sm font-medium mt-3" style={{ color: '#71717A' }}>No time-off requests</div>
              <div className="text-xs mt-1" style={{ color: '#71717A' }}>All clear for this period</div>
            </div>
          ) : (
            timeOffRequests.map(req => {
              const status = timeOffStatuses[req.id] ?? req.status ?? 'pending';
              const sameDay = req.start_date === req.end_date;
              return (
                <div
                  key={req.id}
                  className="rounded-xl p-5"
                  style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <EmployeeRow request={req} />
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                        style={{ backgroundColor: '#18181B', border: '1px solid #3F3F46', color: '#71717A' }}>
                        <Calendar size={10} />
                        {sameDay
                          ? safeFormatDate(req.start_date, 'MMM d, yyyy')
                          : `${safeFormatDate(req.start_date, 'MMM d')} – ${safeFormatDate(req.end_date, 'MMM d, yyyy')}`}
                      </div>
                      {status === 'pending' ? (
                        <ActionButtons
                          onApprove={() => void setTimeOffStatus(req.id, 'approved')}
                          onReject={() => void setTimeOffStatus(req.id, 'rejected')}
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <StatusBadge status={status} />
                          <button
                            onClick={() => setTimeOffStatuses(s => ({ ...s, [req.id]: 'pending' }))}
                            className="text-xs transition-colors"
                            style={{ color: '#71717A' }}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#A1A1AA'}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#71717A'}
                          >
                            Undo
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {req.reason && (
                    <div className="mt-4 px-4 py-3 rounded-lg" style={{ backgroundColor: '#18181B', border: '1px solid #3F3F46' }}>
                      <p className="text-xs italic" style={{ color: '#A1A1AA' }}>"{req.reason}"</p>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
