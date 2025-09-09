export function nowIso(): string {
  return new Date().toISOString();
}
export function toEpochSeconds(d: Date): number { return Math.floor(d.getTime() / 1000); }
export function fromEpochSeconds(s: number): Date { return new Date(s * 1000); }
export function genId(prefix = "id"): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
export function assert(cond: any, msg: string) {
  if (!cond) throw new Error(msg);
}
