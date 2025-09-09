import { addMinutes } from "./time";

export type Prefs = {
  horizon_days: number;
  working_start: string; // "HH:MM"
  working_end: string;   // "HH:MM"
  workdays?: string[];   // ["Mon",...]
  min_block: number;
  max_block: number;
  buffer_minutes: number;
  max_daily_focus: number;
  include_weekends?: number;
};

export type TaskEst = {
  id: string;
  title: string;
  due?: string;
  durationMinutes: number;
  chunkMinutes: number;
  priority: number;
};

export type Interval = { start: Date; end: Date };

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (!intervals.length) return [];
  intervals.sort((a,b)=>a.start.getTime()-b.start.getTime());
  const out: Interval[] = [intervals[0]];
  for (let i=1;i<intervals.length;i++) {
    const prev = out[out.length-1];
    const cur = intervals[i];
    if (cur.start <= prev.end) {
      if (cur.end > prev.end) prev.end = cur.end;
    } else {
      out.push({ start: cur.start, end: cur.end });
    }
  }
  return out;
}

function subtractBusyFromWorkday(dayStart: Date, dayEnd: Date, busy: Interval[]): Interval[] {
  const free: Interval[] = [];
  let cursor = new Date(dayStart);
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start > cursor) {
      free.push({ start: new Date(cursor), end: new Date(Math.min(b.start.getTime(), dayEnd.getTime())) });
    }
    cursor = new Date(Math.max(cursor.getTime(), b.end.getTime()));
    if (cursor >= dayEnd) break;
  }
  if (cursor < dayEnd) free.push({ start: cursor, end: dayEnd });
  return free.filter(f => f.end > f.start);
}

export function computeFreeSlots(horizonStart: Date, horizonDays: number, tz: string, prefs: Prefs, busyAll: Interval[]): Array<{day: Date, slots: Interval[]}> {
  const result: Array<{day: Date, slots: Interval[]}> = [];
  const workdays = prefs.workdays || ['Mon','Tue','Wed','Thu','Fri'];
  for (let d=0; d<horizonDays; d++) {
    const day = new Date(horizonStart.getTime() + d*86400000);
    const wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day.getDay()];
    if (!prefs.include_weekends && !workdays.includes(wd)) {
      result.push({ day, slots: [] });
      continue;
    }
    const [sh, sm] = (prefs.working_start||'09:00').split(':').map(Number);
    const [eh, em] = (prefs.working_end||'17:00').split(':').map(Number);
    const dayStart = new Date(day); dayStart.setHours(sh||9, sm||0, 0, 0);
    const dayEnd = new Date(day); dayEnd.setHours(eh||17, em||0, 0, 0);

    const todaysBusy = busyAll.filter(b => b.start < dayEnd && b.end > dayStart).map(b => ({
      start: new Date(Math.max(b.start.getTime(), dayStart.getTime())),
      end: new Date(Math.min(b.end.getTime(), dayEnd.getTime()))
    }));
    const merged = mergeIntervals(todaysBusy);
    const free = subtractBusyFromWorkday(dayStart, dayEnd, merged);
    result.push({ day, slots: free });
  }
  return result;
}

export function planTasksIntoSlots(tasks: TaskEst[], slotsByDay: Array<{day: Date, slots: Interval[]}>, prefs: Prefs, tz: string): Array<{ taskId: string, start: Date, end: Date, chunkIndex: number, chunkCount: number }> {
  const scored = tasks.map(t => {
    let urgency = 0;
    if (t.due) {
      const due = new Date(t.due);
      urgency = Math.max(0, (7*86400000 - (due.getTime() - Date.now())) / 86400000);
    }
    return { t, score: t.priority * 10 + urgency };
  }).sort((a,b)=>b.score - a.score).map(x=>x.t);

  const placements: Array<{ taskId: string, start: Date, end: Date, chunkIndex: number, chunkCount: number }> = [];
  const perDayFocusUsed = new Map<number, number>();

  for (const task of scored) {
    const total = task.durationMinutes;
    const chunk = Math.max(prefs.min_block, Math.min(prefs.max_block, task.chunkMinutes));
    let remain = total;
    let chunkIndex = 0;
    const chunkCount = Math.ceil(total / chunk);

    for (let dayIdx=0; dayIdx<slotsByDay.length && remain > 0; dayIdx++) {
      const day = slotsByDay[dayIdx];
      const dayEpoch = new Date(day.day.getFullYear(), day.day.getMonth(), day.day.getDate()).getTime();
      const used = perDayFocusUsed.get(dayEpoch) || 0;
      const remainingCapacity = Math.max(0, prefs.max_daily_focus - used);
      if (remainingCapacity < prefs.min_block) continue;

      for (let sIdx=0; sIdx<day.slots.length && remain > 0; sIdx++) {
        const slot = day.slots[sIdx];
        let cursor = new Date(slot.start);
        while (cursor < slot.end && remain > 0) {
          const already = perDayFocusUsed.get(dayEpoch) || 0;
          const thisChunk = Math.min(chunk, remain, prefs.max_daily_focus - already);
          if (thisChunk < prefs.min_block) break;

          const end = addMinutes(cursor, thisChunk);
          if (end > slot.end) break;

          placements.push({ taskId: task.id, start: new Date(cursor), end, chunkIndex: chunkIndex+1, chunkCount });
          perDayFocusUsed.set(dayEpoch, already + thisChunk);
          remain -= thisChunk;
          chunkIndex++;
          cursor = end;
        }
      }
    }
  }

  return placements;
}
