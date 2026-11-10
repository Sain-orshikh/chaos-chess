import catalog from '../../public/badges/manifest.json';
import type { AchievementState, User } from './api';

export const badges = catalog.badges;
export const badgeById = new Map(badges.map(badge => [badge.id, badge]));
export function mergeAchievements(user: User | null, state?: AchievementState | null): User | null {
  if (!user || !state || user._id !== state.userId) return user;
  const newer = !user.statsUpdatedAt || (state.statsUpdatedAt && Date.parse(state.statsUpdatedAt) >= Date.parse(user.statsUpdatedAt));
  return {
    ...user,
    ...(newer ? { elo: state.elo, matches: state.matches, wins: state.wins, statsUpdatedAt: state.statsUpdatedAt, badgeProgress: state.badgeProgress } : {}),
    badges: { ...user.badges, ...state.badges },
  };
}
export function badgeProgressLabel(id: string, user: User): string | null {
  const progress = user.badgeProgress;
  switch (id) {
    case 'first-blood': return `${Math.min(user.wins || 0, 1)} / 1 win`;
    case 'getting-dangerous': return `${Math.min(user.wins || 0, 10)} / 10 wins`;
    case 'centurion': return `${Math.min(user.wins || 0, 100)} / 100 wins`;
    case 'on-the-rise': return `${user.elo} / 600 Elo`;
    case 'four-figures': return `${user.elo} / 1,000 Elo`;
    case 'by-the-book': return `${Math.min(progress?.classicWins || 0, 10)} / 10 Classic wins`;
    case 'chaos-theory': return `${Math.min(progress?.chaosWins || 0, 10)} / 10 Havoc wins`;
    case 'hat-trick': return `${Math.min(progress?.winStreak || 0, 3)} / 3 consecutive wins`;
    default: return null;
  }
}
