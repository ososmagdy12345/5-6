import * as XLSX from 'xlsx';
import type { ClassInfo, PersonRole, Servant, Student } from '../types';
import { normalizeText } from './helpers';

export interface ParsedExcelWorkbook {
  sheetNames: string[];
  sheets: Record<string, { headers: string[]; rows: Record<string, unknown>[] }>;
}

export interface MappedBirthdayRow {
  rowIndex: number;
  rawName: string;
  rawDate: unknown;
  parsedBirthDate: string | null;
  role: PersonRole;
  classId: string;
  className: string;
  matchedPerson: { id: string; name: string; role: PersonRole } | null;
  status: 'matched' | 'new' | 'invalid_date' | 'empty_name';
}

function toLatinDigits(str: string): string {
  return str
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatYMD(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (year < 1920 || year > 2035) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function parseFlexibleBirthDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // SheetJS cellDates can shift by local timezone; round to nearest midday or read local parts cleanly
    const d = new Date(value.getTime() + 12 * 60 * 60 * 1000);
    return formatYMD(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return formatYMD(parsed.y, parsed.m, parsed.d);
    }
  }

  const raw = toLatinDigits(String(value).trim());
  if (!raw) return null;

  // YYYY-MM-DD or YYYY/MM/DD
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(raw);
  if (m) {
    return formatYMD(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (Arabic / Egyptian standard day-first)
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(raw);
  if (m) {
    let part1 = Number(m[1]);
    let part2 = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) {
      year += year > 30 ? 1900 : 2000;
    }
    // If second part > 12, then it must be MM/DD/YYYY
    if (part2 > 12 && part1 <= 12) {
      const tmp = part1;
      part1 = part2;
      part2 = tmp;
    }
    return formatYMD(year, part2, part1);
  }

  // Fallback native Date parse for ISO strings
  const nativeDate = new Date(raw);
  if (!Number.isNaN(nativeDate.getTime())) {
    return formatYMD(nativeDate.getFullYear(), nativeDate.getMonth() + 1, nativeDate.getDate());
  }

  return null;
}

export async function readExcelFile(file: File): Promise<ParsedExcelWorkbook> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheets: ParsedExcelWorkbook['sheets'] = {};

  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
    if (!matrix || matrix.length === 0) {
      sheets[name] = { headers: [], rows: [] };
      continue;
    }

    // Find first non-empty row as header
    let headerRowIndex = 0;
    while (
      headerRowIndex < matrix.length &&
      matrix[headerRowIndex].every((cell) => String(cell ?? '').trim() === '')
    ) {
      headerRowIndex++;
    }

    const rawHeaders = (matrix[headerRowIndex] || []).map((h, i) => {
      const s = String(h ?? '').trim();
      return s || `عمود ${i + 1}`;
    });

    const rows: Record<string, unknown>[] = [];
    for (let r = headerRowIndex + 1; r < matrix.length; r++) {
      const line = matrix[r];
      if (!line || line.every((cell) => String(cell ?? '').trim() === '')) continue;
      const obj: Record<string, unknown> = {};
      rawHeaders.forEach((hdr, colIdx) => {
        obj[hdr] = line[colIdx] ?? '';
      });
      rows.push(obj);
    }

    sheets[name] = { headers: rawHeaders, rows };
  }

  return { sheetNames: workbook.SheetNames, sheets };
}

export function detectBestColumns(headers: string[]): {
  nameCol: string;
  dateCol: string;
  roleCol: string;
  classCol: string;
} {
  const findCol = (patterns: string[]) =>
    headers.find((h) => {
      const nh = normalizeText(h);
      return patterns.some((p) => nh.includes(normalizeText(p)));
    }) || '';

  const nameCol =
    findCol(['الاسم', 'اسم الطالب', 'اسم المخدوم', 'اسم الخادم', 'اسم', 'name']) ||
    headers[0] ||
    '';

  const dateCol =
    findCol(['تاريخ الميلاد', 'عيد الميلاد', 'الميلاد', 'تاريخ', 'birth', 'dob', 'birthday']) ||
    headers[1] ||
    '';

  const roleCol = findCol(['الصفه', 'النوع', 'الدور', 'role', 'type']);
  const classCol = findCol(['الفصل', 'الصف', 'class', 'grade']);

  return { nameCol, dateCol, roleCol, classCol };
}

