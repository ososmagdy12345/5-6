import type { AbsenceLevel, Student } from '../types';

export const LOGO_URL = 'https://i.ibb.co/4gP3wDDV/image.png';

export function deduplicateStudents(list: Student[]): Student[] {
  const map = new Map<string, Student>();
  for (const s of list) {
    const key = `${s.name}_${s.class_id}`;
    if (!map.has(key)) {
      map.set(key, s);
    }
  }
  return Array.from(map.values());
}

export function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ى]/g, 'ي')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ي')
    .replace(/[ة]/g, 'ه');
}

export function getTodayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getThreeWeeksAgo(): string {
  return getDaysAgo(21);
}

export function getAbsenceRowClass(level: AbsenceLevel): string {
  switch (level) {
    case 4:
      return 'bg-gray-600 text-white';
    case 2:
      return 'bg-red-50';
    case 1:
      return 'bg-amber-50';
    default:
      return 'bg-emerald-50/70';
  }
}

export function getAbsenceBadgeInfo(level: AbsenceLevel): {
  text: string;
  className: string;
} | null {
  switch (level) {
    case 4:
      return {
        text: '🚫 غائب 4+ جمعات',
        className: 'bg-gray-700 text-white rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
      };
    case 2:
      return {
        text: '⚠️ غائب مرتين',
        className: 'bg-amber-100 text-amber-800 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
      };
    case 1:
      return {
        text: '⚠️ غائب',
        className: 'bg-red-100 text-red-700 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
      };
    default:
      return null;
  }
}
