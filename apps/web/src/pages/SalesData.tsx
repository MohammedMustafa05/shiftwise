import { useState, useMemo, useEffect } from 'react';
import {
  BarChart2, ChevronLeft, ChevronRight, Save, RefreshCw,
  TrendingUp, DollarSign, CheckCircle2,
} from 'lucide-react';
import { format, parseISO, addWeeks, subWeeks } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { mockSalesData } from '../lib/mockData';
import { api, isApiConfigured } from '../lib/api';
import { useWorkplaceId } from '../hooks/useEmployerApi';
import { format as fmtDate } from 'date-fns';
import type { SalesData } from '../lib/types';

const WEEK_START = '2024-05-20';
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);

function formatHour(h: number): string {
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:00 ${suffix}`;
}

function formatCurrency(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg px-3 py-2" style={{
      backgroundColor: '#27272A', border: '1px solid #3F3F46',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    }}>
      <div className="text-xs font-medium mb-0.5" style={{ color: '#A1A1AA' }}>{label}</div>
      <div className="text-sm font-semibold" style={{ color: '#FAFAFA' }}>
        {formatCurrency(payload[0].value)}
      </div>
    </div>
  );
}

export default function Sales() {
  const workplaceId = useWorkplaceId();
  const [weekStart, setWeekStart] = useState(new Date(WEEK_START));
  const [activeDayIdx, setActiveDayIdx] = useState(0);
  const [salesData, setSalesData] = useState<SalesData[]>(isApiConfigured ? [] : mockSalesData);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const weekStr = fmtDate(weekStart, 'yyyy-MM-dd');

  useEffect(() => {
    if (!isApiConfigured || !workplaceId) return;
    void api.getSales(workplaceId, weekStr).then(data => {
      if (data.length) setSalesData(data);
    }).catch(() => undefined);
  }, [workplaceId, weekStr]);

  const weekLabel = `${format(weekStart, 'MMM d')} – ${format(new Date(weekStart.getTime() + 6 * 86400000), 'MMM d, yyyy')}`;

  const chartData = useMemo(() =>
    salesData.map((sd, i) => ({
      day: DAY_LABELS[i],
      total: Object.values(sd.hourly_sales).reduce((a, b) => a + b, 0),
      isActive: i === activeDayIdx,
    })),
    [salesData, activeDayIdx]
  );

  const activeDay = salesData[activeDayIdx];
  const weekTotal = chartData.reduce((a, d) => a + d.total, 0);
  const dayTotal = activeDay
    ? Object.values(activeDay.hourly_sales).reduce((a, b) => a + b, 0)
    : 0;
  const avgDaily = salesData.length > 0 ? weekTotal / salesData.length : 0;

  function updateHourSales(hour: number, val: number) {
    setSalesData(prev => prev.map((sd, i) =>
      i !== activeDayIdx ? sd : {
        ...sd,
        hourly_sales: { ...sd.hourly_sales, [String(hour)]: val },
      }
    ));
  }

  async function handleCsvUpload(file: File) {
    if (!workplaceId) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const activeDate = salesData[activeDayIdx]?.date ?? weekStr;
      const isClearviewXls = file.name.toLowerCase().endsWith('.xls');
      const result = await api.uploadSalesCsv(
        workplaceId,
        file,
        isClearviewXls ? activeDate : undefined
      );
      setUploadMsg(
        `Imported ${result.rowsAccepted} rows` +
          (result.format ? ` (${result.format})` : '') +
          (result.rowsRejected ? ` · ${result.rowsRejected} skipped` : '') +
          (result.dateRange.from ? ` · ${result.dateRange.from} to ${result.dateRange.to}` : '')
      );
      const data = await api.getSales(workplaceId, weekStr);
      if (data.length) setSalesData(data);
    } catch {
      setUploadMsg(
        'Upload failed — use CSV (date/hour/sales), drop chart CSV, or Clearview .xls (requires active day date)'
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (isApiConfigured && workplaceId) {
        await api.saveSales(workplaceId, weekStr, salesData);
      } else {
        await new Promise(r => setTimeout(r, 800));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-8">
      {uploadMsg && (
        <p className="text-sm mb-4" style={{ color: '#A1A1AA' }}>{uploadMsg}</p>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: '#FAFAFA' }}>Sales Data</h1>
          <p className="text-sm mt-0.5" style={{ color: '#A1A1AA' }}>
            Enter or review hourly sales — used to optimize rush-hour staffing
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {isApiConfigured && workplaceId && (
            <label
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all"
              style={{
                backgroundColor: '#27272A',
                color: '#FAFAFA',
                border: '1px solid #3F3F46',
                opacity: uploading ? 0.6 : 1,
              }}
            >
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                disabled={uploading}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) void handleCsvUpload(f);
                  e.target.value = '';
                }}
              />
              {uploading ? 'Uploading…' : 'Upload CSV'}
            </label>
          )}
          <button
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ backgroundColor: '#3F3F46', color: '#FAFAFA' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#3F3F46'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#3F3F46'}
          >
            <RefreshCw size={14} />
            Sync from POS
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ backgroundColor: saved ? '#8A9E6E' : '#C9A96E', color: '#09090B', opacity: saving ? 0.75 : 1 }}
            onMouseEnter={e => { if (!saving && !saved) (e.currentTarget as HTMLElement).style.backgroundColor = '#B8944A'; }}
            onMouseLeave={e => { if (!saving && !saved) (e.currentTarget as HTMLElement).style.backgroundColor = '#C9A96E'; }}
          >
            {saving ? (
              <><span className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(18,16,14,0.25)', borderTopColor: '#09090B' }} />Saving…</>
            ) : saved ? (
              <><CheckCircle2 size={14} />Saved</>
            ) : (
              <><Save size={14} />Save Data</>
            )}
          </button>
        </div>
      </div>

      {/* Week Navigator */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-1 rounded-lg p-1" style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46' }}>
          <button
            onClick={() => setWeekStart(w => subWeeks(w, 1))}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: '#A1A1AA' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#3F3F46'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-medium px-2" style={{ color: '#FAFAFA', minWidth: 200, textAlign: 'center' }}>
            {weekLabel}
          </span>
          <button
            onClick={() => setWeekStart(w => addWeeks(w, 1))}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: '#A1A1AA' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#3F3F46'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Week Total', value: formatCurrency(weekTotal), icon: DollarSign, color: '#C9A96E', bg: '#C9A96E20' },
          { label: 'Daily Average', value: formatCurrency(avgDaily), icon: TrendingUp, color: '#8A9E6E', bg: 'rgba(138,158,110,0.125)' },
          { label: `${DAY_LABELS[activeDayIdx]} Revenue`, value: formatCurrency(dayTotal), icon: BarChart2, color: '#C9A96E', bg: '#C9A96E20' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="flex items-center gap-4 rounded-xl px-5 py-4"
            style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
            <div className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0" style={{ backgroundColor: bg }}>
              <Icon size={18} style={{ color }} />
            </div>
            <div>
              <div className="text-xl font-semibold" style={{ color: '#FAFAFA' }}>{value}</div>
              <div className="text-xs mt-0.5" style={{ color: '#A1A1AA' }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-4">
        {/* Left: day selector + hourly table */}
        <div className="col-span-2 flex flex-col gap-4">
          {/* Day tabs */}
          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46' }}>
            {salesData.map((sd, i) => {
              const dayTotal = Object.values(sd.hourly_sales).reduce((a, b) => a + b, 0);
              const isActive = i === activeDayIdx;
              return (
                <button
                  key={sd.id}
                  onClick={() => setActiveDayIdx(i)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left transition-all"
                  style={{
                    backgroundColor: isActive ? 'rgba(201,169,110,0.065)' : 'transparent',
                    borderLeft: isActive ? '2px solid #C9A96E' : '2px solid transparent',
                    borderBottom: i < salesData.length - 1 ? '1px solid #3F3F46' : undefined,
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(18,16,14,0.5)'; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                >
                  <div>
                    <div className="text-sm font-medium" style={{ color: isActive ? '#C9A96E' : '#FAFAFA' }}>
                      {DAY_LABELS[i]}
                    </div>
                    <div className="text-xs" style={{ color: '#7A6A58' }}>
                      {format(parseISO(sd.date), 'MMM d')}
                    </div>
                  </div>
                  <div className="text-sm font-semibold" style={{ color: isActive ? '#C9A96E' : '#A1A1AA' }}>
                    {formatCurrency(dayTotal)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: hourly table + chart */}
        <div className="col-span-3 flex flex-col gap-4">
          {/* Chart */}
          <div className="rounded-xl p-5" style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
            <div className="text-sm font-medium mb-4" style={{ color: '#FAFAFA' }}>Daily Sales — Week of {format(weekStart, 'MMM d')}</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} barSize={32} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3F3F46" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fill: '#7A6A58', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#7A6A58', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(74,59,46,0.31)' }} />
                <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.isActive ? '#C9A96E' : '#3F3F46'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Hourly table */}
          {activeDay && (
            <div className="rounded-xl overflow-hidden" style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #3F3F46' }}>
                <div className="text-sm font-medium" style={{ color: '#FAFAFA' }}>
                  Hourly Breakdown — {DAY_LABELS[activeDayIdx]}
                </div>
                <div className="text-xs" style={{ color: '#7A6A58' }}>
                  {format(parseISO(activeDay.date), 'MMMM d, yyyy')}
                </div>
              </div>
              <div className="max-h-[340px] overflow-y-auto">
                {HOURS.map((h, idx) => {
                  const val = activeDay.hourly_sales[String(h)] ?? 0;
                  const isPeak = (h >= 11 && h <= 14) || (h >= 17 && h <= 20);
                  return (
                    <div
                      key={h}
                      className="flex items-center px-4 py-2 gap-4"
                      style={{ borderBottom: idx < HOURS.length - 1 ? '1px solid #3F3F46' : undefined }}
                    >
                      <div className="w-20 flex items-center gap-1.5 shrink-0">
                        <span className="text-xs" style={{ color: '#A1A1AA' }}>{formatHour(h)}</span>
                        {isPeak && (
                          <span className="text-xs px-1 py-0.5 rounded" style={{ backgroundColor: 'rgba(201,169,110,0.082)', color: '#C9A96E', fontSize: 9 }}>
                            peak
                          </span>
                        )}
                      </div>
                      <div className="flex-1 flex items-center gap-3">
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#7A6A58' }}>$</span>
                          <input
                            type="number"
                            value={val}
                            min={0}
                            onChange={e => updateHourSales(h, Number(e.target.value))}
                            className="w-full pl-6 pr-3 py-1.5 rounded-lg text-sm outline-none transition-all"
                            style={{ backgroundColor: '#09090B', border: '1px solid #3F3F46', color: '#FAFAFA' }}
                            onFocus={e => { e.target.style.border = '1px solid #C9A96E'; }}
                            onBlur={e => { e.target.style.border = '1px solid #3F3F46'; }}
                          />
                        </div>
                        <div
                          className="w-24 h-1.5 rounded-full overflow-hidden shrink-0"
                          style={{ backgroundColor: '#3F3F46' }}
                        >
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, (val / 1000) * 100)}%`,
                              backgroundColor: '#C9A96E',
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
