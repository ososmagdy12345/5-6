import React, { useEffect, useMemo, useState } from 'react';
import {
  fetchAllStudents,
  fetchAttendanceForAllClasses,
  fetchAttendanceForDate,
  fetchAttendanceForDateRange,
  getStudentAbsenceLevel,
  supabaseClient,
} from '../lib/supabase';
import type { AbsenceLevel, AttendanceRecord, ClassInfo, Student } from '../types';
import { exportAoAToExcel } from '../utils/excel';
import {
  getAbsenceBadgeInfo,
  getAbsenceRowClass,
  getThreeWeeksAgo,
  getTodayDate,
  LOGO_URL,
  normalizeText,
} from '../utils/helpers';
import { ConfirmDialog } from './ConfirmDialog';
import { CouponItem, CouponModal } from './CouponModal';

export type StudentViewMode = 'daily' | 'report' | 'detailed' | 'allClasses';

interface StudentsSectionProps {
  isAdmin: boolean;
  userId: string | null;
  classId: string | null;
  className: string;
  classes: ClassInfo[];
  students: Student[];
  initialMode?: StudentViewMode;
  syncVersion?: number;
  onOpenAddStudent: () => void;
  onBackToAdminMain?: () => void;
  onToast: (type: 'success' | 'error' | 'info' | 'birthday', text: string) => void;
}

interface EditableStudentRow {
  student: Student;
  mass: number;
  communion: number;
  classGrade: number;
  behavior: number;
  notes: string;
  absenceLevel: AbsenceLevel;
}

