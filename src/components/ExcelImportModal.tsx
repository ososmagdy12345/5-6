import React, { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import { addStudent, updatePersonBirthDate } from '../lib/supabase';
import type { ClassInfo, PersonRole, Servant, Student } from '../types';
import { ARABIC_MONTHS, parseBirthDateParts } from '../utils/birthdays';
import {
  detectBestColumns,
  downloadBirthdayTemplateExcel,
  mapExcelRowsToPeople,
  ParsedExcelWorkbook,
  readExcelFile,
} from '../utils/excelImport';

interface ExcelImportModalProps {
  open: boolean;
  isAdmin: boolean;
  classes: ClassInfo[];
  students: Student[];
  servants: Servant[];
  defaultClassId: string | null;
  onClose: () => void;
  onImported: (needsColumnMigration: boolean) => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info' | 'birthday', text: string) => void;
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  open,
  isAdmin,
  classes,
  students,
  servants,
  defaultClassId,
  onClose,
  onImported,
  onToast,
}) => {
  const [workbook, setWorkbook] = useState<ParsedExcelWorkbook | null>(null);
  const [fileName, setFileName] = useState('');
  const [selectedSheet, setSelectedSheet] = useState('');

  const [nameCol, setNameCol] = useState('');
  const [dateCol, setDateCol] = useState('');
  const [roleCol, setRoleCol] = useState('');
  const [classCol, setClassCol] = useState('');

  const [defaultRole, setDefaultRole] = useState<PersonRole>('student');
  const [targetClassId, setTargetClassId] = useState<string>(defaultClassId || classes[0]?.id || '');
  const [createMissingStudents, setCreateMissingStudents] = useState(true);
  const [importing, setImporting] = useState(false);

  const currentSheet = workbook && selectedSheet ? workbook.sheets[selectedSheet] : null;
  const headers = currentSheet?.headers || [];

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await readExcelFile(file);
      if (parsed.sheetNames.length === 0) {
        onToast('error', 'الملف لا يحتوي على أي أوراق عمل');
        return;
      }
      const firstSheet = parsed.sheetNames[0];
      const detected = detectBestColumns(parsed.sheets[firstSheet]?.headers || []);
      setWorkbook(parsed);
      setFileName(file.name);
      setSelectedSheet(firstSheet);
      setNameCol(detected.nameCol);
      setDateCol(detected.dateCol);
      setRoleCol(detected.roleCol);
      setClassCol(detected.classCol);
      if (!targetClassId && classes[0]?.id) {
        setTargetClassId(classes[0].id);
      }
    } catch (err) {
      console.error(err);
      onToast('error', 'تعذر قراءة ملف الإكسيل. تأكد أنه بصيغة .xlsx أو .xls أو .csv');
    }
  };

  const handleSheetChange = (sheetName: string) => {
    setSelectedSheet(sheetName);
    const hdrs = workbook?.sheets[sheetName]?.headers || [];
    const detected = detectBestColumns(hdrs);
    setNameCol(detected.nameCol);
    setDateCol(detected.dateCol);
    setRoleCol(detected.roleCol);
    setClassCol(detected.classCol);
  };

  const mappedRows = useMemo(() => {
    if (!currentSheet || !nameCol || !dateCol) return [];
    return mapExcelRowsToPeople({
      rows: currentSheet.rows,
      nameCol,
      dateCol,
      roleCol,
      classCol,
      defaultRole,
      defaultClassId: isAdmin ? targetClassId : defaultClassId || targetClassId,
      classes,
      students,
      servants,
    });
  }, [
    currentSheet,
    nameCol,
    dateCol,
    roleCol,
    classCol,
    defaultRole,
    isAdmin,
    targetClassId,
    defaultClassId,
    classes,
    students,
    servants,
  ]);

  const counts = useMemo(() => {
    let matched = 0;
    let isNew = 0;
    let invalid = 0;
    mappedRows.forEach((r) => {
      if (r.status === 'matched') matched++;
      else if (r.status === 'new') isNew++;
      else invalid++;
    });
    return { matched, isNew, invalid };
  }, [mappedRows]);

  if (!open) return null;

  const handleImport = async () => {
    const validRows = mappedRows.filter(
      (r) => r.status === 'matched' || (r.status === 'new' && createMissingStudents && r.role === 'student'),
    );
    if (validRows.length === 0) {
      onToast('error', 'لا توجد صفوف صالحة للاستيراد');
      return;
    }

    setImporting(true);
    let updatedCount = 0;
    let createdCount = 0;
    let needsColumnMigration = false;

    for (const row of validRows) {
      if (!row.parsedBirthDate) continue;
      if (row.status === 'matched' && row.matchedPerson) {
        const res = await updatePersonBirthDate(
          row.matchedPerson.role,
          row.matchedPerson.id,
          row.parsedBirthDate,
        );
        if (res.needsColumnMigration) needsColumnMigration = true;
        updatedCount++;
      } else if (row.status === 'new' && createMissingStudents && row.role === 'student') {
        if (!row.classId) continue;
        const addRes = await addStudent(row.rawName, row.classId, row.parsedBirthDate);
        if (addRes.ok) {
          if (addRes.needsColumnMigration) needsColumnMigration = true;
          createdCount++;
        }
      }
    }

    setImporting(false);
    await onImported(needsColumnMigration);
    onToast(
      'success',
      `✅ تم استيراد البيانات بنجاح: تحديث ${updatedCount} وإضافة ${createdCount} طالب جديد`,
    );
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b border-gray-200 pb-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6 text-emerald-600" />
            <h3 className="text-xl font-bold text-blue-900">📤 استيراد البيانات من شيت إكسيل</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-gray-100 p-2 text-gray-600 hover:bg-gray-200"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-sky-50 p-4 text-sm text-blue-950">
          <div>
            <div className="font-bold">ارفع شيت الإكسيل (.xlsx / .xls / .csv)</div>
            <div className="text-xs text-gray-600">
              يقوم النظام بمطابقة الأسماء تلقائياً وتحديث تواريخ الميلاد، مع إمكانية إضافة الطلاب الجدد مباشرة للفصل.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => downloadBirthdayTemplateExcel(classes)}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-blue-900 shadow-xs hover:bg-gray-100"
            >
              <Download className="h-4 w-4" />
              تحميل نموذج إكسيل جاهز
            </button>

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              <Upload className="h-4 w-4" />
              {fileName ? 'اختيار ملف آخر' : 'اختيار ملف Excel'}
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {workbook && (
          <div className="space-y-4">
            {/* Sheet & Column Mapping */}
            <div className="grid gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {workbook.sheetNames.length > 1 && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-gray-700">ورقة العمل (Sheet):</label>
                  <select
                    value={selectedSheet}
                    onChange={(e) => handleSheetChange(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 bg-white p-2 text-sm"
                  >
                    {workbook.sheetNames.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-bold text-gray-700">عمود الاسم *:</label>
                <select
                  value={nameCol}
                  onChange={(e) => setNameCol(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 bg-white p-2 text-sm"
                >
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-gray-700">عمود تاريخ الميلاد *:</label>
                <select
                  value={dateCol}
                  onChange={(e) => setDateCol(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 bg-white p-2 text-sm"
                >
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-gray-700">عمود الصفة (اختياري):</label>
                <select
                  value={roleCol}
                  onChange={(e) => setRoleCol(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 bg-white p-2 text-sm"
                >
                  <option value="">غير محدد (استخدم الافتراضي)</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-gray-700">النوع الافتراضي:</label>
                <select
                  value={defaultRole}
                  onChange={(e) => setDefaultRole(e.target.value as PersonRole)}
                  className="w-full rounded-xl border border-gray-300 bg-white p-2 text-sm"
                >
                  <option value="student">مخدوم</option>
                  <option value="servant">خادم</option>
                </select>
              </div>

              {isAdmin && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-gray-700">عمود الفصل (اختياري):</label>
                  <select
                    value={classCol}
                    onChange={(e) => setClassCol(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 bg-white p-2 text-sm"
                  >
                    <option value="">غير محدد (استخدم الفصل المختار)</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {isAdmin && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-gray-700">الفصل الافتراضي:</label>
                  <select
                    value={targetClassId}
                    onChange={(e) => setTargetClassId(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 bg-white p-2 text-sm"
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.class_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gray-100 px-4 py-3 text-xs font-semibold">
              <div className="flex flex-wrap gap-4 tabular-nums">
                <span className="text-gray-700">الملف: {fileName}</span>
                <span className="text-emerald-700">✅ متطابق مع القائمة الحالية: {counts.matched}</span>
                <span className="text-blue-700">➕ أسماء جديدة: {counts.isNew}</span>
                <span className="text-amber-700">⚠️ تواريخ غير صالحة: {counts.invalid}</span>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-gray-800">
                <input
                  type="checkbox"
                  checked={createMissingStudents}
                  onChange={(e) => setCreateMissingStudents(e.target.checked)}
                  className="h-4 w-4 accent-blue-900"
                />
                إضافة المخدومين الجدد غير المسجلين تلقائياً
              </label>
            </div>

            {/* Preview Table */}
            <div className="max-h-72 overflow-auto rounded-2xl border border-gray-200">
              <table className="w-full min-w-[620px] border-collapse text-center text-xs">
                <thead className="sticky top-0 bg-blue-900 text-white">
                  <tr>
                    <th className="p-2.5">#</th>
                    <th className="p-2.5 text-right">الاسم في الشيت</th>
                    <th className="p-2.5">تاريخ الميلاد المستخرج</th>
                    <th className="p-2.5">الشهر</th>
                    <th className="p-2.5">الصفة</th>
                    <th className="p-2.5">الفصل</th>
                    <th className="p-2.5">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {mappedRows.slice(0, 100).map((row) => {
                    const parts = row.parsedBirthDate ? parseBirthDateParts(row.parsedBirthDate) : null;
                    return (
                      <tr key={row.rowIndex} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="p-2 tabular-nums">{row.rowIndex}</td>
                        <td className="p-2 text-right font-semibold text-gray-900">{row.rawName || '-'}</td>
                        <td className="p-2 tabular-nums">
                          {row.parsedBirthDate || (
                            <span className="text-red-600">{String(row.rawDate || 'فارغ')}</span>
                          )}
                        </td>
                        <td className="p-2">
                          {parts ? `${parts.day} ${ARABIC_MONTHS[parts.month - 1]}` : '-'}
                        </td>
                        <td className="p-2">{row.role === 'servant' ? 'خادم' : 'مخدوم'}</td>
                        <td className="p-2">{row.className}</td>
                        <td className="p-2 font-semibold">
                          {row.status === 'matched' && (
                            <span className="text-emerald-700">✅ تحديث ({row.matchedPerson?.name})</span>
                          )}
                          {row.status === 'new' && (
                            <span className="text-blue-700">
                              {createMissingStudents && row.role === 'student'
                                ? '➕ إضافة كطالب جديد'
                                : '⏭️ غير مسجل'}
                            </span>
                          )}
                          {(row.status === 'invalid_date' || row.status === 'empty_name') && (
                            <span className="text-amber-700">⚠️ تخطي</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-300"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={importing || counts.matched + (createMissingStudents ? counts.isNew : 0) === 0}
                onClick={handleImport}
                className="rounded-full bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
              >
                {importing ? 'جاري الاستيراد...' : '💾 اعتماد وحفظ البيانات'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
