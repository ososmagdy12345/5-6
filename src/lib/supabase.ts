import { createClient } from '@supabase/supabase-js';
import type {
  AbsenceLevel,
  AttendanceRecord,
  ClassInfo,
  PersonRole,
  Servant,
  ServantAttendanceRecord,
  Student,
  UserProfile,
} from '../types';
import { getAllLocalBirthdayOverrides, setLocalBirthdayOverride } from '../utils/birthdays';
import { deduplicateStudents } from '../utils/helpers';

export const SUPABASE_URL = 'https://segqpdkygxdzzpkkgiem.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNlZ3FwZGt5Z3hkenpwa2tnaWVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NDQzOTMsImV4cCI6MjA4NzUyMDM5M30.wPx74fmu93ii-tm6iIeyPucRsNnSA8SFUsHhJitp1bs';

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();
  if (!session?.user) return null;

  const { data } = await supabaseClient
    .from('users')
    .select('*, classes(id, class_name)')
    .eq('id', session.user.id)
    .single();

  return (data as UserProfile) || null;
}

export async function fetchAllClasses(): Promise<ClassInfo[]> {
  const { data, error } = await supabaseClient.from('classes').select('*');
  if (error) {
    console.error(error);
    return [];
  }
  return (data as ClassInfo[]) || [];
}

export async function fetchStudentsForClass(classId: string): Promise<Student[]> {
  if (!classId) return [];
  const { data, error } = await supabaseClient
    .from('students')
    .select('*')
    .eq('class_id', classId)
    .eq('active', true);
  if (error) {
    console.error(error);
    return [];
  }
  return deduplicateStudents((data as Student[]) || []);
}

export async function fetchAllStudents(): Promise<Student[]> {
  const { data, error } = await supabaseClient.from('students').select('*').eq('active', true);
  if (error) {
    console.error(error);
    return [];
  }
  return deduplicateStudents((data as Student[]) || []);
}

export async function fetchAttendanceForDate(
  studentIds: string[],
  date: string,
): Promise<AttendanceRecord[]> {
  if (!studentIds.length) return [];
  const { data, error } = await supabaseClient
    .from('attendance')
    .select('*')
    .in('student_id', studentIds)
    .eq('date', date);
  if (error) {
    console.error(error);
    return [];
  }
  return (data as AttendanceRecord[]) || [];
}

export async function fetchAttendanceForDateRange(
  studentIds: string[],
  startDate: string,
  endDate: string,
): Promise<AttendanceRecord[]> {
  if (!studentIds.length) return [];
  const { data, error } = await supabaseClient
    .from('attendance')
    .select('*')
    .in('student_id', studentIds)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });
  if (error) {
    console.error(error);
    return [];
  }
  return (data as AttendanceRecord[]) || [];
}

export async function fetchAttendanceForAllClasses(
  startDate: string,
  endDate: string,
): Promise<AttendanceRecord[]> {
  const { data, error } = await supabaseClient
    .from('attendance')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });
  if (error) {
    console.error(error);
    return [];
  }
  return (data as AttendanceRecord[]) || [];
}

export async function getStudentAbsenceLevel(
  studentId: string,
  currentDate: string,
  currentTotal: number,
): Promise<AbsenceLevel> {
  if (currentTotal > 0) return 0;
  try {
    const { data, error } = await supabaseClient
      .from('attendance')
      .select('mass_grade, communion_grade, class_grade, behavior_grade')
      .eq('student_id', studentId)
      .lt('date', currentDate)
      .order('date', { ascending: false })
      .limit(3);

    if (error || !data || data.length === 0) return 1;
    const isAbsent = (r: {
      mass_grade?: number | null;
      communion_grade?: number | null;
      class_grade?: number | null;
      behavior_grade?: number | null;
    }) =>
      (r.mass_grade || 0) +
        (r.communion_grade || 0) +
        (r.class_grade || 0) +
        (r.behavior_grade || 0) ===
      0;

    if (data.length >= 3 && isAbsent(data[0]) && isAbsent(data[1]) && isAbsent(data[2])) return 4;
    if (isAbsent(data[0])) return 2;
    return 1;
  } catch {
    return 1;
  }
}

