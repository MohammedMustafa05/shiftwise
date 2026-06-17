import { useState } from 'react';
import type { OverrideReason } from '@shiftagent/shared';

const REASONS: { value: OverrideReason; label: string; description: string }[] = [
  {
    value: 'new_permanent_preference',
    label: 'New permanent preference',
    description: 'This change should apply to future schedules.',
  },
  {
    value: 'one_time_exception',
    label: 'One-time exception',
    description: 'Only for this week — do not learn from this.',
  },
  {
    value: 'event_special_occasion',
    label: 'Event / special occasion',
    description: 'Temporary change for a special event.',
  },
  {
    value: 'fixing_ai_mistake',
    label: 'Fixing AI mistake',
    description: 'The AI suggestion was wrong — help it learn what not to do.',
  },
];

type Props = {
  employeeName: string;
  onConfirm: (reason: OverrideReason, notes: string) => void;
  onCancel: () => void;
};

export function OverrideReasonPicker({ employeeName, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState<OverrideReason>('one_time_exception');
  const [notes, setNotes] = useState('');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ backgroundColor: 'rgba(24,24,27,0.8)' }}>
      <div
        className="rounded-xl shadow-xl w-full max-w-md mx-4 p-5"
        style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46' }}
      >
        <h3 className="text-sm font-semibold mb-1" style={{ color: '#FAFAFA' }}>
          Why are you changing this shift?
        </h3>
        <p className="text-xs mb-4" style={{ color: '#A1A1AA' }}>
          Editing AI-suggested shift for {employeeName}. Your reason helps improve future suggestions.
        </p>

        <div className="space-y-2 mb-4">
          {REASONS.map((r) => (
            <label
              key={r.value}
              className="flex items-start gap-3 p-3 rounded-lg cursor-pointer"
              style={{
                backgroundColor: reason === r.value ? 'rgba(129,140,248,0.12)' : '#18181B',
                border: `1px solid ${reason === r.value ? '#818CF8' : '#3F3F46'}`,
              }}
            >
              <input
                type="radio"
                name="override-reason"
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm font-medium" style={{ color: '#FAFAFA' }}>{r.label}</div>
                <div className="text-xs" style={{ color: '#71717A' }}>{r.description}</div>
              </div>
            </label>
          ))}
        </div>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes…"
          rows={2}
          className="w-full px-3 py-2 rounded-lg text-sm mb-4 outline-none resize-none"
          style={{ backgroundColor: '#18181B', border: '1px solid #3F3F46', color: '#FAFAFA' }}
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ color: '#A1A1AA', border: '1px solid #3F3F46' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason, notes)}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: '#818CF8', color: '#FFFFFF' }}
          >
            Save with reason
          </button>
        </div>
      </div>
    </div>
  );
}
