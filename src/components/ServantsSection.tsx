import React, { useEffect, useMemo, useState } from 'react';
import {
  fetchAllServants,
  fetchServantAttendanceForDate,
  fetchServantAttendanceForRange,
  fetchServantsForClass,
  getServantAbsenceLevel,
  supabaseClient,
} from '../lib/supabase';
import type { AbsenceLevel, ClassInfo, Servant, ServantAttendanceRecord } from '../types';
import { exportAoAToExcel } from '../utils/excel';
import {
  getAbsenceBadgeInfo,
  getAbsenceRowClass,
  getDaysAgo,
  getTodayDate,
  LOGO_URL,
} from '../utils/helpers';
import { ConfirmDialog } from './ConfirmDialog';

type ServantSubView = 'selector' | 'daily' | 'report' | 'detailed' | 'allReport';

interface ServantsSectionProps {
  initialView: 'selector' | 'allReport';
  classes: ClassInfo[];
  userId: string | null;
  onBack: () => void;
  onToast: (type: 'success' | 'error' | 'info' | 'birthday', text: string) => void;
}

interface EditableServantRow {
  servant: Servant;
  attended_mass: boolean;
  attended_opening: boolean;
  attended_fasl: boolean;
  attended_preparation: boolean;
  notes: string;
  absenceLevel: AbsenceLevel;
}

