/** Reading speed used for every time estimate. */
export const WPM = 230;
const DAY = 86_400_000;

export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h >= 10 || r === 0 ? `${h} h` : `${h} h ${r} min`;
}

export const minutesFor = (words: number) => words / WPM;

type BucketKind = 'today' | 'yesterday' | 'weekday' | 'lastweek' | 'thismonth' | 'month' | 'year';
export interface Bucket { label: string; kind: BucketKind }

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Groups a timestamp the way the time stack's timeline labels it. */
export function bucket(t: number, now: number): Bucket {
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  const d = new Date(t);
  const n = new Date(now);
  if (days <= 0) return { label: 'Today', kind: 'today' };
  if (days === 1) return { label: 'Yesterday', kind: 'yesterday' };
  if (days < 7) return { label: d.toLocaleDateString('en-GB', { weekday: 'long' }), kind: 'weekday' };
  if (days < 14) return { label: 'Last week', kind: 'lastweek' };
  if (d.getFullYear() === n.getFullYear()) {
    if (d.getMonth() === n.getMonth()) return { label: 'This month', kind: 'thismonth' };
    return { label: d.toLocaleDateString('en-GB', { month: 'long' }), kind: 'month' };
  }
  return { label: String(d.getFullYear()), kind: 'year' };
}

/** "Read yesterday", "Added on Sunday", "Finished in August". */
export function whenPhrase(verb: string, t: number, now: number): string {
  const b = bucket(t, now);
  switch (b.kind) {
    case 'today':
    case 'yesterday':
    case 'lastweek':
    case 'thismonth':
      return `${verb} ${b.label.toLowerCase()}`;
    case 'weekday':
      return `${verb} on ${b.label}`;
    default:
      return `${verb} in ${b.label}`;
  }
}

export function countWords(text: string): number {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const space = c === 32 || c === 10 || c === 9 || c === 13 || c === 160;
    if (!space && !inWord) n++;
    inWord = !space;
  }
  return n;
}
