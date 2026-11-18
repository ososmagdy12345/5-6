import * as XLSX from 'xlsx';
import type { BirthdayPerson } from '../types';
import { ARABIC_MONTHS } from './birthdays';

export function exportAoAToExcel(sheetName: string, fileName: string, rows: (string | number)[][]): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, fileName);
}

export function exportMonthlyBirthdaysToExcel(month: number | 'all', people: BirthdayPerson[]): void {
  const header = ['الشهر', 'اليوم', 'الاسم', 'الصفة', 'الفصل', 'تاريخ الميلاد', 'العمر المتوقع'];
  const sorted = [...people].sort((a, b) => a.month - b.month || a.day - b.day || a.name.localeCompare(b.name, 'ar'));
  const rows: (string | number)[][] = [
    header,
    ...sorted.map((p) => [
      ARABIC_MONTHS[p.month - 1] || '',
      p.day,
      p.name,
      p.role === 'servant' ? 'خادم' : 'مخدوم',
      p.className,
      p.birthDate,
      p.ageTurning ?? '-',
    ]),
  ];

  const label = month === 'all' ? 'كل_الشهور' : ARABIC_MONTHS[month - 1] || String(month);
  exportAoAToExcel('أعياد الميلاد', `أعياد_ميلاد_${label}_${new Date().toLocaleDateString('en-CA')}.xlsx`, rows);
}