export const StudentsSection: React.FC<StudentsSectionProps> = ({
  isAdmin,
  userId,
  classId,
  className,
  classes,
  students,
  initialMode = 'daily',
  syncVersion = 0,
  onOpenAddStudent,
  onBackToAdminMain,
  onToast,
}) => {
  const [mode, setMode] = useState<StudentViewMode>(initialMode);
  const [selectedDate, setSelectedDate] = useState(getTodayDate());
  const [nameSearch, setNameSearch] = useState('');
  const [rows, setRows] = useState<EditableStudentRow[]>([]);
  const [isDailyDirty, setIsDailyDirty] = useState(false);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Report state
  const [startDate, setStartDate] = useState(getThreeWeeksAgo());
  const [endDate, setEndDate] = useState(getTodayDate());
  const [reportNameFilter, setReportNameFilter] = useState('');
  const [massMin, setMassMin] = useState(0);
  const [communionMin, setCommunionMin] = useState(0);
  const [classMin, setClassMin] = useState(0);

  // All classes report state
  const [allClassesStudents, setAllClassesStudents] = useState<Student[]>([]);
  const [allClassesAttendance, setAllClassesAttendance] = useState<AttendanceRecord[]>([]);

  // Coupons & Confirm modal
  const [activeCoupons, setActiveCoupons] = useState<CouponItem[] | null>(null);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });

  const loadDailyData = async (date: string) => {
    if (!classId) return;
    setLoading(true);
    const ids = students.map((s) => s.id);
    const records = await fetchAttendanceForDate(ids, date);
    setAttendanceRecords(records);

    const built: EditableStudentRow[] = await Promise.all(
      students.map(async (s) => {
        const r = records.find((a) => a.student_id === s.id);
        const mass = r ? r.mass_grade : 0;
        const communion = r ? r.communion_grade : 0;
        const classGrade = r ? r.class_grade : 0;
        const behavior = r ? r.behavior_grade : 0;
        const total = mass + communion + classGrade + behavior;
        const level = await getStudentAbsenceLevel(s.id, date, total);
        return {
          student: s,
          mass,
          communion,
          classGrade,
          behavior,
          notes: r?.notes || '',
          absenceLevel: level,
        };
      }),
    );

    setRows(built);
    setIsDailyDirty(false);
    setLoading(false);
  };

  const loadRangeData = async (s: string, e: string) => {
    if (!classId) return;
    setLoading(true);
    const ids = students.map((x) => x.id);
    const records = await fetchAttendanceForDateRange(ids, s, e);
    setAttendanceRecords(records);
    setLoading(false);
  };

  const loadAllClassesData = async (s: string, e: string) => {
    setLoading(true);
    const [allStds, allAtt] = await Promise.all([
      fetchAllStudents(),
      fetchAttendanceForAllClasses(s, e),
    ]);
    setAllClassesStudents(allStds);
    setAllClassesAttendance(allAtt);
    setLoading(false);
  };

  useEffect(() => {
    setMode(initialMode);
    if (initialMode === 'allClasses') {
      loadAllClassesData(startDate, endDate);
    } else if (classId) {
      if (initialMode === 'daily') {
        loadDailyData(selectedDate);
      } else {
        loadRangeData(startDate, endDate);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, students, initialMode]);

  useEffect(() => {
    if (syncVersion === 0) return;
    if (mode === 'allClasses') {
      loadAllClassesData(startDate, endDate);
    } else if (classId) {
      if (mode === 'daily') {
        if (!isDailyDirty && !saving) {
          loadDailyData(selectedDate);
        }
      } else {
        loadRangeData(startDate, endDate);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncVersion]);

  const dashboardStats = useMemo(() => {
    const totalStudents = students.length;
    let presentCount = 0;
    let massCount = 0;
    let communionCount = 0;
    let classCount = 0;

    if (attendanceRecords.length > 0) {
      const dates = [...new Set(attendanceRecords.map((r) => r.date))].sort();
      const lastDate = dates[dates.length - 1];
      const lastDay = attendanceRecords.filter((r) => r.date === lastDate);
      lastDay.forEach((rec) => {
        if (rec.mass_grade === 10) massCount++;
        if (rec.communion_grade === 10) communionCount++;
        if (rec.class_grade === 10) classCount++;
        if (rec.mass_grade === 10 && rec.communion_grade === 10 && rec.class_grade === 10) {
          presentCount++;
        }
      });
    }
    return { totalStudents, presentCount, massCount, communionCount, classCount };
  }, [students.length, attendanceRecords]);

  const filteredDailyRows = useMemo(() => {
    const q = normalizeText(nameSearch);
    if (!q) return rows;
    return rows.filter((r) => normalizeText(r.student.name).includes(q));
  }, [rows, nameSearch]);

  const clampTenStep = (val: number) => {
    if (Number.isNaN(val) || val < 0) return 0;
    if (val > 10) return 10;
    return val;
  };

  const executeSaveDailyAttendance = async () => {
    setSaving(true);
    const toUpsert: AttendanceRecord[] = [];
    for (const row of rows) {
      if (
        row.mass > 0 ||
        row.communion > 0 ||
        row.classGrade > 0 ||
        row.behavior > 0 ||
        row.notes.trim() !== ''
      ) {
        toUpsert.push({
          student_id: row.student.id,
          date: selectedDate,
          mass_grade: row.mass,
          communion_grade: row.communion,
          class_grade: row.classGrade,
          behavior_grade: row.behavior,
          notes: row.notes,
          ...(userId ? { recorded_by: userId } : {}),
        });
      } else {
        await supabaseClient
          .from('attendance')
          .delete()
          .match({ student_id: row.student.id, date: selectedDate });
      }
    }

    let firstErrorMsg = '';
    for (const rec of toUpsert) {
      const { error } = await supabaseClient
        .from('attendance')
        .upsert(rec, { onConflict: 'student_id, date' });
      if (error) {
        console.error(error);
        if (!firstErrorMsg) firstErrorMsg = error.message;
      }
    }

    setSaving(false);
    if (firstErrorMsg) {
      onToast('error', `حدث خطأ أثناء الحفظ: ${firstErrorMsg}`);
    } else {
      setIsDailyDirty(false);
      onToast('success', '✅ تم حفظ الحضور بنجاح ويظهر الآن على كل الأجهزة');
      await loadDailyData(selectedDate);
    }
  };

  const handleSaveDaily = async () => {
    const ids = students.map((s) => s.id);
    const { data: existing } = await supabaseClient
      .from('attendance')
      .select('id')
      .eq('date', selectedDate)
      .in('student_id', ids);

    if (existing && existing.length > 0) {
      setConfirmState({
        open: true,
        title: 'تنبيه',
        message: `⚠️ هذا اليوم (${selectedDate}) مسجل بالفعل.\nهل تريد تعديل البيانات؟`,
        onConfirm: () => {
          setConfirmState((p) => ({ ...p, open: false }));
          executeSaveDailyAttendance();
        },
      });
    } else {
      setConfirmState({
        open: true,
        title: 'تأكيد الحفظ',
        message: 'هل أنت متأكد من حفظ البيانات؟',
        onConfirm: () => {
          setConfirmState((p) => ({ ...p, open: false }));
          executeSaveDailyAttendance();
        },
      });
    }
  };

  const reportSummary = useMemo(() => {
    return students.map((s) => {
      const recs = attendanceRecords.filter((r) => r.student_id === s.id);
      const valid = recs.filter(
        (r) => (r.mass_grade || 0) + (r.communion_grade || 0) + (r.class_grade || 0) > 0,
      );
      const totalMass = valid.reduce((a, b) => a + (b.mass_grade || 0), 0);
      const totalCommunion = valid.reduce((a, b) => a + (b.communion_grade || 0), 0);
      const totalClass = valid.reduce((a, b) => a + (b.class_grade || 0), 0);
      const totalBehavior = valid.reduce((a, b) => a + (b.behavior_grade || 0), 0);
      return {
        id: s.id,
        name: s.name,
        totalDays: valid.length,
        totalMass,
        totalCommunion,
        totalClass,
        totalBehavior,
        grandTotal: totalMass + totalCommunion + totalClass + totalBehavior,
      };
    });
  }, [students, attendanceRecords]);

  const filteredReportSummary = useMemo(() => {
    const q = normalizeText(reportNameFilter);
    return reportSummary.filter(
      (i) =>
        (!q || normalizeText(i.name).includes(q)) &&
        i.totalMass >= massMin &&
        i.totalCommunion >= communionMin &&
        i.totalClass >= classMin,
    );
  }, [reportSummary, reportNameFilter, massMin, communionMin, classMin]);

  // All-Classes Comprehensive Report
  if (mode === 'allClasses') {
    const classesData = classes.map((cls) => {
      const cs = allClassesStudents.filter((x) => x.class_id === cls.id);
      const ca = allClassesAttendance.filter((r) => cs.some((x) => x.id === r.student_id));
      const fullCount = ca.filter(
        (r) => r.mass_grade === 10 && r.communion_grade === 10 && r.class_grade === 10,
      ).length;
      const summ = cs
        .map((x) => {
          const recs = ca.filter((r) => r.student_id === x.id);
          const tM = recs.reduce((a, b) => a + (b.mass_grade || 0), 0);
          const tC = recs.reduce((a, b) => a + (b.communion_grade || 0), 0);
          const tCl = recs.reduce((a, b) => a + (b.class_grade || 0), 0);
          const tB = recs.reduce((a, b) => a + (b.behavior_grade || 0), 0);
          return { name: x.name, days: recs.length, tM, tC, tCl, tB, total: tM + tC + tCl + tB };
        })
        .filter((x) => x.days > 0);
      return { classId: cls.id, className: cls.class_name, studentCount: cs.length, fullCount, summ };
    });

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
          <div className="flex items-center gap-3">
            <img src={LOGO_URL} alt="شعار" referrerPolicy="no-referrer" className="h-16 w-auto rounded-xl shadow" />
            <span className="text-xl font-bold text-blue-900">تقرير شامل لجميع الفصول</span>
          </div>
          {onBackToAdminMain && (
            <button
              type="button"
              onClick={onBackToAdminMain}
              className="rounded-full bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              🔙 العودة
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-gray-50 p-4">
          <label className="text-sm font-semibold">من تاريخ:</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-xl border border-gray-300 bg-white p-2.5 text-sm"
          />
          <label className="text-sm font-semibold">إلى تاريخ:</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-xl border border-gray-300 bg-white p-2.5 text-sm"
          />
          <button
            type="button"
            onClick={() => loadAllClassesData(startDate, endDate)}
            className="rounded-full bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            عرض
          </button>
          <button
            type="button"
            onClick={() => {
              const wsData: (string | number)[][] = [
                ['الفصل', 'الاسم', 'عدد أيام الحضور', 'إجمالي القداس', 'إجمالي التناول', 'إجمالي الخدمة', 'إجمالي السلوك', 'المجموع الكلي'],
              ];
              classesData.forEach((d) => {
                d.summ.forEach((x) =>
                  wsData.push([d.className, x.name, x.days, x.tM, x.tC, x.tCl, x.tB, x.total]),
                );
              });
              exportAoAToExcel(
                'تقرير شامل',
                `تقرير_شامل_${new Date().toLocaleDateString('en-CA')}.xlsx`,
                wsData,
              );
            }}
            className="rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            📥 تصدير Excel شامل
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {classesData.map((d) => (
            <div key={d.classId} className="rounded-2xl bg-white p-4 text-center shadow-xs">
              <h4 className="mb-2 font-bold text-blue-900">{d.className}</h4>
              <div className="text-sm text-gray-600 tabular-nums">المخدومين: {d.studentCount}</div>
              <div className="text-sm font-semibold text-emerald-700 tabular-nums">
                الحضور الكامل: {d.fullCount}
              </div>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-500">جاري تحميل التقرير الشامل...</div>
        ) : (
          classesData.map(
            (d) =>
              d.summ.length > 0 && (
                <div key={d.classId} className="space-y-2">
                  <h3 className="text-lg font-bold text-blue-900">{d.className}</h3>
                  <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
                    <table className="w-full min-w-[700px] border-collapse text-center text-sm">
                      <thead>
                        <tr className="bg-blue-900 text-white">
                          <th className="border border-blue-800 p-3">الاسم</th>
                          <th className="border border-blue-800 p-3">عدد أيام الحضور</th>
                          <th className="border border-blue-800 p-3">إجمالي القداس</th>
                          <th className="border border-blue-800 p-3">إجمالي التناول</th>
                          <th className="border border-blue-800 p-3">إجمالي الخدمة</th>
                          <th className="border border-blue-800 p-3">إجمالي السلوك</th>
                          <th className="border border-blue-800 p-3">المجموع الكلي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.summ.map((x) => (
                          <tr key={x.name} className="hover:bg-gray-50">
                            <td className="border border-gray-200 p-3 font-semibold">{x.name}</td>
                            <td className="border border-gray-200 p-3 tabular-nums">{x.days}</td>
                            <td className="border border-gray-200 p-3 tabular-nums">{x.tM}</td>
                            <td className="border border-gray-200 p-3 tabular-nums">{x.tC}</td>
                            <td className="border border-gray-200 p-3 tabular-nums">{x.tCl}</td>
                            <td className="border border-gray-200 p-3 tabular-nums">{x.tB}</td>
                            <td className="border border-gray-200 p-3 font-bold text-blue-900 tabular-nums">
                              {x.total}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ),
          )
        )}
      </div>
    );
  }

  // Detailed Report Mode
  if (mode === 'detailed') {
    const map = new Map(students.map((x) => [x.id, x.name]));
    const detailed = attendanceRecords
      .map((r) => ({ ...r, student_name: map.get(r.student_id) || 'غير معروف' }))
      .sort(
        (a, b) =>
          a.student_name.localeCompare(b.student_name, 'ar') ||
          new Date(a.date).getTime() - new Date(b.date).getTime(),
      );

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
          <div className="flex items-center gap-3">
            <img src={LOGO_URL} alt="شعار" referrerPolicy="no-referrer" className="h-16 w-auto rounded-xl shadow" />
            <span className="text-xl font-bold text-blue-900">{className} - تقرير مفصل</span>
          </div>
          <button
            type="button"
            onClick={() => setMode('report')}
            className="rounded-full bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            🔙 العودة للموجز
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-gray-50 p-4">
          <label className="text-sm font-semibold">من تاريخ:</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-xl border border-gray-300 bg-white p-2.5 text-sm"
          />
          <label className="text-sm font-semibold">إلى تاريخ:</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-xl border border-gray-300 bg-white p-2.5 text-sm"
          />
          <button
            type="button"
            onClick={() => loadRangeData(startDate, endDate)}
            className="rounded-full bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            عرض
          </button>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[700px] border-collapse text-center text-sm">
            <thead>
              <tr className="bg-blue-900 text-white">
                <th className="border border-blue-800 p-3">الاسم</th>
                <th className="border border-blue-800 p-3">التاريخ</th>
                <th className="border border-blue-800 p-3">القداس</th>
                <th className="border border-blue-800 p-3">التناول</th>
                <th className="border border-blue-800 p-3">الخدمة</th>
                <th className="border border-blue-800 p-3">السلوك</th>
                <th className="border border-blue-800 p-3">ملاحظات</th>
                <th className="border border-blue-800 p-3">المجموع</th>
              </tr>
            </thead>
            <tbody>
              {detailed.map((r, idx) => {
                const total =
                  (r.mass_grade || 0) +
                  (r.communion_grade || 0) +
                  (r.class_grade || 0) +
                  (r.behavior_grade || 0);
                return (
                  <tr key={`${r.student_id}-${r.date}-${idx}`} className="hover:bg-gray-50">
                    <td className="border border-gray-200 p-3 font-semibold">{r.student_name}</td>
                    <td className="border border-gray-200 p-3 tabular-nums">{r.date}</td>
                    <td className="border border-gray-200 p-3 tabular-nums">{r.mass_grade}</td>
                    <td className="border border-gray-200 p-3 tabular-nums">{r.communion_grade}</td>
                    <td className="border border-gray-200 p-3 tabular-nums">{r.class_grade}</td>
                    <td className="border border-gray-200 p-3 tabular-nums">{r.behavior_grade}</td>
                    <td className="border border-gray-200 p-3">{r.notes || ''}</td>
                    <td className="border border-gray-200 p-3 font-bold text-blue-900 tabular-nums">
                      {total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Summary Report Mode
  if (mode === 'report') {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
          <div className="flex items-center gap-3">
            <img src={LOGO_URL} alt="شعار" referrerPolicy="no-referrer" className="h-16 w-auto rounded-xl shadow" />
            <span className="text-xl font-bold text-blue-900">{className} - تقرير موجز</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                setMode('daily');
                await loadDailyData(selectedDate);
              }}
              className="rounded-full bg-blue-900 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              🔙 العودة للتسجيل
            </button>
            <button
              type="button"
              onClick={() => setMode('detailed')}
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              📊 عرض التفاصيل
            </button>
            <button
              type="button"
              onClick={() => {
                const wsData: (string | number)[][] = [
                  ['الاسم', 'عدد أيام الحضور', 'إجمالي القداس', 'إجمالي التناول', 'إجمالي الخدمة', 'إجمالي السلوك', 'المجموع الكلي'],
                  ...filteredReportSummary.map((s) => [
                    s.name,
                    s.totalDays,
                    s.totalMass,
                    s.totalCommunion,
                    s.totalClass,
                    s.totalBehavior,
                    s.grandTotal,
                  ]),
                ];
                exportAoAToExcel(
                  'تقرير موجز',
                  `تقرير_موجز_${className}_${new Date().toLocaleDateString('en-CA')}.xlsx`,
                  wsData,
                );
              }}
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              📥 تصدير Excel
            </button>
            <button
              type="button"
              onClick={() => {
                const wg = filteredReportSummary.filter((s) => s.grandTotal > 0);
                if (!wg.length) {
                  onToast('info', 'لا يوجد طلاب بمجموع أكبر من صفر');
                  return;
                }
                setActiveCoupons(
                  wg.map((s) => ({
                    studentName: s.name,
                    className,
                    startDate,
                    endDate,
                    records: attendanceRecords.filter((r) => r.student_id === s.id),
                  })),
                );
              }}
              className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
            >
              🖨️ طباعة كوبونات الفصل
            </button>
            <button
              type="button"
              onClick={() => {
                const wg = filteredReportSummary.filter((s) => s.grandTotal > 0);
                if (!wg.length) {
                  onToast('info', 'لا يوجد طلاب بمجموع أكبر من صفر');
                  return;
                }
                const wsData: (string | number)[][] = [
                  ['اسم المخدوم', 'الفصل', 'الفترة', 'عدد أيام الحضور', 'إجمالي القداس', 'إجمالي التناول', 'إجمالي الخدمة', 'إجمالي السلوك', 'المجموع الكلي'],
                  ...wg.map((x) => {
                    const r = attendanceRecords.filter((a) => a.student_id === x.id);
                    const tM = r.reduce((a, b) => a + (b.mass_grade || 0), 0);
                    const tC = r.reduce((a, b) => a + (b.communion_grade || 0), 0);
                    const tCl = r.reduce((a, b) => a + (b.class_grade || 0), 0);
                    const tB = r.reduce((a, b) => a + (b.behavior_grade || 0), 0);
                    return [x.name, className, `${startDate} إلى ${endDate}`, r.length, tM, tC, tCl, tB, tM + tC + tCl + tB];
                  }),
                ];
                exportAoAToExcel(
                  'كوبونات',
                  `كوبونات_${className}_${new Date().toLocaleDateString('en-CA')}.xlsx`,
                  wsData,
                );
              }}
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              📥 تصدير الكوبونات Excel
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-gray-50 p-4">
          <label className="text-sm font-semibold">من تاريخ:</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-xl border border-gray-300 bg-white p-2.5 text-sm"
          />
          <label className="text-sm font-semibold">إلى تاريخ:</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-xl border border-gray-300 bg-white p-2.5 text-sm"
          />
          <button
            type="button"
            onClick={() => loadRangeData(startDate, endDate)}
            className="rounded-full bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            عرض
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-gray-50 p-4 text-sm">
          <div className="flex items-center gap-2">
            <label className="font-semibold">🔍 فلتر الاسم:</label>
            <input
              type="text"
              value={reportNameFilter}
              onChange={(e) => setReportNameFilter(e.target.value)}
              placeholder="اكتب جزءاً من الاسم"
              className="w-40 rounded-lg border border-gray-300 bg-white px-3 py-1.5"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="font-semibold">القداس ≥:</label>
            <input
              type="number"
              min={0}
              max={100}
              value={massMin}
              onChange={(e) => setMassMin(Number(e.target.value) || 0)}
              className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-center"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="font-semibold">التناول ≥:</label>
            <input
              type="number"
              min={0}
              max={100}
              value={communionMin}
              onChange={(e) => setCommunionMin(Number(e.target.value) || 0)}
              className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-center"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="font-semibold">الخدمة ≥:</label>
            <input
              type="number"
              min={0}
              max={100}
              value={classMin}
              onChange={(e) => setClassMin(Number(e.target.value) || 0)}
              className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-center"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setReportNameFilter('');
              setMassMin(0);
              setCommunionMin(0);
              setClassMin(0);
            }}
            className="rounded-full bg-blue-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
          >
            مسح الفلاتر
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: 'عدد المخدومين', value: dashboardStats.totalStudents },
            { label: 'الحضور الكامل', value: dashboardStats.presentCount },
            { label: 'القداس (10)', value: dashboardStats.massCount },
            { label: 'التناول (10)', value: dashboardStats.communionCount },
            { label: 'الخدمة (10)', value: dashboardStats.classCount },
          ].map((c) => (
            <div key={c.label} className="rounded-2xl bg-white p-4 text-center shadow-xs">
              <div className="text-xs font-semibold text-gray-500">{c.label}</div>
              <div className="mt-1 text-2xl font-extrabold text-blue-900 tabular-nums">{c.value}</div>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[760px] border-collapse text-center text-sm">
            <thead>
              <tr className="bg-blue-900 text-white">
                <th className="border border-blue-800 p-3">الاسم</th>
                <th className="border border-blue-800 p-3">عدد أيام الحضور</th>
                <th className="border border-blue-800 p-3">إجمالي القداس</th>
                <th className="border border-blue-800 p-3">إجمالي التناول</th>
                <th className="border border-blue-800 p-3">إجمالي الخدمة</th>
                <th className="border border-blue-800 p-3">إجمالي السلوك</th>
                <th className="border border-blue-800 p-3">المجموع الكلي</th>
                <th className="border border-blue-800 p-3">كوبون</th>
              </tr>
            </thead>
            <tbody>
              {filteredReportSummary.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="border border-gray-200 p-3 font-semibold">{s.name}</td>
                  <td className="border border-gray-200 p-3 tabular-nums">{s.totalDays}</td>
                  <td className="border border-gray-200 p-3 tabular-nums">{s.totalMass}</td>
                  <td className="border border-gray-200 p-3 tabular-nums">{s.totalCommunion}</td>
                  <td className="border border-gray-200 p-3 tabular-nums">{s.totalClass}</td>
                  <td className="border border-gray-200 p-3 tabular-nums">{s.totalBehavior}</td>
                  <td className="border border-gray-200 p-3 font-bold text-blue-900 tabular-nums">
                    {s.grandTotal}
                  </td>
                  <td className="border border-gray-200 p-3">
                    <button
                      type="button"
                      onClick={() =>
                        setActiveCoupons([
                          {
                            studentName: s.name,
                            className,
                            startDate,
                            endDate,
                            records: attendanceRecords.filter((r) => r.student_id === s.id),
                          },
                        ])
                      }
                      className="rounded-full bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
                    >
                      🎫 كوبون
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <CouponModal coupons={activeCoupons} onClose={() => setActiveCoupons(null)} />
      </div>
    );
  }

  // Daily Attendance Mode
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
        <div className="flex items-center gap-3">
          <img src={LOGO_URL} alt="شعار" referrerPolicy="no-referrer" className="h-14 w-auto rounded-xl shadow" />
          <span className="text-xl font-bold text-blue-900">
            {isAdmin ? `تسجيل يومي - ${className}` : className}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenAddStudent}
            className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            ➕ إضافة طالب
          </button>
          <button
            type="button"
            onClick={async () => {
              setMode('report');
              await loadRangeData(startDate, endDate);
            }}
            className="rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
          >
            📊 التقارير
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-gray-50 p-4">
        <label className="font-semibold text-gray-700">📅 التاريخ:</label>
        <input
          type="date"
          value={selectedDate}
          onChange={async (e) => {
            const nd = e.target.value;
            setSelectedDate(nd);
            await loadDailyData(nd);
          }}
          className="flex-1 rounded-xl border border-gray-300 bg-white p-3 text-base"
        />
      </div>

      <div className="rounded-2xl bg-gray-50 p-4">
        <label htmlFor="dailyNameFilter" className="ml-3 font-semibold text-gray-700">
          🔍 بحث بالاسم:
        </label>
        <input
          id="dailyNameFilter"
          type="text"
          value={nameSearch}
          onChange={(e) => setNameSearch(e.target.value)}
          placeholder="اكتب جزءاً من الاسم"
          className="mt-2 w-full rounded-xl border border-gray-300 bg-white p-2.5 text-sm sm:mt-0 sm:w-72"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'عدد المخدومين', value: dashboardStats.totalStudents },
          { label: 'الحضور الكامل', value: dashboardStats.presentCount },
          { label: 'القداس (10)', value: dashboardStats.massCount },
          { label: 'التناول (10)', value: dashboardStats.communionCount },
          { label: 'الخدمة (10)', value: dashboardStats.classCount },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl bg-white p-4 text-center shadow-xs">
            <div className="text-xs font-semibold text-gray-500">{c.label}</div>
            <div className="mt-1 text-2xl font-extrabold text-blue-900 tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full min-w-[740px] border-collapse text-center text-sm">
          <thead>
            <tr className="bg-blue-900 text-white">
              <th className="w-[26%] border border-blue-800 p-3">الاسم</th>
              <th className="border border-blue-800 p-3">القداس (0/10)</th>
              <th className="border border-blue-800 p-3">التناول (0/10)</th>
              <th className="border border-blue-800 p-3">حضور الخدمة (0/10)</th>
              <th className="border border-blue-800 p-3">السلوك (0-5)</th>
              <th className="border border-blue-800 p-3">ملاحظات</th>
              <th className="border border-blue-800 p-3">المجموع</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-8 text-gray-500">
                  جاري التحميل...
                </td>
              </tr>
            ) : filteredDailyRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-gray-500">
                  لا يوجد مخدومين مطابقين.
                </td>
              </tr>
            ) : (
              filteredDailyRows.map((row) => {
                const total = row.mass + row.communion + row.classGrade + row.behavior;
                const effectiveLevel: AbsenceLevel = total > 0 ? 0 : row.absenceLevel || 1;
                const badge = getAbsenceBadgeInfo(effectiveLevel);

                const updateField = (
                  patch: Partial<
                    Pick<EditableStudentRow, 'mass' | 'communion' | 'classGrade' | 'behavior' | 'notes'>
                  >,
                ) => {
                  setIsDailyDirty(true);
                  setRows((prev) =>
                    prev.map((item) =>
                      item.student.id === row.student.id ? { ...item, ...patch } : item,
                    ),
                  );
                };

                return (
                  <tr key={row.student.id} className={getAbsenceRowClass(effectiveLevel)}>
                    <td className="border border-gray-200 p-3 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="font-semibold">{row.student.name}</span>
                        {badge && <span className={badge.className}>{badge.text}</span>}
                      </div>
                    </td>
                    <td className="border border-gray-200 p-2">
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={10}
                        value={row.mass}
                        onChange={(e) =>
                          updateField({ mass: clampTenStep(parseInt(e.target.value, 10) || 0) })
                        }
                        className="w-full rounded-lg border border-gray-300 bg-white p-2 text-center text-gray-900 tabular-nums"
                      />
                    </td>
                    <td className="border border-gray-200 p-2">
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={10}
                        value={row.communion}
                        onChange={(e) =>
                          updateField({
                            communion: clampTenStep(parseInt(e.target.value, 10) || 0),
                          })
                        }
                        className="w-full rounded-lg border border-gray-300 bg-white p-2 text-center text-gray-900 tabular-nums"
                      />
                    </td>
                    <td className="border border-gray-200 p-2">
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={10}
                        value={row.classGrade}
                        onChange={(e) =>
                          updateField({
                            classGrade: clampTenStep(parseInt(e.target.value, 10) || 0),
                          })
                        }
                        className="w-full rounded-lg border border-gray-300 bg-white p-2 text-center text-gray-900 tabular-nums"
                      />
                    </td>
                    <td className="border border-gray-200 p-2">
                      <select
                        value={row.behavior}
                        onChange={(e) =>
                          updateField({ behavior: parseInt(e.target.value, 10) || 0 })
                        }
                        className="w-full rounded-lg border border-gray-300 bg-white p-2 text-center text-gray-900 tabular-nums"
                      >
                        {[0, 1, 2, 3, 4, 5].map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="border border-gray-200 p-2">
                      <input
                        type="text"
                        value={row.notes}
                        placeholder="..."
                        onChange={(e) => updateField({ notes: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 bg-white p-2 text-center text-gray-900"
                      />
                    </td>
                    <td className="border border-gray-200 p-2 font-extrabold tabular-nums">
                      {total}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        disabled={saving || students.length === 0}
        onClick={handleSaveDaily}
        className="w-full rounded-full bg-emerald-600 py-4 text-xl font-bold text-white shadow-lg transition hover:bg-emerald-700 disabled:opacity-60"
      >
        {saving ? 'جاري الحفظ...' : 'حفظ الحضور'}
      </button>

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((p) => ({ ...p, open: false }))}
      />
    </div>
  );
};
