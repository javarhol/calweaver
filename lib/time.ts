export function parseHM(hm: string): {h:number,m:number} {
  const [h,m] = hm.split(':').map(Number);
  return {h, m: m ?? 0};
}
export function startOfDay(date: Date): Date {
  const d = new Date(date); d.setHours(0,0,0,0); return d;
}
export function endOfDay(date: Date): Date {
  const d = new Date(date); d.setHours(23,59,59,999); return d;
}
export function addMinutes(d: Date, mins: number): Date {
  return new Date(d.getTime() + mins*60000);
}
export function overlap(a1: Date, a2: Date, b1: Date, b2: Date): boolean {
  return a1 < b2 && b1 < a2;
}
export function weekdayStr(d: Date): string {
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
}
export function clampToWorkday(d1: Date, d2: Date, startHM: string, endHM: string, tz: string): {s: Date, e: Date} {
  // For MVP, assume server local time equals user tz (Workers run UTC; we treat times as ISO strings with tz offset from Google)
  return { s: d1, e: d2 };
}
