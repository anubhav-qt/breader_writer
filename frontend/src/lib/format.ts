const DAY = 86_400_000;

type BucketKind = 'today' | 'yesterday' | 'weekday' | 'lastweek' | 'thismonth' | 'month' | 'year';
export interface Bucket { label: string; kind: BucketKind }

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Groups a timestamp by how long ago it was: today, yesterday, a weekday, a month, a year. */
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

/** "Played yesterday", "Made on Sunday", "Finished in August". */
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
