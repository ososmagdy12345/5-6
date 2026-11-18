import type { BirthdayPerson, ClassInfo, PersonRole, Servant, Student } from '../types';
import { getTodayDate } from './helpers';

export const ARABIC_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

const OVERRIDE_KEY_PREFIX = 'sunday_school_bday_override_';
const NOTIFIED_KEY_PREFIX = 'sunday_school_bday_notified_';
const CONGRATULATED_KEY_PREFIX = 'sunday_school_bday_congrats_';

export function getLocalBirthdayOverride(role: PersonRole, id: string): string | null {
  try {
    return localStorage.getItem(`${OVERRIDE_KEY_PREFIX}${role}_${id}`);
  } catch {
    return null;
  }
}

export function setLocalBirthdayOverride(role: PersonRole, id: string, date: string | null): void {
  try {
    const key = `${OVERRIDE_KEY_PREFIX}${role}_${id}`;
    if (date && date.trim()) {
      localStorage.setItem(key, date.trim());
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage errors
  }
}

export function getAllLocalBirthdayOverrides(): Array<{
  role: PersonRole;
  id: string;
  birthDate: string;
}> {
  const list: Array<{ role: PersonRole; id: string; birthDate: string }> = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(OVERRIDE_KEY_PREFIX)) continue;
      const rest = key.slice(OVERRIDE_KEY_PREFIX.length);
      const sepIdx = rest.indexOf('_');
      if (sepIdx <= 0) continue;
      const role = rest.slice(0, sepIdx) as PersonRole;
      const id = rest.slice(sepIdx + 1);
      const val = localStorage.getItem(key);
      if ((role === 'student' || role === 'servant') && id && val && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
        list.push({ role, id, birthDate: val.trim() });
      }
    }
  } catch {
    // Ignore storage errors
  }
  return list;
}

export function extractBirthDate(
  record: Pick<Student | Servant, 'id' | 'birth_date' | 'birthday' | 'date_of_birth' | 'dob'>,
  role: PersonRole,
): string | null {
  const dbVal = record.birth_date || record.birthday || record.date_of_birth || record.dob || null;
  if (dbVal && typeof dbVal === 'string') {
    const cleaned = dbVal.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
      return cleaned;
    }
  }
  const override = getLocalBirthdayOverride(role, record.id);
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
    return override;
  }
  return null;
}

export function parseBirthDateParts(dateStr: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.slice(0, 10));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function getDaysUntilBirthday(month: number, day: number, now = new Date()): number {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), month - 1, day);
  if (next < todayStart) {
    next = new Date(now.getFullYear() + 1, month - 1, day);
  }
  const diffMs = next.getTime() - todayStart.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export function buildBirthdayPeople(
  students: Student[],
  servants: Servant[],
  classes: ClassInfo[],
  now = new Date(),
): BirthdayPerson[] {
  const classMap = new Map(classes.map((c) => [c.id, c.class_name]));
  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();
  const currentYear = now.getFullYear();

  const result: BirthdayPerson[] = [];

  const pushPerson = (record: Student | Servant, role: PersonRole) => {
    const birthDate = extractBirthDate(record, role);
    if (!birthDate) return;
    const parts = parseBirthDateParts(birthDate);
    if (!parts) return;

    const isToday = parts.month === todayMonth && parts.day === todayDay;
    const daysUntil = isToday ? 0 : getDaysUntilBirthday(parts.month, parts.day, now);
    const ageTurning = parts.year > 1920 && parts.year <= currentYear ? currentYear - parts.year : null;

    result.push({
      id: record.id,
      name: record.name,
      role,
      classId: record.class_id,
      className: classMap.get(record.class_id) || 'غير محدد',
      birthDate,
      month: parts.month,
      day: parts.day,
      year: parts.year,
      ageTurning,
      daysUntil,
      isToday,
    });
  };

  students.forEach((s) => pushPerson(s, 'student'));
  servants.forEach((sv) => pushPerson(sv, 'servant'));

  return result;
}