export async function getServantAbsenceLevel(
  servantId: string,
  currentDate: string,
  currentIsAbsent: boolean,
): Promise<AbsenceLevel> {
  if (!currentIsAbsent) return 0;
  try {
    const { data, error } = await supabaseClient
      .from('servant_attendance')
      .select('attended_mass, attended_opening, attended_fasl, attended_preparation')
      .eq('servant_id', servantId)
      .lt('date', currentDate)
      .order('date', { ascending: false })
      .limit(3);

    if (error || !data || data.length === 0) return 1;
    const isAbsent = (r: {
      attended_mass?: boolean;
      attended_opening?: boolean;
      attended_fasl?: boolean;
      attended_preparation?: boolean;
    }) => !r.attended_mass && !r.attended_opening && !r.attended_fasl && !r.attended_preparation;

    if (data.length >= 3 && isAbsent(data[0]) && isAbsent(data[1]) && isAbsent(data[2])) return 4;
    if (isAbsent(data[0])) return 2;
    return 1;
  } catch {
    return 1;
  }
}

export async function checkDuplicateStudent(name: string, classId: string): Promise<boolean> {
  const { data } = await supabaseClient
    .from('students')
    .select('id')
    .eq('name', name)
    .eq('class_id', classId)
    .maybeSingle();
  return !!data;
}

export async function addStudent(
  name: string,
  classId: string,
  birthDate?: string,
): Promise<{ ok: boolean; error?: string; needsColumnMigration?: boolean }> {
  const duplicate = await checkDuplicateStudent(name, classId);
  if (duplicate) {
    return { ok: false, error: '⚠️ هذا الاسم موجود بالفعل في نفس الفصل.' };
  }

  const cleanBirthDate = birthDate?.trim() || null;
  const payloadWithBday = cleanBirthDate
    ? { name, class_id: classId, active: true, birth_date: cleanBirthDate }
    : { name, class_id: classId, active: true };

  const { data, error } = await supabaseClient
    .from('students')
    .insert([payloadWithBday])
    .select('*')
    .single();

  if (!error && data) {
    if (cleanBirthDate) {
      setLocalBirthdayOverride('student', data.id, cleanBirthDate);
    }
    return { ok: true };
  }

  // Fallback if birth_date column does not exist yet in Supabase
  if (cleanBirthDate && error) {
    const retry = await supabaseClient
      .from('students')
      .insert([{ name, class_id: classId, active: true }])
      .select('*')
      .single();

    if (!retry.error && retry.data) {
      setLocalBirthdayOverride('student', retry.data.id, cleanBirthDate);
      return { ok: true, needsColumnMigration: true };
    }
    return { ok: false, error: retry.error?.message || error.message };
  }

  return { ok: false, error: error?.message || 'حدث خطأ أثناء الإضافة' };
}

export async function updatePersonBirthDate(
  role: PersonRole,
  id: string,
  birthDate: string | null,
): Promise<{ ok: boolean; savedToDb: boolean; needsColumnMigration: boolean; error?: string }> {
  const cleanDate = birthDate?.trim() || null;
  setLocalBirthdayOverride(role, id, cleanDate);

  const table = role === 'student' ? 'students' : 'servants';
  const { error } = await supabaseClient.from(table).update({ birth_date: cleanDate }).eq('id', id);

  if (!error) {
    return { ok: true, savedToDb: true, needsColumnMigration: false };
  }

  const msg = error.message || '';
  const missingColumn =
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    msg.toLowerCase().includes('birth_date') ||
    msg.toLowerCase().includes('column');

  if (missingColumn) {
    return { ok: true, savedToDb: false, needsColumnMigration: true };
  }

  return { ok: true, savedToDb: false, needsColumnMigration: false, error: msg };
}

export async function checkBirthDateColumnExists(): Promise<{
  studentsHasCol: boolean;
  servantsHasCol: boolean;
}> {
  const [stdRes, srvRes] = await Promise.all([
    supabaseClient.from('students').select('birth_date').limit(1),
    supabaseClient.from('servants').select('birth_date').limit(1),
  ]);
  return {
    studentsHasCol: !stdRes.error,
    servantsHasCol: !srvRes.error,
  };
}