export const ServantsSection: React.FC<ServantsSectionProps> = ({
  initialView,
  classes,
  userId,
  onBack,
  onToast,
}) => {
  const [subView, setSubView] = useState<ServantSubView>(initialView);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedDate, setSelectedDate] = useState(getTodayDate());

  const [rows, setRows] = useState<EditableServantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Confirm overwrite dialog
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });

  // Report state
  const [reportStart, setReportStart] = useState(getDaysAgo(56));
  const [reportEnd, setReportEnd] = useState(getTodayDate());
  const [reportServants, setReportServants] = useState<Servant[]>([]);
  const [reportRecords, setReportRecords] = useState<ServantAttendanceRecord[]>([]);

  const selectedClassName = useMemo(
    () => classes.find((c) => c.id === selectedClassId)?.class_name || '',
    [classes, selectedClassId],
  );

  const loadDailyServants = async (cid: string, date: string) => {
    setLoading(true);
    const list = await fetchServantsForClass(cid);
    const ids = list.map((s) => s.id);
    const att = await fetchServantAttendanceForDate(ids, date);

    const built: EditableServantRow[] = await Promise.all(
      list.map(async (s) => {
        const rec = att.find((a) => a.servant_id === s.id);
        const aM = rec ? rec.attended_mass : false;
        const aO = rec ? rec.attended_opening : false;
        const aF = rec ? rec.attended_fasl : false;
        const aP = rec ? rec.attended_preparation : false;
        const isAbsentAll = !aM && !aO && !aF && !aP;
        const level = await getServantAbsenceLevel(s.id, date, isAbsentAll);
        return {
          servant: s,
          attended_mass: aM,
          attended_opening: aO,
          attended_fasl: aF,
          attended_preparation: aP,
          notes: rec?.notes || '',
          absenceLevel: level,
        };
      }),
    );

    setRows(built);
    setLoading(false);
  };

  const loadClassReport = async (cid: string, s: string, e: string) => {
    setLoading(true);
    const list = await fetchServantsForClass(cid);
    const ids = list.map((x) => x.id);
    const att = await fetchServantAttendanceForRange(ids, s, e);
    setReportServants(list);
    setReportRecords(att);
    setLoading(false);
  };

  const loadAllServantsReport = async (s: string, e: string) => {
    setLoading(true);
    const list = await fetchAllServants();
    const ids = list.map((x) => x.id);
    const att = await fetchServantAttendanceForRange(ids, s, e);
    setReportServants(list);
    setReportRecords(att);
    setLoading(false);
  };

  useEffect(() => {
    if (initialView === 'allReport') {
      loadAllServantsReport(reportStart, reportEnd);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialView]);

  const executeSaveServantAttendance = async () => {
    setSaving(true);
    let hasError = false;
    for (const row of rows) {
      const payload = {
        servant_id: row.servant.id,
        date: selectedDate,
        attended_mass: row.attended_mass,
        attended_opening: row.attended_opening,
        attended_fasl: row.attended_fasl,
        attended_preparation: row.attended_preparation,
        notes: row.notes,
        ...(userId ? { recorded_by: userId } : {}),
      };
      const { error } = await supabaseClient
        .from('servant_attendance')
        .upsert(payload, { onConflict: 'servant_id, date' });
      if (error) {
        console.error(error);
        hasError = true;
      }
    }
    setSaving(false);

    if (hasError) {
      onToast('error', 'حدث خطأ أثناء حفظ حضور الخدام');
    } else {
      onToast('success', '✅ تم حفظ حضور الخدام بنجاح');
      await loadDailyServants(selectedClassId, selectedDate);
    }
  };

  const handleSaveServantAttendance = async () => {
    const ids = rows.map((r) => r.servant.id);
    const { data: existing } = await supabaseClient
      .from('servant_attendance')
      .select('id')
      .eq('date', selectedDate)
      .in('servant_id', ids);

    if (existing && existing.length > 0) {
      setConfirmState({
        open: true,
        title: '⚠️ تنبيه مهم',
        message: `هذا اليوم (${selectedDate}) مسجل بالفعل لحضور الخدام.\nهل تريد تعديل البيانات القديمة؟`,
        onConfirm: () => {
          setConfirmState((prev) => ({ ...prev, open: false }));
          executeSaveServantAttendance();
        },
      });
    } else {
      setConfirmState({
        open: true,
        title: 'تأكيد الحفظ',
        message: 'هل أنت متأكد من حفظ حضور الخدام؟',
        onConfirm: () => {
          setConfirmState((prev) => ({ ...prev, open: false }));
          executeSaveServantAttendance();
        },
      });
    }
  };

  const stats = useMemo(() => {
    const total = rows.length;
    let full = 0;
    let mass = 0;
    let opening = 0;
    let fasl = 0;
    let prep = 0;
    rows.forEach((r) => {
      if (r.attended_mass) mass++;
      if (r.attended_opening) opening++;
      if (r.attended_fasl) fasl++;
      if (r.attended_preparation) prep++;
      if (r.attended_mass && r.attended_opening && r.attended_fasl && r.attended_preparation) full++;
    });
    return { total, full, mass, opening, fasl, prep };
  }, [rows]);

  const classReportSummary = useMemo(() => {
    return reportServants.map((sv) => {
      const recs = reportRecords.filter((r) => r.servant_id === sv.id);
      const valid = recs.filter(
        (y) => y.attended_mass || y.attended_opening || y.attended_fasl || y.attended_preparation,
      );
      return {
        name: sv.name,
        totalDays: valid.length,
        totalMass: recs.filter((y) => y.attended_mass).length,
        totalOpening: recs.filter((y) => y.attended_opening).length,
        totalFasl: recs.filter((y) => y.attended_fasl).length,
        totalPreparation: recs.filter((y) => y.attended_preparation).length,
        totalFull: recs.filter(
          (y) => y.attended_mass && y.attended_opening && y.attended_fasl && y.attended_preparation,
        ).length,
      };
    });
  }, [reportServants, reportRecords]);

  if (subView === 'selector') {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
          <div className="flex items-center gap-3">
            <img src={LOGO_URL} alt="شعار" referrerPolicy="no-referrer" className="h-16 w-auto rounded-xl shadow" />
            <span className="text-2xl font-bold text-blue-900">حضور الخدام</span>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="rounded-full bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            🔙 العودة للرئيسية
          </button>
        </div>

        <div className="space-y-4 rounded-2xl bg-gray-50 p-6">
          <div>
            <label className="mb-2 block font-semibold text-gray-700">👥 اختر الفصل:</label>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="w-full rounded-xl border border-gray-300 bg-white p-3.5 text-base"
            >
              <option value="">اختر الفصل</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.class_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block font-semibold text-gray-700">📅 التاريخ (الجمعة):</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full rounded-xl border border-gray-300 bg-white p-3.5 text-base"
            />
          </div>

          <button
            type="button"
            onClick={async () => {
              if (!selectedClassId) {
                onToast('error', '⚠️ اختر الفصل');
                return;
              }
              if (!selectedDate) {
                onToast('error', '⚠️ اختر التاريخ');
                return;
              }
              setSubView('daily');
              await loadDailyServants(selectedClassId, selectedDate);
            }}
            className="w-full rounded-2xl bg-emerald-600 py-4 text-lg font-bold text-white shadow transition hover:bg-emerald-700"
          >
            📋 عرض كشف الحضور
          </button>
        </div>
      </div>
    );
  }

  if (subView === 'daily') {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
          <div className="flex items-center gap-3">
            <img src={LOGO_URL} alt="شعار" referrerPolicy="no-referrer" className="h-16 w-auto rounded-xl shadow" />
            <span className="text-xl font-bold text-blue-900">حضور الخدام - {selectedClassName}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSubView('selector')}
              className="rounded-full bg-blue-900 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              🔙 العودة
            </button>
            <button
              type="button"
              onClick={async () => {
                setSubView('report');
                await loadClassReport(selectedClassId, reportStart, reportEnd);
              }}
              className="rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
            >
              📊 تقرير حضور
            </button>
          </div>
        </div>

        <div className="rounded-2xl bg-gray-50 p-4">
          <label className="mb-2 block text-sm font-semibold text-gray-700">📅 التاريخ:</label>
          <input
            type="date"
            value={selectedDate}
            onChange={async (e) => {
              const nd = e.target.value;
              setSelectedDate(nd);
              await loadDailyServants(selectedClassId, nd);
            }}
            className="w-full rounded-xl border border-gray-300 bg-white p-3 text-base"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'عدد الخدام', value: stats.total },
            { label: 'حضور كامل', value: stats.full },
            { label: 'القداس', value: stats.mass },
            { label: 'الافتتاحية', value: stats.opening },
            { label: 'حضور الفصل', value: stats.fasl },
            { label: 'التحضير', value: stats.prep },
          ].map((c) => (
            <div key={c.label} className="rounded-2xl bg-white p-4 text-center shadow-xs">
              <div className="text-xs font-semibold text-gray-500">{c.label}</div>
              <div className="mt-1 text-2xl font-extrabold text-blue-900 tabular-nums">{c.value}</div>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[700px] border-collapse text-center text-sm">
            <thead>
              <tr className="bg-blue-900 text-white">
                <th className="w-[30%] border border-blue-800 p-3">الاسم</th>
                <th className="w-[14%] border border-blue-800 p-3">القداس</th>
                <th className="w-[14%] border border-blue-800 p-3">الافتتاحية</th>
                <th className="w-[14%] border border-blue-800 p-3">حضور الفصل</th>
                <th className="w-[14%] border border-blue-800 p-3">التحضير</th>
                <th className="w-[14%] border border-blue-800 p-3">ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-gray-500">
                    جاري التحميل...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-gray-500">
                    لا يوجد خدام مسجلون لهذا الفصل.
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => {
                  const hasAny =
                    row.attended_mass ||
                    row.attended_opening ||
                    row.attended_fasl ||
                    row.attended_preparation;
                  const level: AbsenceLevel = hasAny ? 0 : row.absenceLevel || 1;
                  const badge = getAbsenceBadgeInfo(level);

                  const toggle = (
                    field:
                      | 'attended_mass'
                      | 'attended_opening'
                      | 'attended_fasl'
                      | 'attended_preparation',
                  ) => {
                    setRows((prev) =>
                      prev.map((item, i) =>
                        i === idx ? { ...item, [field]: !item[field] } : item,
                      ),
                    );
                  };

                  return (
                    <tr key={row.servant.id} className={getAbsenceRowClass(level)}>
                      <td className="border border-gray-200 p-3 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <span className="font-semibold">{row.servant.name}</span>
                          {badge && <span className={badge.className}>{badge.text}</span>}
                        </div>
                      </td>
                      <td className="border border-gray-200 p-3">
                        <input
                          type="checkbox"
                          checked={row.attended_mass}
                          onChange={() => toggle('attended_mass')}
                          className="h-7 w-7 cursor-pointer accent-emerald-600"
                        />
                      </td>
                      <td className="border border-gray-200 p-3">
                        <input
                          type="checkbox"
                          checked={row.attended_opening}
                          onChange={() => toggle('attended_opening')}
                          className="h-7 w-7 cursor-pointer accent-emerald-600"
                        />
                      </td>
                      <td className="border border-gray-200 p-3">
                        <input
                          type="checkbox"
                          checked={row.attended_fasl}
                          onChange={() => toggle('attended_fasl')}
                          className="h-7 w-7 cursor-pointer accent-emerald-600"
                        />
                      </td>
                      <td className="border border-gray-200 p-3">
                        <input
                          type="checkbox"
                          checked={row.attended_preparation}
                          onChange={() => toggle('attended_preparation')}
                          className="h-7 w-7 cursor-pointer accent-emerald-600"
                        />
                      </td>
                      <td className="border border-gray-200 p-3">
                        <input
                          type="text"
                          value={row.notes}
                          placeholder="ملاحظات"
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, notes: e.target.value } : item,
                              ),
                            )
                          }
                          className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-center text-gray-900"
                        />
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
          disabled={saving || rows.length === 0}
          onClick={handleSaveServantAttendance}
          className="w-full rounded-full bg-emerald-600 py-4 text-lg font-bold text-white shadow-lg transition hover:bg-emerald-700 disabled:opacity-60"
        >
          {saving ? 'جاري الحفظ...' : '💾 حفظ حضور الخدام'}
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
  }

  if (subView === 'report') {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
          <div className="flex items-center gap-3">
            <img src={LOGO_URL} alt="شعار" referrerPolicy="no-referrer" className="h-16 w-auto rounded-xl shadow" />
            <span className="text-xl font-bold text-blue-900">تقرير حضور الخدام - {selectedClassName}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSubView('daily')}
              className="rounded-full bg-blue-900 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              🔙 العودة للتسجيل
            </button>
            <button
              type="button"
              onClick={() => setSubView('detailed')}
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              📋 تقرير مفصل
            </button>
            <button
              type="button"
              onClick={() => {
                const wsData: (string | number)[][] = [
                  ['الاسم', 'عدد التسجيلات', 'حضور القداس', 'حضور الافتتاحية', 'حضور الفصل', 'حضور التحضير', 'حضور كامل'],
                  ...classReportSummary.map((x) => [
                    x.name,
                    x.totalDays,
                    x.totalMass,
                    x.totalOpening,
                    x.totalFasl,
                    x.totalPreparation,
                    x.totalFull,
                  ]),
                ];
                exportAoAToExcel(
                  'حضور الخدام',
                  `تقرير_حضور_الخدام_${selectedClassName}_${new Date().toLocaleDateString('en-CA')}.xlsx`,
                  wsData,
                );
              }}
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              📥 تصدير Excel
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-gray-50 p-4">
          <label className="text-sm font-semibold">من تاريخ:</label>
          <input
            type="date"
            value={reportStart}
            onChange={(e) => setReportStart(e.target.value)}
            className="rounded-xl border border-gray-300 bg-white p-2.5 text-sm"
          />
          <label className="text-sm font-semibold">إلى تاريخ:</label>
          <input
            type="date"
            value={reportEnd}
            onChange={(e) => setReportEnd(e.target.value)}
            className="rounded-xl border border-gray-300 bg-white p-2.5 text-sm"
          />
          <button
            type="button"
            onClick={() => loadClassReport(selectedClassId, reportStart, reportEnd)}
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
                <th className="border border-blue-800 p-3">عدد التسجيلات</th>
                <th className="border border-blue-800 p-3">حضور القداس</th>
                <th className="border border-blue-800 p-3">حضور الافتتاحية</th>
                <th className="border border-blue-800 p-3">حضور الفصل</th>
                <th className="border border-blue-800 p-3">حضور التحضير</th>
                <th className="border border-blue-800 p-3">حضور كامل</th>
              </tr>
            </thead>
            <tbody>
              {classReportSummary.map((x) => (
                <tr key={x.name} className="hover:bg-gray-50">
                  <td className="border border-gray-200 p-3 font-semibold">{x.name}</td>
                  <td className="border border-gray-200 p-3 tabular-nums">{x.totalDays}</td>
                  <td className="border border-gray-200 p-3 tabular-nums">{x.totalMass}</td>
                  <td className="border border-gray-200 p-3 tabular-nums">{x.totalOpening}</td>
                  <td className="border border-gray-200 p-3 tabular-nums">{x.totalFasl}</td>
                  <td className="border border-gray-200 p-3 tabular-nums">{x.totalPreparation}</td>
                  <td className="border border-gray-200 p-3 font-bold text-blue-900 tabular-nums">{x.totalFull}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (subView === 'detailed') {
    const servantMap = new Map(reportServants.map((x) => [x.id, x.name]));
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
          <div className="flex items-center gap-3">
            <img src={LOGO_URL} alt="شعار" referrerPolicy="no-referrer" className="h-16 w-auto rounded-xl shadow" />
            <span className="text-xl font-bold text-blue-900">تقرير حضور الخدام المفصل - {selectedClassName}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSubView('report')}
              className="rounded-full bg-blue-900 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              🔙 العودة للموجز
            </button>
            <button
              type="button"
              onClick={() => {
                const wsData: (string | number)[][] = [
                  ['الاسم', 'التاريخ', 'القداس', 'الافتتاحية', 'حضور الفصل', 'التحضير', 'ملاحظات'],
                  ...reportRecords.map((r) => [
                    servantMap.get(r.servant_id) || 'غير معروف',
                    r.date,
                    r.attended_mass ? 'حاضر' : 'غائب',
                    r.attended_opening ? 'حاضر' : 'غائب',
                    r.attended_fasl ? 'حاضر' : 'غائب',
                    r.attended_preparation ? 'حاضر' : 'غائب',
                    r.notes || '',
                  ]),
                ];
                exportAoAToExcel(
                  'تقرير مفصل',
                  `تقرير_حضور_الخدام_مفصل_${selectedClassName}_${new Date().toLocaleDateString('en-CA')}.xlsx`,
                  wsData,
                );
              }}
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              📥 تصدير Excel
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-gray-50 p-4">
          <label className="text-sm font-semibold">من تاريخ:</label>
          <input
            type="date"
            value={reportStart}
            onChange={(e) => setReportStart(e.target.value)}
            className="rounded-xl border border-gray-300 bg-white p-2.5 text-sm"
          />
          <label className="text-sm font-semibold">إلى تاريخ:</label>
          <input
            type="date"
            value={reportEnd}
            onChange={(e) => setReportEnd(e.target.value)}
            className="rounded-xl border border-gray-300 bg-white p-2.5 text-sm"
          />
          <button
            type="button"
            onClick={() => loadClassReport(selectedClassId, reportStart, reportEnd)}
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
                <th className="border border-blue-800 p-3">الافتتاحية</th>
                <th className="border border-blue-800 p-3">حضور الفصل</th>
                <th className="border border-blue-800 p-3">التحضير</th>
                <th className="border border-blue-800 p-3">ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {reportRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-gray-500">
                    لا توجد بيانات في هذه الفترة
                  </td>
                </tr>
              ) : (
                reportRecords.map((r, idx) => (
                  <tr key={`${r.servant_id}-${r.date}-${idx}`} className="hover:bg-gray-50">
                    <td className="border border-gray-200 p-3 font-semibold">
                      {servantMap.get(r.servant_id) || 'غير معروف'}
                    </td>
                    <td className="border border-gray-200 p-3 tabular-nums">{r.date}</td>
                    <td className="border border-gray-200 p-3">{r.attended_mass ? '✅' : '❌'}</td>
                    <td className="border border-gray-200 p-3">{r.attended_opening ? '✅' : '❌'}</td>
                    <td className="border border-gray-200 p-3">{r.attended_fasl ? '✅' : '❌'}</td>
                    <td className="border border-gray-200 p-3">{r.attended_preparation ? '✅' : '❌'}</td>
                    <td className="border border-gray-200 p-3">{r.notes || ''}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // allReport: All classes servants report
  const grouped = classes.map((cls) => {
    const cs = reportServants.filter((x) => x.class_id === cls.id);
    const data = cs.map((x) => {
      const r = reportRecords.filter((y) => y.servant_id === x.id);
      const valid = r.filter(
        (y) => y.attended_mass || y.attended_opening || y.attended_fasl || y.attended_preparation,
      );
      return {
        name: x.name,
        totalDays: valid.length,
        totalMass: r.filter((y) => y.attended_mass).length,
        totalOpening: r.filter((y) => y.attended_opening).length,
        totalFasl: r.filter((y) => y.attended_fasl).length,
        totalPreparation: r.filter((y) => y.attended_preparation).length,
        totalFull: r.filter(
          (y) => y.attended_mass && y.attended_opening && y.attended_fasl && y.attended_preparation,
        ).length,
      };
    });
    return { className: cls.class_name, data };
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
        <div className="flex items-center gap-3">
          <img src={LOGO_URL} alt="شعار" referrerPolicy="no-referrer" className="h-16 w-auto rounded-xl shadow" />
          <span className="text-xl font-bold text-blue-900">تقرير حضور الخدام - جميع الفصول</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full bg-blue-900 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            🔙 العودة للرئيسية
          </button>
          <button
            type="button"
            onClick={() => {
              const wsData: (string | number)[][] = [
                ['الفصل', 'الاسم', 'عدد التسجيلات', 'حضور القداس', 'حضور الافتتاحية', 'حضور الفصل', 'حضور التحضير', 'حضور كامل'],
              ];
              grouped.forEach((g) => {
                g.data.forEach((x) =>
                  wsData.push([
                    g.className,
                    x.name,
                    x.totalDays,
                    x.totalMass,
                    x.totalOpening,
                    x.totalFasl,
                    x.totalPreparation,
                    x.totalFull,
                  ]),
                );
              });
              exportAoAToExcel(
                'حضور الخدام',
                `تقرير_حضور_الخدام_مجمع_${new Date().toLocaleDateString('en-CA')}.xlsx`,
                wsData,
              );
            }}
            className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            📥 تصدير Excel مجمع
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-gray-50 p-4">
        <label className="text-sm font-semibold">من تاريخ:</label>
        <input
          type="date"
          value={reportStart}
          onChange={(e) => setReportStart(e.target.value)}
          className="rounded-xl border border-gray-300 bg-white p-2.5 text-sm"
        />
        <label className="text-sm font-semibold">إلى تاريخ:</label>
        <input
          type="date"
          value={reportEnd}
          onChange={(e) => setReportEnd(e.target.value)}
          className="rounded-xl border border-gray-300 bg-white p-2.5 text-sm"
        />
        <button
          type="button"
          onClick={() => loadAllServantsReport(reportStart, reportEnd)}
          className="rounded-full bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          عرض
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-500">جاري تحميل تقرير الخدام...</div>
      ) : (
        grouped.map(
          (g) =>
            g.data.length > 0 && (
              <div key={g.className} className="space-y-2">
                <h3 className="text-lg font-bold text-blue-900">{g.className}</h3>
                <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
                  <table className="w-full min-w-[700px] border-collapse text-center text-sm">
                    <thead>
                      <tr className="bg-blue-900 text-white">
                        <th className="border border-blue-800 p-3">الاسم</th>
                        <th className="border border-blue-800 p-3">عدد التسجيلات</th>
                        <th className="border border-blue-800 p-3">حضور القداس</th>
                        <th className="border border-blue-800 p-3">حضور الافتتاحية</th>
                        <th className="border border-blue-800 p-3">حضور الفصل</th>
                        <th className="border border-blue-800 p-3">حضور التحضير</th>
                        <th className="border border-blue-800 p-3">حضور كامل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.data.map((x) => (
                        <tr key={x.name} className="hover:bg-gray-50">
                          <td className="border border-gray-200 p-3 font-semibold">{x.name}</td>
                          <td className="border border-gray-200 p-3 tabular-nums">{x.totalDays}</td>
                          <td className="border border-gray-200 p-3 tabular-nums">{x.totalMass}</td>
                          <td className="border border-gray-200 p-3 tabular-nums">{x.totalOpening}</td>
                          <td className="border border-gray-200 p-3 tabular-nums">{x.totalFasl}</td>
                          <td className="border border-gray-200 p-3 tabular-nums">{x.totalPreparation}</td>
                          <td className="border border-gray-200 p-3 font-bold text-blue-900 tabular-nums">
                            {x.totalFull}
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
};