export function groupBirthdaysByMonth(people: BirthdayPerson[]): Map<number, BirthdayPerson[]> {
  const map = new Map<number, BirthdayPerson[]>();
  for (let m = 1; m <= 12; m++) {
    map.set(m, []);
  }
  for (const person of people) {
    const bucket = map.get(person.month);
    if (bucket) {
      bucket.push(person);
    }
  }
  for (let m = 1; m <= 12; m++) {
    const bucket = map.get(m)!;
    bucket.sort((a, b) => a.day - b.day || a.name.localeCompare(b.name, 'ar'));
  }
  return map;
}

export function formatArabicBirthdayDay(month: number, day: number): string {
  return `${day} ${ARABIC_MONTHS[month - 1] || ''}`;
}

export function buildWhatsAppGreeting(person: BirthdayPerson): string {
  const roleLabel = person.role === 'servant' ? 'الخادم/ة' : 'البطل/ة';
  const agePart = person.ageTurning && person.ageTurning > 0 ? ` وعقبال ${person.ageTurning + 100} سنة حلوة مع يسوع` : '';
  return `🎂 كل سنة وأنت طيب يا ${person.name}! (${roleLabel} - ${person.className})\nأسرة خدمة خامسة وسادسة بتتمنالك عيد ميلاد سعيد مليان فرح ونعمة وبركة${agePart} 🎉🙏`;
}

export function buildMonthlyWhatsAppSummary(month: number, people: BirthdayPerson[]): string {
  const monthName = ARABIC_MONTHS[month - 1] || '';
  if (people.length === 0) {
    return `🎂 أعياد ميلاد شهر ${monthName}: لا توجد أعياد ميلاد مسجلة في هذا الشهر.`;
  }
  const lines = people.map((p, idx) => {
    const roleTag = p.role === 'servant' ? 'خادم' : 'مخدوم';
    return `${idx + 1}. ${p.name} (${roleTag} · ${p.className}) — ${p.day} ${monthName}`;
  });
  return `🎂 أعياد ميلاد شهر ${monthName} - خدمة خامسة وسادسة (${people.length}):\n\n${lines.join('\n')}`;
}

export function isCongratulatedToday(role: PersonRole, id: string): boolean {
  try {
    return localStorage.getItem(`${CONGRATULATED_KEY_PREFIX}${getTodayDate()}_${role}_${id}`) === '1';
  } catch {
    return false;
  }
}

export function markCongratulatedToday(role: PersonRole, id: string): void {
  try {
    localStorage.setItem(`${CONGRATULATED_KEY_PREFIX}${getTodayDate()}_${role}_${id}`, '1');
  } catch {
    // Ignore
  }
}

export function getBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function playBirthdayChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.11;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.36);
    });
  } catch {
    // Ignore audio context autoplay restrictions
  }
}

export function dispatchTodayBirthdayNotifications(
  todaysBirthdays: BirthdayPerson[],
  options: { force?: boolean } = {},
): { sentCount: number; permission: NotificationPermission | 'unsupported' } {
  const permission = getBrowserNotificationPermission();
  if (permission !== 'granted' || todaysBirthdays.length === 0) {
    return { sentCount: 0, permission };
  }

  const todayStr = getTodayDate();
  let sentCount = 0;

  for (const person of todaysBirthdays) {
    const storageKey = `${NOTIFIED_KEY_PREFIX}${todayStr}_${person.role}_${person.id}`;
    let alreadySent = false;
    try {
      alreadySent = localStorage.getItem(storageKey) === '1';
    } catch {
      alreadySent = false;
    }

    if (alreadySent && !options.force) continue;

    const roleLabel = person.role === 'servant' ? 'خادم' : 'مخدوم';
    const ageText = person.ageTurning ? ` · يتم ${person.ageTurning} سنة` : '';
    try {
      new Notification(`🎂 عيد ميلاد سعيد: ${person.name}`, {
        body: `النهاردة عيد ميلاد ${person.name} (${roleLabel} - ${person.className}${ageText}) 🎉`,
        tag: `bday-${todayStr}-${person.role}-${person.id}`,
      });
      sentCount++;
      try {
        localStorage.setItem(storageKey, '1');
      } catch {
        // Ignore
      }
    } catch {
      // Some sandboxed iframes restrict Notification constructor
    }
  }

  return { sentCount, permission };
}