export async function syncLocalBirthdaysToSupabase(
  students: Student[],
  servants: Servant[],
): Promise<{
  syncedCount: number;
  pendingLocalCount: number;
  needsColumnMigration: boolean;
}> {
  const overrides = getAllLocalBirthdayOverrides();
  if (overrides.length === 0) {
    const { studentsHasCol, servantsHasCol } = await checkBirthDateColumnExists();
    return {
      syncedCount: 0,
      pendingLocalCount: 0,
      needsColumnMigration: !studentsHasCol || !servantsHasCol,
    };
  }

  const studentMap = new Map(students.map((s) => [s.id, s]));
  const servantMap = new Map(servants.map((sv) => [sv.id, sv]));
  const { studentsHasCol, servantsHasCol } = await checkBirthDateColumnExists();

  if (!studentsHasCol || !servantsHasCol) {
    const pending = overrides.filter((o) => {
      const rec = o.role === 'student' ? studentMap.get(o.id) : servantMap.get(o.id);
      return rec && !rec.birth_date;
    }).length;
    return {
      syncedCount: 0,
      pendingLocalCount: pending,
      needsColumnMigration: true,
    };
  }

  let syncedCount = 0;
  for (const item of overrides) {
    const rec = item.role === 'student' ? studentMap.get(item.id) : servantMap.get(item.id);
    if (!rec) continue;
    if (rec.birth_date && rec.birth_date.slice(0, 10) === item.birthDate) continue;

    const table = item.role === 'student' ? 'students' : 'servants';
    const { error } = await supabaseClient
      .from(table)
      .update({ birth_date: item.birthDate })
      .eq('id', item.id);
    if (!error) {
      syncedCount++;
    }
  }

  return {
    syncedCount,
    pendingLocalCount: 0,
    needsColumnMigration: false,
  };
}

export function subscribeToRealtimeChanges(onTablesChanged: (tables: string[]) => void): () => void {
  let debounceTimer: number | null = null;
  const changedSet = new Set<string>();

  const scheduleFlush = (table: string) => {
    changedSet.add(table);
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      const list = Array.from(changedSet);
      changedSet.clear();
      debounceTimer = null;
      onTablesChanged(list);
    }, 350);
  };

  const channel = supabaseClient
    .channel('sunday-school-all-devices-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'classes' }, () =>
      scheduleFlush('classes'),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () =>
      scheduleFlush('students'),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'servants' }, () =>
      scheduleFlush('servants'),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () =>
      scheduleFlush('attendance'),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'servant_attendance' }, () =>
      scheduleFlush('servant_attendance'),
    )
    .subscribe();

  return () => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
    }
    supabaseClient.removeChannel(channel);
  };
}

export async function fetchServantsForClass(classId: string): Promise<Servant[]> {
  if (!classId) return [];
  const { data, error } = await supabaseClient
    .from('servants')
    .select('*')
    .eq('class_id', classId)
    .eq('active', true)
    .order('name');
  if (error) {
    console.error(error);
    return [];
  }
  return (data as Servant[]) || [];
}

export async function fetchAllServants(): Promise<Servant[]> {
  const { data, error } = await supabaseClient
    .from('servants')
    .select('*')
    .eq('active', true)
    .order('name');
  if (error) {
    console.error(error);
    return [];
  }
  return (data as Servant[]) || [];
}

export async function fetchServantAttendanceForDate(
  servantIds: string[],
  date: string,
): Promise<ServantAttendanceRecord[]> {
  if (!servantIds.length) return [];
  const { data, error } = await supabaseClient
    .from('servant_attendance')
    .select('*')
    .in('servant_id', servantIds)
    .eq('date', date);
  if (error) {
    console.error(error);
    return [];
  }
  return (data as ServantAttendanceRecord[]) || [];
}

export async function fetchServantAttendanceForRange(
  servantIds: string[],
  startDate: string,
  endDate: string,
): Promise<ServantAttendanceRecord[]> {
  if (!servantIds.length) return [];
  const { data, error } = await supabaseClient
    .from('servant_attendance')
    .select('*')
    .in('servant_id', servantIds)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });
  if (error) {
    console.error(error);
    return [];
  }
  return (data as ServantAttendanceRecord[]) || [];
}
