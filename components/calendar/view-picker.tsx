"use client";

import { useRouter } from "next/navigation";

/** Month, week, day or agenda, in a drop-down that applies itself. */
export function ViewPicker({ view, date }: { view: string; date: string }) {
  const router = useRouter();
  return (
    <select aria-label="Calendar view" value={view} onChange={(e) => router.push(`/calendar?view=${e.target.value}&date=${date}`)}>
      <option value="month">Month</option>
      <option value="week">Week</option>
      <option value="day">Day</option>
      <option value="agenda">Agenda</option>
    </select>
  );
}
