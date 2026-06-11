/** Hours [start, end) covered by a shift on a calendar day (handles end at midnight). */
export function hoursCoveredByShift(startTime: string, endTime: string): number[] {
  const startH = parseInt(startTime.slice(0, 2), 10);
  let endH = parseInt(endTime.slice(0, 2), 10);
  const endM = parseInt(endTime.slice(3, 5) || "0", 10);
  if (endH === 0 && endM === 0) endH = 24;
  if (endH <= startH) endH += 24;
  const hours: number[] = [];
  for (let h = startH; h < endH; h++) {
    hours.push(h >= 24 ? h - 24 : h);
  }
  return hours;
}

export function shiftCoversHour(startTime: string, endTime: string, hour: number): boolean {
  return hoursCoveredByShift(startTime, endTime).includes(hour);
}
