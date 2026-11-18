export interface ClassInfo {
  id: string;
  class_name: string;
}

export interface UserProfile {
  id: string;
  role: 'admin' | 'servant' | string;
  class_id: string | null;
  classes?: ClassInfo | null;
}

export interface Student {
  id: string;
  name: string;
  class_id: string;
  active: boolean;
  birth_date?: string | null;
  birthday?: string | null;
  date_of_birth?: string | null;
  dob?: string | null;
}

export interface Servant {
  id: string;
  name: string;
  class_id: string;
  active: boolean;
  birth_date?: string | null;
  birthday?: string | null;
  date_of_birth?: string | null;
  dob?: string | null;
}

export interface AttendanceRecord {
  id?: string;
  student_id: string;
  date: string;
  mass_grade: number;
  communion_grade: number;
  class_grade: number;
  behavior_grade: number;
  notes?: string | null;
  recorded_by?: string;
}

export interface ServantAttendanceRecord {
  id?: string;
  servant_id: string;
  date: string;
  attended_mass: boolean;
  attended_opening: boolean;
  attended_fasl: boolean;
  attended_preparation: boolean;
  notes?: string | null;
  recorded_by?: string;
}

export type AbsenceLevel = 0 | 1 | 2 | 4;

export type PersonRole = 'student' | 'servant';

export interface BirthdayPerson {
  id: string;
  name: string;
  role: PersonRole;
  classId: string;
  className: string;
  birthDate: string; // YYYY-MM-DD
  month: number; // 1-12
  day: number; // 1-31
  year: number;
  ageTurning: number | null;
  daysUntil: number; // 0 if today
  isToday: boolean;
}

export interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'info' | 'birthday';
  text: string;
}
