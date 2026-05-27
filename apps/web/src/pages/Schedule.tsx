import { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, useSensors, useSensor,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import {
  ChevronLeft, ChevronRight, Sparkles, Send,
  Lock, CheckCircle2, Clock, GripVertical,
  Pencil, Users, Trash2, Plus, Unlock,
} from 'lucide-react';
import { format, addDays, addWeeks, subWeeks, parseISO } from 'date-fns';
import { mockShifts, mockSchedule, mockEmployees } from '../lib/mockData';
import type { Shift, Role, Employee } from '../lib/types';
import { supabase } from '../lib/supabase';
import { getExperienceBadgeClass, generateId } from '../lib/utils';

// ─── Constants ────────────────────────────────────────────────────────────────

const HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
const ROW_HEIGHT = 80;
const ROLES: Role[] = ['Cashier', 'Cook', 'Packliner'];
const ROLE_SHORT: Record<Role, string> = { Cashier: 'Cash', Cook: 'Cook', Packliner: 'Pack' };
const ROLE_COLOR: Record<Role, string> = { Cashier: '#818CF8', Cook: '#F87171', Packliner: '#34D399' };

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToastItem { id: string; message: string; type: 'success' | 'error'; }

interface CellDropData { type: 'cell'; dateStr: string; role: Role; hour: number; }
interface BlockDropData { type: 'block'; shiftId: string; }

type ContextMenuState =
  | { kind: 'empty'; dateStr: string; role: Role; hour: number; x: number; y: number; above: boolean }
  | { kind: 'occupied'; shift: Shift; x: number; y: number; above: boolean };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtH(h: number): string {
  if (h === 12) return '12 PM';
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}

function fmtHour(h: number): string {
  if (h === 12) return '12 PM';
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}

function getBlockColors(role: Role) {
  switch (role) {
    case 'Cashier':   return { bg: 'rgba(129,140,248,0.30)', hoverBg: 'rgba(129,140,248,0.46)', border: '#818CF8' };
    case 'Cook':      return { bg: 'rgba(248,113,113,0.30)', hoverBg: 'rgba(248,113,113,0.46)', border: '#F87171' };
    case 'Packliner': return { bg: 'rgba(52,211,153,0.30)',  hoverBg: 'rgba(52,211,153,0.46)',  border: '#34D399' };
  }
}

function getDisplayName(emp?: Employee): string {
  return emp?.preferred_name ?? emp?.name?.split(' ')[0] ?? 'Unassigned';
}

function getRoleCoverage(dateStr: string, role: Role, shifts: Shift[]): 'full' | 'partial' | 'none' {
  const rs = shifts.filter(s => s.date === dateStr && s.role === role);
  if (!rs.length) return 'none';
  let uncovered = 0;
  for (const h of HOURS) {
    if (!rs.some(s => parseInt(s.start_time) <= h && parseInt(s.end_time) > h)) uncovered++;
  }
  return uncovered === 0 ? 'full' : 'partial';
}

interface ShiftWithLane { shift: Shift; lane: number; maxLanes: number; }

function assignLanes(roleShifts: Shift[]): ShiftWithLane[] {
  const assigned: Array<{ shift: Shift; lane: number }> = [];
  for (const shift of roleShifts) {
    const s = parseInt(shift.start_time);
    const e = parseInt(shift.end_time);
    const occupied = new Set<number>();
    for (const { shift: o, lane } of assigned) {
      const os = parseInt(o.start_time), oe = parseInt(o.end_time);
      if (s < oe && e > os) occupied.add(lane);
    }
    let lane = 0;
    while (occupied.has(lane)) lane++;
    assigned.push({ shift, lane });
  }
  return assigned.map(({ shift, lane }) => {
    const s = parseInt(shift.start_time), e = parseInt(shift.end_time);
    let max = lane;
    for (const { shift: o, lane: ol } of assigned) {
      const os = parseInt(o.start_time), oe = parseInt(o.end_time);
      if (s < oe && e > os) max = Math.max(max, ol);
    }
    return { shift, lane, maxLanes: max + 1 };
  });
}

function getAvailableEmployees(role: Role, dateStr: string, hour: number, shifts: Shift[], excludeShiftId?: string): Employee[] {
  return mockEmployees.filter(emp => {
    if (!emp.role.includes(role)) return false;
    return !shifts.some(s =>
      s.id !== excludeShiftId && s.employee_id === emp.id && s.date === dateStr &&
      parseInt(s.start_time) <= hour && parseInt(s.end_time) > hour
    );
  });
}

// ─── Persistence ─────────────────────────────────────────────────────────────

async function persistShiftUpdate(id: string, updates: Record<string, unknown>): Promise<void> {
  if (!supabase) { await new Promise(r => setTimeout(r, 200)); return; }
  const { error } = await supabase.from('shifts').update(updates).eq('id', id);
  if (error) throw new Error(error.message);
}

async function persistShiftCreate(shift: Record<string, unknown>): Promise<void> {
  if (!supabase) { await new Promise(r => setTimeout(r, 200)); return; }
  const { error } = await supabase.from('shifts').insert(shift);
  if (error) throw new Error(error.message);
}

async function persistShiftDelete(id: string): Promise<void> {
  if (!supabase) { await new Promise(r => setTimeout(r, 200)); return; }
  const { error } = await supabase.from('shifts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
  if (!toasts.length) return null;
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 3000, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      <style>{`@keyframes _slideInT{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      {toasts.map(t => (
        <div key={t.id} style={{
          padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
          backgroundColor: t.type === 'success' ? '#27272A' : 'rgba(248,113,113,0.2)',
          border: `1px solid ${t.type === 'success' ? '#3F3F46' : 'rgba(248,113,113,0.3)'}`,
          color: t.type === 'success' ? '#FAFAFA' : '#F87171',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          animation: '_slideInT 0.2s ease',
        }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ─── ShiftHourPicker ──────────────────────────────────────────────────────────

function ShiftHourPicker({ value, onChange }: { value: number; onChange: (h: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ITEM_H = 30;
  const idx = Math.max(0, HOURS.indexOf(value));

  useLayoutEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = idx * ITEM_H;
  }, [idx]);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function handleScroll() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!containerRef.current) return;
      const i = Math.round(containerRef.current.scrollTop / ITEM_H);
      const clamped = Math.max(0, Math.min(HOURS.length - 1, i));
      if (HOURS[clamped] !== value) onChange(HOURS[clamped]);
    }, 60);
  }

  return (
    <div style={{ position: 'relative', width: 80 }}>
      <style>{`.shp::-webkit-scrollbar{display:none}`}</style>
      <div style={{
        position: 'absolute', top: ITEM_H, left: 4, right: 4, height: ITEM_H,
        backgroundColor: 'rgba(129,140,248,0.15)',
        borderTop: '1px solid #3F3F46', borderBottom: '1px solid #3F3F46',
        borderRadius: 4, pointerEvents: 'none', zIndex: 1,
      }} />
      <div
        ref={containerRef} className="shp" onScroll={handleScroll}
        style={{ height: ITEM_H * 3, overflowY: 'scroll', scrollbarWidth: 'none', scrollSnapType: 'y mandatory', backgroundColor: '#27272A', borderRadius: 8 }}
      >
        <div style={{ height: ITEM_H }} />
        {HOURS.map(h => (
          <div key={h} onClick={() => onChange(h)} style={{
            height: ITEM_H, display: 'flex', alignItems: 'center', justifyContent: 'center',
            scrollSnapAlign: 'center', cursor: 'pointer',
            color: h === value ? '#F1F5F9' : '#475569',
            fontSize: h === value ? 12 : 11, fontWeight: h === value ? 600 : 400,
          }}>
            {fmtH(h)}
          </div>
        ))}
        <div style={{ height: ITEM_H }} />
      </div>
    </div>
  );
}

// ─── DroppableCell ────────────────────────────────────────────────────────────

function DroppableCell({ id, data, top, height, isDragActive, onCellClick }: {
  id: string; data: CellDropData; top: number; height: number;
  isDragActive: boolean; onCellClick: (e: React.MouseEvent) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data });
  const [hovered, setHovered] = useState(false);
  return (
    <div
      ref={setNodeRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onCellClick}
      style={{
        position: 'absolute', top, height, left: 0, right: 0, boxSizing: 'border-box',
        backgroundColor: isOver
          ? 'rgba(129,140,248,0.12)'
          : isDragActive ? 'rgba(129,140,248,0.05)'
          : hovered ? 'rgba(63,63,70,0.5)' : 'transparent',
        border: isOver ? '1px dashed rgba(129,140,248,0.7)' : '1px solid transparent',
        cursor: isDragActive ? 'copy' : 'crosshair',
        transition: 'background-color 0.1s',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1, pointerEvents: 'auto',
      }}
    >
      {!isDragActive && hovered && <Plus size={9} style={{ color: '#475569', opacity: 0.5 }} />}
    </div>
  );
}

// ─── ShiftBlock ───────────────────────────────────────────────────────────────

function ShiftBlock({ shift, top, height, lane, maxLanes, isDragActive, activeId, onContextMenu }: {
  shift: Shift; top: number; height: number; lane: number; maxLanes: number;
  isDragActive: boolean; activeId: string | null;
  onContextMenu: (shift: Shift, e: React.MouseEvent) => void;
}) {
  const { attributes: shiftAttrs, listeners: shiftListeners, setNodeRef: setShiftRef, isDragging } =
    useDraggable({ id: `shift-${shift.id}`, data: { type: 'shift', shiftId: shift.id }, disabled: shift.is_locked });

  const { setNodeRef: setDropRef, isOver: isBlockOver } = useDroppable({
    id: `block-${shift.id}`,
    data: { type: 'block', shiftId: shift.id } as BlockDropData,
  });

  const { attributes: chipAttrs, listeners: chipListeners, setNodeRef: setChipRef } =
    useDraggable({ id: `chip-${shift.id}`, data: { type: 'chip', shiftId: shift.id } });

  const setBlockRef = useCallback((el: HTMLElement | null) => {
    setShiftRef(el); setDropRef(el);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [hovered, setHovered] = useState(false);
  const colors = getBlockColors(shift.role);
  const displayName = getDisplayName(shift.employee);
  const isUnassigned = !shift.employee_id;

  const outerPad = 2, laneGap = maxLanes > 1 ? 2 : 0;
  const availW = `(100% - ${outerPad * 2 + laneGap * (maxLanes - 1)}px)`;
  const blockLeft = `calc(${outerPad}px + ${lane} * (${availW} / ${maxLanes} + ${laneGap}px))`;
  const blockWidth = `calc(${availW} / ${maxLanes})`;

  if (isDragging) {
    return (
      <div ref={setBlockRef} style={{
        position: 'absolute', top: top + 3, height: Math.max(height - 6, 22),
        left: blockLeft, width: blockWidth,
        backgroundColor: '#27272A', border: '1px dashed #3F3F46',
        borderRadius: 4, opacity: 0.6, zIndex: 10,
      }} />
    );
  }

  const dimmed = isDragActive &&
    activeId !== `shift-${shift.id}` &&
    activeId !== `chip-${shift.id}`;

  return (
    <div
      ref={setBlockRef}
      {...shiftAttrs}
      style={{
        position: 'absolute', top: top + 3, height: Math.max(height - 6, 22),
        left: blockLeft, width: blockWidth,
        backgroundColor: isBlockOver ? colors.hoverBg : hovered ? colors.hoverBg : colors.bg,
        borderLeft: `3px solid ${colors.border}`,
        borderRadius: 4, overflow: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        transition: 'background-color 0.15s, opacity 0.2s',
        opacity: dimmed ? 0.4 : 1,
        pointerEvents: 'auto',
        cursor: shift.is_locked ? 'not-allowed' : 'default',
        zIndex: 10,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => { e.stopPropagation(); onContextMenu(shift, e); }}
    >
      {/* Shift drag grip — absolute top-left on hover */}
      {!shift.is_locked && (
        <div
          {...shiftListeners}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 3, left: 3,
            cursor: 'grab',
            opacity: hovered ? 0.7 : 0, transition: 'opacity 0.15s',
          }}
        >
          <GripVertical size={8} style={{ color: colors.border }} />
        </div>
      )}

      {/* Employee chip — name centered horizontally */}
      <div
        ref={setChipRef}
        {...chipAttrs}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          {...chipListeners}
          onPointerDown={(e) => { e.stopPropagation(); chipListeners?.onPointerDown?.(e as unknown as PointerEvent); }}
          onClick={(e) => e.stopPropagation()}
          style={{
            color: isUnassigned ? '#71717A' : '#FAFAFA',
            fontSize: 11, fontWeight: isUnassigned ? 400 : 700,
            fontStyle: isUnassigned ? 'italic' : 'normal',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '100%',
            padding: '0 6px',
            textAlign: 'center',
            display: 'block',
            cursor: !shift.is_locked ? 'grab' : 'default',
            letterSpacing: '-0.01em',
          }}
        >
          {displayName}
        </span>
      </div>

      {shift.is_locked && (
        <Lock size={8} style={{ color: colors.border, position: 'absolute', top: 4, right: 4 }} />
      )}
    </div>
  );
}

// ─── Drag previews ────────────────────────────────────────────────────────────

function ShiftDragPreview({ shift }: { shift: Shift }) {
  const colors = getBlockColors(shift.role);
  return (
    <div style={{
      width: 88, padding: '5px 8px',
      backgroundColor: colors.hoverBg, borderLeft: `2px solid ${colors.border}`,
      borderRadius: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.55)', cursor: 'grabbing',
    }}>
      <span style={{ color: '#F1F5F9', fontSize: 11, fontWeight: 600 }}>
        {getDisplayName(shift.employee)}
      </span>
    </div>
  );
}

function ChipDragPreview({ shift }: { shift: Shift }) {
  return (
    <div style={{
      padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
      backgroundColor: '#16161F', border: '1px solid #1E1E2A',
      color: '#F1F5F9', boxShadow: '0 4px 16px rgba(0,0,0,0.45)', cursor: 'grabbing',
    }}>
      {getDisplayName(shift.employee)}
    </div>
  );
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

type OccupiedMode = 'view' | 'edit' | 'reassign' | 'confirm-remove';
type EmptyStep = 'pick-employee' | 'pick-time';

function ContextMenuPopover({ state, shifts, onClose, onCreateShift, onUpdateShift, onRemoveShift }: {
  state: ContextMenuState;
  shifts: Shift[];
  onClose: () => void;
  onCreateShift: (s: Shift) => void;
  onUpdateShift: (id: string, updates: Partial<Shift>) => void;
  onRemoveShift: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function down(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [onClose]);

  useEffect(() => {
    function key(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const [emptyStep, setEmptyStep] = useState<EmptyStep>('pick-employee');
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [newStart, setNewStart] = useState(state.kind === 'empty' ? state.hour : 10);
  const [newEnd, setNewEnd] = useState(state.kind === 'empty' ? Math.min(22, state.hour + 8) : 18);

  const initShift = state.kind === 'occupied' ? state.shift : null;
  const [occMode, setOccMode] = useState<OccupiedMode>('view');
  const [editStart, setEditStart] = useState(initShift ? parseInt(initShift.start_time) : 10);
  const [editEnd, setEditEnd] = useState(initShift ? parseInt(initShift.end_time) : 18);
  const [editRole, setEditRole] = useState<Role>(initShift?.role ?? 'Cashier');

  const posY = state.above
    ? { bottom: window.innerHeight - state.y + 8 }
    : { top: state.y + 8 };

  const baseStyle: React.CSSProperties = {
    position: 'fixed', left: Math.min(state.x, window.innerWidth - 240),
    ...posY,
    zIndex: 2000, backgroundColor: '#27272A', border: '1px solid #3F3F46',
    borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', minWidth: 220, overflow: 'hidden',
  };

  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
    cursor: 'pointer', fontSize: 13, color: '#FAFAFA', transition: 'background-color 0.1s',
  };

  const backBtn = (label: string, onClick: () => void) => (
    <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid #3F3F46', display: 'flex', alignItems: 'center', gap: 8 }}>
      <button onClick={onClick} style={{ background: 'none', border: 'none', color: '#71717A', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}>‹</button>
      <span style={{ fontSize: 11, color: '#A1A1AA' }}>{label}</span>
    </div>
  );

  if (state.kind === 'empty') {
    const { dateStr, role, hour } = state;
    const available = getAvailableEmployees(role, dateStr, hour, shifts);

    return (
      <div ref={ref} style={baseStyle}>
        <div style={{ padding: '9px 12px 7px', borderBottom: '1px solid #3F3F46' }}>
          <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#71717A' }}>
            {format(new Date(dateStr + 'T12:00:00'), 'EEE, MMM d')} · {fmtH(hour)} · {ROLE_SHORT[role]}
          </div>
        </div>

        {emptyStep === 'pick-employee' ? (
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {available.length === 0 ? (
              <div style={{ padding: '20px 12px', textAlign: 'center', color: '#71717A', fontSize: 12 }}>
                No available staff for this time
              </div>
            ) : available.map(emp => (
              <div
                key={emp.id}
                style={row}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#1E1E2A'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                onClick={() => { setSelectedEmp(emp); setEmptyStep('pick-time'); }}
              >
                <span style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{emp.name}</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getExperienceBadgeClass(emp.experience_level)}`}>
                  {emp.experience_level}
                </span>
              </div>
            ))}
          </div>
        ) : selectedEmp && (
          <div style={{ padding: '12px' }}>
            {backBtn(`${selectedEmp.name.split(' ')[0]}`, () => setEmptyStep('pick-employee'))}
            <div style={{ height: 8 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 12 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: '#71717A', marginBottom: 4, letterSpacing: '0.06em' }}>START</div>
                <ShiftHourPicker value={newStart} onChange={h => { setNewStart(h); if (h >= newEnd) setNewEnd(Math.min(22, h + 1)); }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', color: '#71717A', fontSize: 14 }}>–</div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: '#71717A', marginBottom: 4, letterSpacing: '0.06em' }}>END</div>
                <ShiftHourPicker value={newEnd} onChange={h => { setNewEnd(h); if (h <= newStart) setNewStart(Math.max(10, h - 1)); }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setEmptyStep('pick-employee')}
                style={{ flex: 1, padding: '7px', borderRadius: 6, border: '1px solid #3F3F46', backgroundColor: 'transparent', color: '#71717A', fontSize: 12, cursor: 'pointer' }}
              >Back</button>
              <button
                onClick={() => {
                  const ns: Shift = {
                    id: generateId(), schedule_id: mockSchedule.id,
                    employee_id: selectedEmp.id, employee: selectedEmp,
                    role, date: dateStr,
                    start_time: `${newStart}:00`, end_time: `${newEnd}:00`,
                    is_locked: false,
                    shift_type: newStart < 14 ? 'morning' : newStart < 18 ? 'afternoon' : 'evening',
                  };
                  onCreateShift(ns);
                }}
                style={{ flex: 1, padding: '7px', borderRadius: 6, border: 'none', backgroundColor: '#818CF8', color: '#FFFFFF', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >Confirm</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const shift = state.shift;

  if (occMode === 'view') {
    const hdr = `${getDisplayName(shift.employee)} · ${shift.role} · ${fmtH(parseInt(shift.start_time))} – ${fmtH(parseInt(shift.end_time))}`;
    const options = [
      { label: 'Edit Shift',        icon: <Pencil size={15} style={{ color: '#71717A' }} />,                                         action: () => setOccMode('edit') },
      { label: 'Reassign Employee', icon: <Users size={15} style={{ color: '#71717A' }} />,                                          action: () => setOccMode('reassign') },
      { label: shift.is_locked ? 'Unlock Shift' : 'Lock Shift',
        icon: shift.is_locked ? <Unlock size={15} style={{ color: '#71717A' }} /> : <Lock size={15} style={{ color: '#71717A' }} />,
        action: () => onUpdateShift(shift.id, { is_locked: !shift.is_locked }),
      },
      { label: 'Remove Shift', icon: <Trash2 size={15} style={{ color: '#F87171' }} />, action: () => setOccMode('confirm-remove'), red: true },
    ];
    return (
      <div ref={ref} style={baseStyle}>
        <div style={{ padding: '9px 12px 7px', borderBottom: '1px solid #3F3F46' }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: '#A1A1AA' }}>{hdr}</div>
        </div>
        {options.map(({ label, icon, action, red }) => (
          <div
            key={label}
            style={{ ...row, color: red ? '#F87171' : '#F1F5F9' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#3F3F46'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
            onClick={action}
          >
            {icon}{label}
          </div>
        ))}
      </div>
    );
  }

  if (occMode === 'edit') {
    return (
      <div ref={ref} style={baseStyle}>
        {backBtn('Edit Shift', () => setOccMode('view'))}
        <div style={{ padding: '12px' }}>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 12 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: '#71717A', marginBottom: 4, letterSpacing: '0.06em' }}>START</div>
              <ShiftHourPicker value={editStart} onChange={h => { setEditStart(h); if (h >= editEnd) setEditEnd(Math.min(22, h + 1)); }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', color: '#71717A', fontSize: 14 }}>–</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: '#71717A', marginBottom: 4, letterSpacing: '0.06em' }}>END</div>
              <ShiftHourPicker value={editEnd} onChange={h => { setEditEnd(h); if (h <= editStart) setEditStart(Math.max(10, h - 1)); }} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: '#71717A', marginBottom: 6, letterSpacing: '0.06em' }}>ROLE</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {ROLES.map(r => (
                <button key={r} onClick={() => setEditRole(r)} style={{
                  flex: 1, padding: '5px 2px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                  border: `1px solid ${editRole === r ? ROLE_COLOR[r] : '#3F3F46'}`,
                  backgroundColor: editRole === r ? `${ROLE_COLOR[r]}25` : 'transparent',
                  color: editRole === r ? ROLE_COLOR[r] : '#71717A',
                }}>
                  {ROLE_SHORT[r]}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => onUpdateShift(shift.id, { start_time: `${editStart}:00`, end_time: `${editEnd}:00`, role: editRole })}
            style={{ width: '100%', padding: '7px', borderRadius: 6, border: 'none', backgroundColor: '#818CF8', color: '#FFFFFF', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >Save</button>
        </div>
      </div>
    );
  }

  if (occMode === 'reassign') {
    const available = getAvailableEmployees(shift.role, shift.date, parseInt(shift.start_time), shifts, shift.id);
    return (
      <div ref={ref} style={baseStyle}>
        {backBtn('Reassign Employee', () => setOccMode('view'))}
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {available.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: '#71717A', fontSize: 12 }}>
              No available staff for this time
            </div>
          ) : available.map(emp => (
            <div
              key={emp.id}
              style={row}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#1E1E2A'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              onClick={() => onUpdateShift(shift.id, { employee_id: emp.id, employee: emp } as unknown as Partial<Shift>)}
            >
              <span style={{ flex: 1, fontSize: 12 }}>{emp.name}</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getExperienceBadgeClass(emp.experience_level)}`}>
                {emp.experience_level}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} style={baseStyle}>
      <div style={{ padding: '12px' }}>
        <div style={{ fontSize: 12, color: '#A1A1AA', marginBottom: 12 }}>Remove this shift?</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setOccMode('view')}
            style={{ flex: 1, padding: '7px', borderRadius: 6, border: '1px solid #3F3F46', backgroundColor: 'transparent', color: '#71717A', fontSize: 12, cursor: 'pointer' }}
          >Cancel</button>
          <button
            onClick={() => onRemoveShift(shift.id)}
            style={{ flex: 1, padding: '7px', borderRadius: 6, border: '1px solid rgba(248,113,113,0.3)', backgroundColor: 'rgba(248,113,113,0.2)', color: '#F87171', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >Yes, remove</button>
        </div>
      </div>
    </div>
  );
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

function exportClearviewCsv(shifts: Shift[], weekDays: Date[]) {
  const rows = [['Date', 'Employee', 'Role', 'Start', 'End']];
  for (const day of weekDays) {
    const ds = format(day, 'yyyy-MM-dd');
    for (const s of shifts.filter(s => s.date === ds)) {
      rows.push([ds, s.employee?.name ?? s.employee_id, s.role, s.start_time, s.end_time]);
    }
  }
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `clearview-${format(weekDays[0], 'yyyy-MM-dd')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Schedule Page ────────────────────────────────────────────────────────────

export default function Schedule() {
  const [weekStart, setWeekStart] = useState(new Date('2024-05-20'));
  const [shifts, setShifts] = useState<Shift[]>(mockShifts);
  const [schedule, setSchedule] = useState(mockSchedule);
  const [generating, setGenerating] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const activeShift = activeId
    ? shifts.find(s => s.id === activeId.replace('shift-', '').replace('chip-', ''))
    : null;

  function addToast(message: string, type: 'success' | 'error') {
    const id = generateId();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 2200);
  }

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(active.id.toString());
    setContextMenu(null);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (!over) return;

    const aType = active.data.current?.type as string | undefined;
    const oType = over.data.current?.type as string | undefined;

    if (aType === 'shift' && oType === 'cell') {
      const shiftId = active.id.toString().replace('shift-', '');
      const shift = shifts.find(s => s.id === shiftId);
      if (!shift) return;

      const { dateStr, role, hour } = over.data.current as CellDropData;
      const hasLocked = shifts.some(s =>
        s.id !== shiftId && s.date === dateStr && s.role === role && s.is_locked &&
        parseInt(s.start_time) <= hour && parseInt(s.end_time) > hour
      );
      if (hasLocked) { addToast('This shift is locked', 'error'); return; }

      const duration = parseInt(shift.end_time) - parseInt(shift.start_time);
      const newStart = hour, newEnd = Math.min(22, hour + duration);
      const updates = { date: dateStr, role, start_time: `${newStart}:00`, end_time: `${newEnd}:00` };

      const prev = [...shifts];
      setShifts(s => s.map(x => x.id === shiftId ? { ...x, ...updates } : x));
      addToast('Shift updated', 'success');
      persistShiftUpdate(shiftId, updates).catch(() => {
        setShifts(prev);
        addToast('Failed to update shift — changes reverted', 'error');
      });
    }

    if (aType === 'chip' && oType === 'block') {
      const srcId = active.id.toString().replace('chip-', '');
      const { shiftId: tgtId } = over.data.current as BlockDropData;
      if (srcId === tgtId) return;
      const src = shifts.find(s => s.id === srcId);
      const tgt = shifts.find(s => s.id === tgtId);
      if (!src || !tgt || src.role !== tgt.role) return;

      const prev = [...shifts];
      setShifts(s => s.map(x => {
        if (x.id === srcId) return { ...x, employee_id: tgt.employee_id, employee: tgt.employee };
        if (x.id === tgtId) return { ...x, employee_id: src.employee_id, employee: src.employee };
        return x;
      }));
      addToast('Employees swapped', 'success');
      Promise.all([
        persistShiftUpdate(srcId, { employee_id: tgt.employee_id }),
        persistShiftUpdate(tgtId, { employee_id: src.employee_id }),
      ]).catch(() => { setShifts(prev); addToast('Failed to update shift — changes reverted', 'error'); });
    }

    if (aType === 'chip' && oType === 'cell') {
      const srcId = active.id.toString().replace('chip-', '');
      const src = shifts.find(s => s.id === srcId);
      if (!src) return;
      const { dateStr, role, hour } = over.data.current as CellDropData;
      const ns: Shift = {
        id: generateId(), schedule_id: mockSchedule.id,
        employee_id: src.employee_id, employee: src.employee,
        role, date: dateStr,
        start_time: `${hour}:00`, end_time: `${Math.min(22, hour + 8)}:00`,
        is_locked: false,
        shift_type: hour < 14 ? 'morning' : hour < 18 ? 'afternoon' : 'evening',
      };
      const prev = [...shifts];
      setShifts(s => [...s.map(x => x.id === srcId ? { ...x, employee_id: '', employee: undefined } : x), ns]);
      addToast('Employee reassigned', 'success');
      const { employee: _e, ...nsData } = ns;
      persistShiftCreate(nsData as unknown as Record<string, unknown>).catch(() => {
        setShifts(prev); addToast('Failed to update shift — changes reverted', 'error');
      });
    }
  }

  function openContextMenu(shift: Shift | null, dateStr: string, role: Role, hour: number, e: React.MouseEvent) {
    const x = Math.min(e.clientX, window.innerWidth - 250);
    const y = e.clientY;
    const above = y > window.innerHeight * 0.65;
    if (shift) {
      setContextMenu({ kind: 'occupied', shift, x, y, above });
    } else {
      setContextMenu({ kind: 'empty', dateStr, role, hour, x, y, above });
    }
  }

  function handleUpdateShift(id: string, updates: Partial<Shift>) {
    const prev = [...shifts];
    setShifts(s => s.map(x => x.id === id ? { ...x, ...updates } : x));
    setContextMenu(null);
    addToast('Shift updated', 'success');
    const { employee: _e, ...dbUpdates } = updates as Shift;
    persistShiftUpdate(id, dbUpdates as unknown as Record<string, unknown>).catch(() => {
      setShifts(prev); addToast('Failed to update shift — changes reverted', 'error');
    });
  }

  function handleCreateShift(ns: Shift) {
    const prev = [...shifts];
    setShifts(s => [...s, ns]);
    setContextMenu(null);
    addToast('Shift added', 'success');
    const { employee: _e, ...data } = ns;
    persistShiftCreate(data as unknown as Record<string, unknown>).catch(() => {
      setShifts(prev); addToast('Failed to add shift — changes reverted', 'error');
    });
  }

  function handleRemoveShift(id: string) {
    const prev = [...shifts];
    setShifts(s => s.filter(x => x.id !== id));
    setContextMenu(null);
    addToast('Shift removed', 'success');
    persistShiftDelete(id).catch(() => {
      setShifts(prev); addToast('Failed to update shift — changes reverted', 'error');
    });
  }

  function handleGenerate() {
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      setSchedule(s => ({ ...s, status: 'draft', generated_at: new Date().toISOString() }));
    }, 2200);
  }

  function handlePublish() { setSchedule(s => ({ ...s, status: 'published' })); }
  function handlePublishAndExport() { handlePublish(); exportClearviewCsv(shifts, weekDays); }

  const isDragActive = activeId !== null;
  const gridCols = '80px repeat(21, 1fr)';

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: '#FAFAFA' }}>Schedule</h1>
            <p className="text-sm mt-0.5" style={{ color: '#A1A1AA' }}>Manage and publish your weekly shift schedule</p>
          </div>
          <div className="flex items-center gap-2">
            {schedule.status === 'draft' && (
              <button
                onClick={handlePublishAndExport}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ backgroundColor: '#818CF8', color: '#FFFFFF' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#6366F1'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#818CF8'}
              >
                <Send size={15} />Publish &amp; Export to Clearview
              </button>
            )}
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{ backgroundColor: '#818CF8', color: '#FFFFFF', opacity: generating ? 0.75 : 1 }}
              onMouseEnter={e => { if (!generating) (e.currentTarget as HTMLElement).style.backgroundColor = '#6366F1'; }}
              onMouseLeave={e => { if (!generating) (e.currentTarget as HTMLElement).style.backgroundColor = '#818CF8'; }}
            >
              {generating
                ? <><span className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(255,255,255,0.25)', borderTopColor: '#FFFFFF' }} />Generating smart schedule...</>
                : <><Sparkles size={15} />Generate Schedule</>}
            </button>
          </div>
        </div>

        {/* Week nav + status */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-lg p-1" style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46' }}>
              <button
                onClick={() => setWeekStart(w => subWeeks(w, 1))}
                className="p-1.5 rounded-md transition-colors" style={{ color: '#A1A1AA' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#3F3F46'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              ><ChevronLeft size={16} /></button>
              <span className="text-sm font-medium px-2" style={{ color: '#FAFAFA', minWidth: 180, textAlign: 'center' }}>
                {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}
              </span>
              <button
                onClick={() => setWeekStart(w => addWeeks(w, 1))}
                className="p-1.5 rounded-md transition-colors" style={{ color: '#A1A1AA' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#3F3F46'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              ><ChevronRight size={16} /></button>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ backgroundColor: 'rgba(129,140,248,0.15)', color: '#818CF8', border: '1px solid rgba(129,140,248,0.25)' }}
              >
                {schedule.status === 'published' ? <CheckCircle2 size={11} /> : <Clock size={11} />}
                {schedule.status === 'published' ? 'Published' : 'Draft'}
              </span>
              <span className="text-xs" style={{ color: '#71717A' }}>
                Last generated: {format(parseISO(schedule.generated_at), 'MMM d, h:mm a')}
              </span>
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}>

          {/* Header row 1: Day names */}
          <div style={{ display: 'grid', gridTemplateColumns: gridCols, borderBottom: '1px solid #3F3F46' }}>
            <div style={{ borderRight: '1px solid #3F3F46' }} />
            {weekDays.map((day, i) => {
              const isToday = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
              return (
                <div key={i} style={{ gridColumn: 'span 3', textAlign: 'center', padding: '8px 4px 6px', borderRight: i < 6 ? '1px solid rgba(63,63,70,0.8)' : undefined }}>
                  <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#71717A' }}>
                    {format(day, 'EEE')}
                  </div>
                  <div style={{
                    fontSize: 13, fontWeight: 600, marginTop: 2,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 24, height: 24, borderRadius: '50%',
                    color: isToday ? '#FFFFFF' : '#FAFAFA',
                    backgroundColor: isToday ? '#818CF8' : 'transparent',
                  }}>
                    {format(day, 'd')}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Header row 2: Role sub-column labels + coverage dots */}
          <div style={{ display: 'grid', gridTemplateColumns: gridCols, borderBottom: '1px solid #3F3F46' }}>
            <div style={{ borderRight: '1px solid #3F3F46' }} />
            {weekDays.map((day, dayIdx) => {
              const dateStr = format(day, 'yyyy-MM-dd');
              return ROLES.map((role, roleIdx) => {
                const cov = getRoleCoverage(dateStr, role, shifts);
                const isLast = roleIdx === 2;
                const br = isLast && dayIdx < 6 ? '1px solid rgba(63,63,70,0.8)' : !isLast ? '1px solid #3F3F46' : undefined;
                return (
                  <div key={`rh-${dayIdx}-${roleIdx}`} style={{ padding: '4px 2px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, borderRight: br }}>
                    <span style={{ fontSize: 9, fontWeight: 500, color: ROLE_COLOR[role] }}>{ROLE_SHORT[role]}</span>
                    {cov === 'full'    && <div style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: '#34D399' }} />}
                    {cov === 'partial' && <div style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: '#FBBF24' }} />}
                    {cov === 'none'    && <div style={{ fontSize: 7, fontWeight: 700, padding: '1px 3px', borderRadius: 2, backgroundColor: 'rgba(248,113,113,0.2)', color: '#F87171' }}>!</div>}
                  </div>
                );
              });
            })}
          </div>

          {/* Grid body */}
          <div style={{ position: 'relative', height: HOURS.length * ROW_HEIGHT }}>

            {/* Layer 0: Background grid lines */}
            <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
              {HOURS.map((hour, rowIdx) => (
                <div key={hour} style={{ display: 'grid', gridTemplateColumns: gridCols, height: ROW_HEIGHT, borderBottom: rowIdx < HOURS.length - 1 ? '1px solid #3F3F46' : undefined }}>
                  <div style={{ borderRight: '1px solid #3F3F46', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', padding: '8px 10px 0 0' }}>
                    <span style={{ color: '#71717A', fontSize: 11, fontWeight: 500 }}>{fmtHour(hour)}</span>
                  </div>
                  {weekDays.map((_, dayIdx) =>
                    ROLES.map((_r, roleIdx) => {
                      const isLast = roleIdx === 2;
                      const br = isLast && dayIdx < 6 ? '1px solid rgba(63,63,70,0.8)' : !isLast ? '1px solid #3F3F46' : undefined;
                      return <div key={`bg-${dayIdx}-${roleIdx}`} style={{ borderRight: br }} />;
                    })
                  )}
                </div>
              ))}
            </div>

            {/* Layer 5: Droppable cells */}
            <div style={{ position: 'absolute', top: 0, left: 80, right: 0, bottom: 0, zIndex: 5, pointerEvents: 'none', display: 'grid', gridTemplateColumns: 'repeat(21, 1fr)' }}>
              {weekDays.map((day, dayIdx) => {
                const dateStr = format(day, 'yyyy-MM-dd');
                return ROLES.map((role, roleIdx) => (
                  <div key={`dc-${dayIdx}-${roleIdx}`} style={{ position: 'relative', height: '100%', pointerEvents: 'none' }}>
                    {getRoleCoverage(dateStr, role, shifts) === 'none' && (
                      <div style={{
                        position: 'absolute', top: 0, bottom: 0, left: '50%', transform: 'translateX(-50%)',
                        width: 1, backgroundImage: 'repeating-linear-gradient(to bottom,rgba(248,113,113,0.45) 0,rgba(248,113,113,0.45) 4px,transparent 4px,transparent 8px)',
                        zIndex: 0, pointerEvents: 'none',
                      }} />
                    )}
                    {HOURS.map((hour, hIdx) => (
                      <DroppableCell
                        key={`${dateStr}-${role}-${hour}`}
                        id={`cell-${dateStr}-${role}-${hour}`}
                        data={{ type: 'cell', dateStr, role, hour }}
                        top={hIdx * ROW_HEIGHT}
                        height={ROW_HEIGHT}
                        isDragActive={isDragActive}
                        onCellClick={(e) => openContextMenu(null, dateStr, role, hour, e)}
                      />
                    ))}
                  </div>
                ));
              })}
            </div>

            {/* Layer 10: Shift blocks */}
            <div style={{ position: 'absolute', top: 0, left: 80, right: 0, bottom: 0, zIndex: 10, pointerEvents: 'none', display: 'grid', gridTemplateColumns: 'repeat(21, 1fr)' }}>
              {weekDays.map((day, dayIdx) => {
                const dateStr = format(day, 'yyyy-MM-dd');
                return ROLES.map((role, roleIdx) => {
                  const roleShifts = shifts.filter(s => s.date === dateStr && s.role === role);
                  const laned = assignLanes(roleShifts);
                  return (
                    <div key={`sl-${dayIdx}-${roleIdx}`} style={{ position: 'relative', height: '100%', pointerEvents: 'none' }}>
                      {laned.map(({ shift, lane, maxLanes }) => {
                        const startH = parseInt(shift.start_time), endH = parseInt(shift.end_time);
                        return (
                          <ShiftBlock
                            key={shift.id}
                            shift={shift}
                            top={(startH - 10) * ROW_HEIGHT}
                            height={(endH - startH) * ROW_HEIGHT}
                            lane={lane}
                            maxLanes={maxLanes}
                            isDragActive={isDragActive}
                            activeId={activeId}
                            onContextMenu={(s, e) => openContextMenu(s, dateStr, role, startH, e)}
                          />
                        );
                      })}
                    </div>
                  );
                });
              })}
            </div>

          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18,0.67,0.6,1.22)' }}>
        {activeId?.startsWith('shift-') && activeShift ? <ShiftDragPreview shift={activeShift} /> : null}
        {activeId?.startsWith('chip-') && activeShift ? <ChipDragPreview shift={activeShift} /> : null}
      </DragOverlay>

      {contextMenu && (
        <ContextMenuPopover
          state={contextMenu}
          shifts={shifts}
          onClose={() => setContextMenu(null)}
          onCreateShift={handleCreateShift}
          onUpdateShift={handleUpdateShift}
          onRemoveShift={handleRemoveShift}
        />
      )}

      <ToastContainer toasts={toasts} />
    </DndContext>
  );
}