export function mapExcelRowsToPeople(params: {
  rows: Record<string, unknown>[];
  nameCol: string;
  dateCol: string;
  roleCol: string;
  classCol: string;
  defaultRole: PersonRole;
  defaultClassId: string;
  classes: ClassInfo[];
  students: Student[];
  servants: Servant[];
}): MappedBirthdayRow[] {
  const {
    rows,
    nameCol,
    dateCol,
    roleCol,
    classCol,
    defaultRole,
    defaultClassId,
    classes,
    students,
    servants,
  } = params;

  const classMap = new Map(classes.map((c) => [c.id, c.class_name]));
  const studentIndex = students.map((s) => ({
    id: s.id,
    name: s.name,
    norm: normalizeText(s.name).replace(/\s+/g, ' ').trim(),
    classId: s.class_id,
    role: 'student' as PersonRole,
  }));
  const servantIndex = servants.map((sv) => ({
    id: sv.id,
    name: sv.name,
    norm: normalizeText(sv.name).replace(/\s+/g, ' ').trim(),
    classId: sv.class_id,
    role: 'servant' as PersonRole,
  }));

  return rows.map((row, index) => {
    const rawName = String(row[nameCol] ?? '').trim();
    const rawDate = row[dateCol];
    const parsedBirthDate = parseFlexibleBirthDate(rawDate);

    // Determine role
    let role: PersonRole = defaultRole;
    if (roleCol && row[roleCol] !== undefined) {
      const rv = normalizeText(String(row[roleCol]));
      if (rv.includes('خادم') || rv.includes('servant')) role = 'servant';
      else if (rv.includes('مخدوم') || rv.includes('طالب') || rv.includes('student')) role = 'student';
    }

    // Determine class
    let resolvedClassId = defaultClassId;
    if (classCol && row[classCol]) {
      const cv = normalizeText(String(row[classCol]));
      const foundClass = classes.find((c) => {
        const nc = normalizeText(c.class_name);
        return nc === cv || nc.includes(cv) || cv.includes(nc);
      });
      if (foundClass) resolvedClassId = foundClass.id;
    }

    if (!rawName) {
      return {
        rowIndex: index + 1,
        rawName: '',
        rawDate,
        parsedBirthDate,
        role,
        classId: resolvedClassId,
        className: classMap.get(resolvedClassId) || 'غير محدد',
        matchedPerson: null,
        status: 'empty_name',
      };
    }

    const normName = normalizeText(rawName).replace(/\s+/g, ' ').trim();
    const primaryPool = role === 'servant' ? servantIndex : studentIndex;
    const secondaryPool = role === 'servant' ? studentIndex : servantIndex;

    const findMatch = (pool: typeof studentIndex) =>
      pool.find((p) => p.norm === normName && (!resolvedClassId || p.classId === resolvedClassId)) ||
      pool.find((p) => p.norm === normName);

    const matched = findMatch(primaryPool) || (!roleCol ? findMatch(secondaryPool) : undefined) || null;

    if (!parsedBirthDate) {
      return {
        rowIndex: index + 1,
        rawName,
        rawDate,
        parsedBirthDate: null,
        role: matched ? matched.role : role,
        classId: matched ? matched.classId : resolvedClassId,
        className: classMap.get(matched ? matched.classId : resolvedClassId) || 'غير محدد',
        matchedPerson: matched ? { id: matched.id, name: matched.name, role: matched.role } : null,
        status: 'invalid_date',
      };
    }

    return {
      rowIndex: index + 1,
      rawName,
      rawDate,
      parsedBirthDate,
      role: matched ? matched.role : role,
      classId: matched ? matched.classId : resolvedClassId,
      className: classMap.get(matched ? matched.classId : resolvedClassId) || 'غير محدد',
      matchedPerson: matched ? { id: matched.id, name: matched.name, role: matched.role } : null,
      status: matched ? 'matched' : 'new',
    };
  });
}

export function downloadBirthdayTemplateExcel(classes: ClassInfo[]): void {
  const sampleClass = classes[0]?.class_name || 'خامسة أولاد';
  const rows: (string | number)[][] = [
    ['الاسم', 'تاريخ الميلاد', 'الصفة', 'الفصل'],
    ['كيرلس مينا جرجس', '2014-03-15', 'مخدوم', sampleClass],
    ['مارك يوسف نبيل', '1998-11-18', 'خادم', sampleClass],
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'أعياد الميلاد');
  XLSX.writeFile(wb, 'نموذج_استيراد_أعياد_الميلاد.xlsx');
}
