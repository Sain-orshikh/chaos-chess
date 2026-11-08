import Image from 'next/image';
import { badgeById } from '@/lib/badges';

export default function BadgeStrip({ ids = [], label = 'Equipped badges' }: { ids?: string[]; label?: string }) {
  const visible = [...new Set(ids)].filter(id => badgeById.has(id)).slice(0, 3);
  if (!visible.length) return null;
  return <span className="badge-strip" role="group" aria-label={label}>{visible.map(id => {
    const badge = badgeById.get(id)!;
    return <Image key={id} src={badge.artwork} width={34} height={39} alt={badge.name} title={badge.name} />;
  })}</span>;
}

export function BadgeUnlocks({ awards }: { awards?: Record<string, string> }) {
  const ids = Object.keys(awards || {}).filter(id => badgeById.has(id));
  if (!ids.length) return null;
  return <div className="badge-unlocks" role="status"><strong>{ids.length === 1 ? 'Badge earned' : 'Badges earned'}</strong><div>{ids.map(id => {
    const badge = badgeById.get(id)!;
    return <span key={id}><Image src={badge.artwork} width={34} height={39} alt="" />{badge.name}</span>;
  })}</div></div>;
}
