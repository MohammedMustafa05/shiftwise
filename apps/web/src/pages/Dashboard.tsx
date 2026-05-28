import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, TrendingDown,
  Sparkles, ClipboardCheck, UserPlus, ArrowRight, CheckCircle2,
  CalendarDays, Edit3, Bell, Zap,
} from 'lucide-react';
import { format, addDays, parseISO, startOfWeek } from 'date-fns';
import { mockShifts, mockActivity, mockAvailabilityRequests, mockTimeOffRequests } from '../lib/mockData';
import type { Shift, ActivityItem } from '../lib/types';
import { getRoleBadgeClass } from '../lib/utils';
import { api, isApiConfigured, loadScheduleWithEmployees } from '../lib/api';
import { useEmployees, useWorkplaceId } from '../hooks/useEmployerApi';

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type LaborSummary = {
  scheduledHours: number;
  laborCost: number;
  laborBudget: number;
  laborCostPct: number;
};

function LaborCard({ summary }: { summary: LaborSummary }) {
  const delta = summary.laborCost - summary.laborBudget;
  const isOver = delta > 0;
  const targetPercent = 25;
  const overBy = summary.laborCostPct - targetPercent;
  const barColor = overBy <= 0 ? '#34D399' : overBy <= 2 ? '#FBBF24' : '#F87171';
  const barWidth = Math.min((summary.laborCostPct / targetPercent) * 100, 100);

  return (
    <div
      className="rounded-xl flex items-center gap-8 px-8 py-6"
      style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}
    >
      <div className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0" style={{ backgroundColor: 'rgba(129,140,248,0.15)' }}>
        <TrendingUp size={18} style={{ color: '#818CF8' }} />
      </div>

      <div className="shrink-0">
        <div className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: '#71717A', letterSpacing: '0.06em' }}>
          Scheduled Hours
        </div>
        <div className="text-3xl font-bold" style={{ color: '#FAFAFA' }}>{summary.scheduledHours} hrs</div>
      </div>

      <div style={{ width: 1, alignSelf: 'stretch', backgroundColor: '#3F3F46', flexShrink: 0 }} />

      <div className="flex gap-8 flex-1 min-w-0">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="text-xs font-medium uppercase tracking-wider" style={{ color: '#71717A', letterSpacing: '0.06em' }}>
            Labor Cost
          </div>
          <div className="text-sm font-medium" style={{ color: '#FAFAFA' }}>${summary.laborCost.toLocaleString()}</div>
          <span
            className="inline-flex items-center self-start px-2.5 py-0.5 rounded-full text-xs font-medium mt-0.5"
            style={{
              backgroundColor: isOver ? 'rgba(248,113,113,0.15)' : 'rgba(52,211,153,0.15)',
              color: isOver ? '#F87171' : '#34D399',
            }}
          >
            Budget ${summary.laborBudget.toLocaleString()}
          </span>
        </div>

        <div className="flex flex-col gap-1" style={{ minWidth: 120 }}>
          <div className="text-xs font-medium uppercase tracking-wider" style={{ color: '#71717A', letterSpacing: '0.06em' }}>
            Labor %
          </div>
          <div className="text-2xl font-bold" style={{ color: '#FAFAFA' }}>{summary.laborCostPct}%</div>
          <div className="text-xs" style={{ color: '#71717A' }}>Target: {targetPercent}%</div>
          <div style={{ height: 4, backgroundColor: '#3F3F46', borderRadius: 9999, overflow: 'hidden', marginTop: 2 }}>
            <div style={{ width: `${barWidth}%`, height: '100%', backgroundColor: barColor, borderRadius: 9999 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  badge?: 'warning';
}

function StatCard({ title, value, icon: Icon, iconColor, iconBg, trend, trendValue, badge }: StatCardProps) {
  return (
    <div
      className="rounded-xl p-6 flex flex-col gap-4"
      style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg" style={{ backgroundColor: iconBg }}>
          <Icon size={18} style={{ color: iconColor }} />
        </div>
        {badge === 'warning' && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(129,140,248,0.125)', color: '#818CF8' }}>
            Action needed
          </span>
        )}
      </div>
      <div>
        <div className="text-2xl font-semibold" style={{ color: '#FAFAFA' }}>{value}</div>
        <div className="text-sm mt-0.5" style={{ color: '#A1A1AA' }}>{title}</div>
        {(trend || trendValue) && (
          <div className="flex items-center gap-1.5 mt-2">
            {trend === 'up' && <TrendingUp size={13} style={{ color: '#34D399' }} />}
            {trend === 'down' && <TrendingDown size={13} style={{ color: '#F87171' }} />}
            <span className="text-xs" style={{ color: trend === 'up' ? '#34D399' : trend === 'down' ? '#F87171' : '#71717A' }}>
              {trendValue}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function WeekSchedulePreview({ shifts, weekDates }: { shifts: Shift[]; weekDates: Date[] }) {
  function getStatus(count: number) {
    if (count >= 4) return { color: '#34D399' };
    if (count >= 2) return { color: '#FBBF24' };
    return { color: '#F87171' };
  }

  function fmtTime(t: string) {
    const [h, m] = t.split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
  }

  function getDisplayName(shift: Shift) {
    return shift.employee?.preferred_name ?? shift.employee?.name?.split(' ')[0] ?? 'Unknown';
  }

  const columns = weekDates.map((date, i) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayShifts = shifts.filter(s => s.date === dateStr);
    return {
      label: WEEK_DAYS[i],
      date: format(date, 'M/d'),
      shifts: dayShifts,
      status: getStatus(dayShifts.length),
    };
  });

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
      {columns.map(({ label, date, shifts: dayShifts, status }) => (
        <div key={label} className="flex flex-col">
          <div className="flex items-center gap-1.5 mb-2">
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: status.color, boxShadow: `0 0 5px ${status.color}60` }}
            />
            <div>
              <div className="text-xs font-medium" style={{ color: '#A1A1AA' }}>{label}</div>
              <div className="text-xs" style={{ color: '#71717A' }}>{date}</div>
            </div>
          </div>

          <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 220 }}>
            {dayShifts.length === 0 ? (
              <div
                className="rounded-lg py-4 flex items-center justify-center"
                style={{ border: '1px dashed #3F3F46' }}
              >
                <span className="text-xs text-center" style={{ color: '#71717A' }}>No staff scheduled</span>
              </div>
            ) : (
              dayShifts.map(shift => (
                <div
                  key={shift.id}
                  className="rounded-lg px-3 py-2 flex flex-col gap-1.5"
                  style={{ backgroundColor: '#18181B', border: '1px solid #3F3F46' }}
                >
                  <div className="text-sm font-medium" style={{ color: '#FAFAFA' }}>
                    {getDisplayName(shift)}
                  </div>
                  <div className="text-xs" style={{ color: '#A1A1AA' }}>
                    {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
                  </div>
                  <span className={`inline-flex items-center self-start px-1.5 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeClass(shift.role)}`}>
                    {shift.role}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityIcon({ type }: { type: string }) {
  const map: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
    schedule_generated: { icon: Sparkles,      color: '#818CF8', bg: 'rgba(129,140,248,0.15)' },
    employee_approved:  { icon: CheckCircle2,  color: '#34D399', bg: 'rgba(52,211,153,0.125)' },
    schedule_published: { icon: CalendarDays,  color: '#34D399', bg: 'rgba(52,211,153,0.125)' },
    employee_added:     { icon: UserPlus,      color: '#818CF8', bg: 'rgba(129,140,248,0.15)'  },
    shift_edited:       { icon: Edit3,         color: '#A1A1AA', bg: '#3F3F46'                 },
  };
  const item = map[type] ?? map.shift_edited;
  const Icon = item.icon;
  return (
    <div className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0" style={{ backgroundColor: item.bg }}>
      <Icon size={14} style={{ color: item.color }} />
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const workplaceId = useWorkplaceId();
  const { employees } = useEmployees();
  const [generatingSchedule, setGeneratingSchedule] = useState(false);

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekStr = format(weekStart, 'yyyy-MM-dd');

  const [labor, setLabor] = useState<LaborSummary>({
    scheduledHours: 142,
    laborCost: 3200,
    laborBudget: 3450,
    laborCostPct: 24.6,
  });
  const [pendingCount, setPendingCount] = useState(
    mockAvailabilityRequests.filter(r => r.status === 'pending').length
      + mockTimeOffRequests.filter(r => r.status === 'pending').length
  );
  const [shifts, setShifts] = useState<Shift[]>(mockShifts);
  const [activity, setActivity] = useState<ActivityItem[]>(mockActivity);

  useEffect(() => {
    if (!isApiConfigured || !workplaceId) return;
    void (async () => {
      try {
        const [summary, activityItems, scheduleDetail] = await Promise.all([
          api.getDashboardSummary(weekStr),
          api.getActivity(),
          api.getScheduleByWeek(workplaceId, weekStr),
        ]);
        setLabor({
          scheduledHours: summary.scheduledHours,
          laborCost: summary.laborCost,
          laborBudget: summary.laborBudget,
          laborCostPct: summary.laborCostPct,
        });
        setPendingCount(summary.pendingApprovals);
        setActivity(activityItems.map(a => ({
          id: a.id,
          type: a.type as ActivityItem['type'],
          message: a.message,
          timestamp: a.timestamp,
          actor: a.actor ?? undefined,
        })));
        if (scheduleDetail) {
          const mapped = loadScheduleWithEmployees(scheduleDetail, employees);
          setShifts(mapped.shifts);
        } else {
          setShifts([]);
        }
      } catch {
        /* keep mocks */
      }
    })();
  }, [workplaceId, weekStr, employees]);

  const actionFlags = [
    ...(pendingCount > 0
      ? [{ id: 'approvals', message: `${pendingCount} approval request${pendingCount > 1 ? 's' : ''} pending review`, severity: 'warning' as const, route: '/approvals' }]
      : []),
    { id: 'schedule', message: 'Review or publish this week\'s schedule', severity: 'neutral' as const, route: '/schedule' },
    { id: 'sales', message: 'Update sales data for accurate staffing', severity: 'warning' as const, route: '/sales' },
  ];

  async function handleGenerate() {
    setGeneratingSchedule(true);
    try {
      if (isApiConfigured) {
        await api.generateSchedule(weekStr);
      } else {
        await new Promise(r => setTimeout(r, 1800));
      }
      navigate('/schedule');
    } catch {
      /* stay on page */
    } finally {
      setGeneratingSchedule(false);
    }
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: '#FAFAFA' }}>Dashboard</h1>
          <p className="text-sm mt-0.5" style={{ color: '#A1A1AA' }}>
            Week of {format(weekStart, 'MMMM d')} — {format(addDays(weekStart, 6), 'MMMM d, yyyy')}
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generatingSchedule}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
          style={{ backgroundColor: '#818CF8', color: '#FFFFFF' }}
          onMouseEnter={e => { if (!generatingSchedule) (e.currentTarget as HTMLElement).style.backgroundColor = '#6366F1'; }}
          onMouseLeave={e => { if (!generatingSchedule) (e.currentTarget as HTMLElement).style.backgroundColor = '#818CF8'; }}
        >
          {generatingSchedule ? (
            <>
              <span className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(255,255,255,0.25)', borderTopColor: '#FFFFFF' }} />
              Generating...
            </>
          ) : (
            <>
              <Sparkles size={15} />
              Generate Schedule
            </>
          )}
        </button>
      </div>

      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <LaborCard summary={labor} />
        <StatCard
          title="Pending Approvals"
          value={pendingCount}
          icon={ClipboardCheck}
          iconColor="#818CF8"
          iconBg="rgba(129,140,248,0.15)"
          badge={pendingCount > 0 ? 'warning' : undefined}
          trend="neutral"
          trendValue={pendingCount > 0 ? 'Requires your review' : 'All caught up'}
        />
      </div>

      <div className="rounded-xl p-6 mb-4" style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-medium" style={{ color: '#FAFAFA' }}>Weekly Schedule Preview</div>
            <div className="text-xs mt-0.5" style={{ color: '#A1A1AA' }}>Staffing status at a glance</div>
          </div>
          <button
            onClick={() => navigate('/schedule')}
            className="flex items-center gap-1.5 text-xs font-medium transition-colors"
            style={{ color: '#818CF8' }}
          >
            View full schedule <ArrowRight size={12} />
          </button>
        </div>
        <WeekSchedulePreview shifts={shifts} weekDates={weekDates} />
        <div className="flex items-center gap-5 mt-4">
          {[
            { color: '#34D399', label: 'Fully staffed' },
            { color: '#FBBF24', label: 'Understaffed' },
            { color: '#F87171', label: 'No schedule' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs" style={{ color: '#71717A' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl p-6 flex flex-col" style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Bell size={15} style={{ color: '#818CF8' }} />
            <div className="text-sm font-medium" style={{ color: '#FAFAFA' }}>Action Required</div>
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto">
            {actionFlags.map(flag => (
              <button
                key={flag.id}
                onClick={() => navigate(flag.route)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-left transition-all group"
                style={{ backgroundColor: 'transparent' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#18181B'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: flag.severity === 'warning' ? '#FBBF24' : '#71717A' }}
                  />
                  <span className="text-xs leading-relaxed" style={{ color: '#A1A1AA' }}>{flag.message}</span>
                </div>
                <ArrowRight size={12} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#818CF8' }} />
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl p-6" style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
          <div className="text-sm font-medium mb-4" style={{ color: '#FAFAFA' }}>Recent Activity</div>
          <div className="space-y-3">
            {activity.length === 0 ? (
              <p className="text-xs" style={{ color: '#71717A' }}>No recent activity</p>
            ) : activity.map(item => (
              <div key={item.id} className="flex items-start gap-3">
                <ActivityIcon type={item.type} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs" style={{ color: '#FAFAFA' }}>{item.message}</div>
                  <div className="text-xs mt-0.5" style={{ color: '#71717A' }}>
                    {format(parseISO(item.timestamp), 'MMM d, h:mm a')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl p-6" style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
          <div className="text-sm font-medium mb-4" style={{ color: '#FAFAFA' }}>Quick Actions</div>
          <div className="space-y-3">
            {[
              {
                label: 'Generate Schedule',
                desc: 'Auto-assign employees for this week',
                icon: Zap,
                color: '#818CF8',
                bg: 'rgba(129,140,248,0.15)',
                action: handleGenerate,
              },
              {
                label: 'Review Approvals',
                desc: `${pendingCount} request${pendingCount !== 1 ? 's' : ''} awaiting your decision`,
                icon: ClipboardCheck,
                color: '#818CF8',
                bg: 'rgba(129,140,248,0.15)',
                action: () => navigate('/approvals'),
              },
              {
                label: 'Add Employee',
                desc: 'Onboard a new team member',
                icon: UserPlus,
                color: '#34D399',
                bg: 'rgba(52,211,153,0.125)',
                action: () => navigate('/employees'),
              },
            ].map(({ label, desc, icon: Icon, color, bg, action }) => (
              <button
                key={label}
                onClick={action}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all text-left"
                style={{ backgroundColor: '#18181B', border: '1px solid #3F3F46' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = '#818CF8'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = '#3F3F46'}
              >
                <div className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0" style={{ backgroundColor: bg }}>
                  <Icon size={16} style={{ color }} />
                </div>
                <div>
                  <div className="text-sm font-medium" style={{ color: '#FAFAFA' }}>{label}</div>
                  <div className="text-xs mt-0.5" style={{ color: '#71717A' }}>{desc}</div>
                </div>
                <ArrowRight size={14} className="ml-auto" style={{ color: '#71717A' }} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
