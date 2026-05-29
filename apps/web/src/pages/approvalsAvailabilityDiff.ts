import type {
  AvailabilityBlockSummary,
  AvailabilityRequest,
  DayKey,
} from '../lib/types';
import { DAY_FULL, DAY_KEYS } from '../lib/utils';

export type DayDiffStatus = 'unchanged' | 'added' | 'changed' | 'removed' | 'empty';

export type DayDiff = {
  status: DayDiffStatus;
  block: AvailabilityBlockSummary | null;
  previousBlock: AvailabilityBlockSummary | null;
};

export type AvailabilityDiffResult = {
  isFirstSubmission: boolean;
  byDay: Record<DayKey, DayDiff>;
};

const BLOCK_ALIASES: Record<string, string> = {
  morning: 'morning',
  evening: 'evening',
  afternoon: 'evening',
  'full day': 'full',
  full: 'full',
  'day off': 'off',
  off: 'off',
};

function normalizeBlockName(block: string): string {
  return BLOCK_ALIASES[block.trim().toLowerCase()] ?? block.trim().toLowerCase();
}

function dayKeyFromLabel(day: string): DayKey | null {
  const lower = day.trim().toLowerCase();
  const fromFull = (Object.entries(DAY_FULL) as [DayKey, string][]).find(
    ([, label]) => label.toLowerCase() === lower,
  );
  if (fromFull) return fromFull[0];
  if ((DAY_KEYS as string[]).includes(lower)) return lower as DayKey;
  return null;
}

function inferBlockFromHours(day: DayKey, hours: string[]): AvailabilityBlockSummary | null {
  if (!hours?.length) return null;
  const sorted = [...hours].sort();
  const has = (h: string) => sorted.includes(h);
  const isWeekend = day === 'saturday' || day === 'sunday';

  const morningHours = isWeekend
    ? ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']
    : ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00'];
  const eveningHours = isWeekend
    ? ['17:00', '18:00', '19:00', '20:00', '21:00', '22:00']
    : ['16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];

  const matches = (expected: string[]) =>
    expected.length === sorted.length && expected.every((h) => has(h));

  if (matches(morningHours)) {
    return {
      day: DAY_FULL[day],
      block: 'Morning',
      timeRange: isWeekend ? '10:00 AM – 5:00 PM' : '10:00 AM – 4:00 PM',
    };
  }
  if (matches(eveningHours)) {
    return {
      day: DAY_FULL[day],
      block: 'Evening',
      timeRange: isWeekend ? '5:00 PM – 10:00 PM' : '4:00 PM – 10:00 PM',
    };
  }
  if (sorted.length >= 10) {
    return {
      day: DAY_FULL[day],
      block: 'Full Day',
      timeRange: isWeekend ? '10:00 AM – 10:00 PM' : '10:00 AM – 10:00 PM',
    };
  }
  return {
    day: DAY_FULL[day],
    block: 'Availability',
    timeRange: `${sorted[0]} – ${sorted[sorted.length - 1]}`,
  };
}

function blockForDay(req: AvailabilityRequest, day: DayKey): AvailabilityBlockSummary | null {
  const full = DAY_FULL[day];
  const fromBlocks = req.availability_blocks?.find((b) => {
    const key = dayKeyFromLabel(b.day);
    return key === day;
  });
  if (fromBlocks) {
    const norm = normalizeBlockName(fromBlocks.block);
    if (norm === 'off') return null;
    return fromBlocks;
  }
  return inferBlockFromHours(day, req.availability_grid?.[day] ?? []);
}

function blockSignature(block: AvailabilityBlockSummary | null): string {
  if (!block) return '';
  return `${normalizeBlockName(block.block)}|${block.timeRange}`;
}

/** Approved submissions, newest first (as returned by the API). */
export function getPreviousApprovedForRequest(
  current: AvailabilityRequest,
  approved: AvailabilityRequest[],
): AvailabilityRequest | undefined {
  return approved.find(
    (row) =>
      row.employee_id === current.employee_id &&
      row.id !== current.id &&
      row.status === 'approved',
  );
}

export function compareAvailabilityToPrevious(
  current: AvailabilityRequest,
  previous: AvailabilityRequest | undefined,
): AvailabilityDiffResult {
  if (!previous) {
    return {
      isFirstSubmission: true,
      byDay: Object.fromEntries(
        DAY_KEYS.map((day) => {
          const block = blockForDay(current, day);
          return [
            day,
            {
              status: block ? ('added' as const) : ('empty' as const),
              block,
              previousBlock: null,
            },
          ];
        }),
      ) as Record<DayKey, DayDiff>,
    };
  }

  const byDay = {} as Record<DayKey, DayDiff>;
  for (const day of DAY_KEYS) {
    const cur = blockForDay(current, day);
    const prev = blockForDay(previous, day);
    const curSig = blockSignature(cur);
    const prevSig = blockSignature(prev);

    let status: DayDiffStatus;
    if (!prev && !cur) {
      status = 'empty';
    } else if (prev && !cur) {
      status = 'removed';
    } else if (!prev && cur) {
      status = 'added';
    } else if (curSig !== prevSig) {
      status = 'changed';
    } else {
      status = 'unchanged';
    }

    byDay[day] = { status, block: cur, previousBlock: prev };
  }

  return { isFirstSubmission: false, byDay };
}

export function isDiffHighlightBlock(diff: DayDiff): boolean {
  return diff.status === 'added' || diff.status === 'changed';
}
