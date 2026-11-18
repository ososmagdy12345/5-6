import React, { useMemo, useState } from 'react';
import { Bell, Calendar, Check, Copy, Download, Edit3, FileSpreadsheet, Printer, Search, Sparkles } from 'lucide-react';
import { updatePersonBirthDate } from '../lib/supabase';
import type { BirthdayPerson, ClassInfo, PersonRole, Servant, Student } from '../types';
import {
  ARABIC_MONTHS,
  buildBirthdayPeople,
  buildMonthlyWhatsAppSummary,
  buildWhatsAppGreeting,
  dispatchTodayBirthdayNotifications,
  extractBirthDate,
  getBrowserNotificationPermission,
  groupBirthdaysByMonth,
  isCongratulatedToday,
  markCongratulatedToday,
  playBirthdayChime,
  requestBrowserNotificationPermission,
} from '../utils/birthdays';
import { User } from 'firebase/auth';
import { exportMonthlyBirthdaysToExcel } from '../utils/excel';
import { LOGO_URL, normalizeText } from '../utils/helpers';
import { ExcelImportModal } from './ExcelImportModal';
import { GmailEmailPanel } from './GmailEmailPanel';

interface BirthdaysViewProps {
  isAdmin: boolean;
  classes: ClassInfo[];
  students: Student[];
  servants: Servant[];
  userClassId: string | null;
  needsSqlMigrationHint: boolean;
  pendingLocalBirthdaysCount: number;
  gmailUser: User | null;
  gmailToken: string | null;
  onGmailConnected: (user: User, token: string) => void;
  onGmailDisconnected: () => void;
  onSyncLocalBirthdays: () => Promise<void>;
  onRefreshPeople: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info' | 'birthday', text: string) => void;
  onBack: () => void;
}

interface MissingPersonRow {
  id: string;
  name: string;
  role: PersonRole;
  classId: string;
  className: string;
  birthDate: string | null;
}

export const BirthdaysView: React.FC<BirthdaysViewProps> = ({
  isAdmin,
  classes,
  students,
  servants,
  userClassId,
  needsSqlMigrationHint,
  pendingLocalBirthdaysCount,
  gmailUser,
  gmailToken,
  onGmailConnected,
  onGmailDisconnected,
  onSyncLocalBirthdays,
  onRefreshPeople,
  onToast,
  onBack,
}) => {
  const currentMonth = new Date().getMonth() + 1;

  const [selectedMonth, setSelectedMonth] = useState<number | 'all'>(currentMonth);
  const [roleFilter, setRoleFilter] = useState<'all' | PersonRole>('all');
  const [classFilter, setClassFilter] = useState<string>(isAdmin ? 'all' : userClassId || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewTab, setViewTab] = useState<'monthly' | 'missing'>('monthly');
  const [showSqlGuide, setShowSqlGuide] = useState(needsSqlMigrationHint);

  const [notifPermission, setNotifPermission] = useState(getBrowserNotificationPermission());

  // Inline birthday editor state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Force re-render when congratulating someone today
  const [congratsTick, setCongratsTick] = useState(0);
  const [showExcelImport, setShowExcelImport] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);

  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c.class_name])), [classes]);

  const scopedStudents = useMemo(
    () => (isAdmin || !userClassId ? students : students.filter((s) => s.class_id === userClassId)),
    [students, isAdmin, userClassId],
  );

  const scopedServants = useMemo(
    () => (isAdmin || !userClassId ? servants : servants.filter((sv) => sv.class_id === userClassId)),
    [servants, isAdmin, userClassId],
  );

  const allBirthdayPeople = useMemo(
    () => buildBirthdayPeople(scopedStudents, scopedServants, classes),
    [scopedStudents, scopedServants, classes],
  );

  const filteredBirthdayPeople = useMemo(() => {
    const q = normalizeText(searchQuery);
    return allBirthdayPeople.filter((p) => {
      if (roleFilter !== 'all' && p.role !== roleFilter) return false;
      if (classFilter !== 'all' && p.classId !== classFilter) return false;
      if (q && !normalizeText(p.name).includes(q) && !normalizeText(p.className).includes(q)) return false;
      return true;
    });
  }, [allBirthdayPeople, roleFilter, classFilter, searchQuery]);

  const monthlyGroups = useMemo(
    () => groupBirthdaysByMonth(filteredBirthdayPeople),
    [filteredBirthdayPeople],
  );

  const todaysBirthdays = useMemo(
    () => allBirthdayPeople.filter((p) => p.isToday),
    [allBirthdayPeople],
  );

  const upcomingBirthdays = useMemo(
    () =>
      allBirthdayPeople
        .filter((p) => !p.isToday && p.daysUntil > 0 && p.daysUntil <= 7)
        .sort((a, b) => a.daysUntil - b.daysUntil),
    [allBirthdayPeople],
  );

  const missingBirthdayList = useMemo<MissingPersonRow[]>(() => {
    const q = normalizeText(searchQuery);
    const list: MissingPersonRow[] = [];

    const pushIfMatches = (id: string, name: string, classId: string, role: PersonRole, bdate: string | null) => {
      if (roleFilter !== 'all' && role !== roleFilter) return;
      if (classFilter !== 'all' && classId !== classFilter) return;
      const cName = classMap.get(classId) || 'غير محدد';
      if (q && !normalizeText(name).includes(q) && !normalizeText(cName).includes(q)) return;
      if (!bdate) {
        list.push({ id, name, role, classId, className: cName, birthDate: null });
      }
    };

    scopedStudents.forEach((s) => pushIfMatches(s.id, s.name, s.class_id, 'student', extractBirthDate(s, 'student')));
    scopedServants.forEach((sv) => pushIfMatches(sv.id, sv.name, sv.class_id, 'servant', extractBirthDate(sv, 'servant')));

    return list.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [scopedStudents, scopedServants, roleFilter, classFilter, searchQuery, classMap]);

  const displayedPeopleForMonth = useMemo(() => {
    if (selectedMonth === 'all') {
      return [...filteredBirthdayPeople].sort(
        (a, b) => a.month - b.month || a.day - b.day || a.name.localeCompare(b.name, 'ar'),
      );
    }
    return monthlyGroups.get(selectedMonth) || [];
  }, [selectedMonth, filteredBirthdayPeople, monthlyGroups]);

  const handleEnableNotifications = async () => {
    const perm = await requestBrowserNotificationPermission();
    setNotifPermission(perm);
    if (perm === 'granted') {
      playBirthdayChime();
      const { sentCount } = dispatchTodayBirthdayNotifications(todaysBirthdays, { force: true });
      if (todaysBirthdays.length > 0) {
        onToast('birthday', `🔔 تم تفعيل الإشعارات وإرسال ${sentCount || todaysBirthdays.length} إشعار لأعياد ميلاد اليوم!`);
      } else {
        try {
          new Notification('🎂 إشعارات أعياد الميلاد مفعّلة', {
            body: 'سيصلك تنبيه تلقائي في كل يوم يوافق عيد ميلاد مخدوم أو خادم.',
          });
        } catch {
          // Ignore
        }
        onToast('success', '✅ تم تفعيل إشعارات أعياد الميلاد على هذا الجهاز!');
      }
    } else if (perm === 'denied') {
      onToast('error', '⚠️ تم حظر الإشعارات من إعدادات المتصفح. يرجى السماح بها من أيقونة القفل بجانب الرابط.');
    } else if (perm === 'unsupported') {
      onToast('info', 'ℹ️ متصفحك لا يدعم إشعارات النظام، وستظهر التنبيهات داخل التطبيق دائماً.');
    }
  };

  const handleTestOrTriggerNotification = () => {
    playBirthdayChime();
    if (todaysBirthdays.length === 0) {
      if (notifPermission === 'granted') {
        try {
          new Notification('🎂 تذكير أعياد الميلاد - خدمة خامسة وسادسة', {
            body: `لا يوجد أعياد ميلاد اليوم. إجمالي المسجلين هذا الشهر (${ARABIC_MONTHS[currentMonth - 1]}): ${
              (monthlyGroups.get(currentMonth) || []).length
            }`,
          });
        } catch {
          // Ignore
        }
      }
      onToast(
        'info',
        `لا يوجد أعياد ميلاد اليوم · إجمالي شهر ${ARABIC_MONTHS[currentMonth - 1]}: ${(monthlyGroups.get(currentMonth) || []).length}`,
      );
      return;
    }

    const { sentCount } = dispatchTodayBirthdayNotifications(todaysBirthdays, { force: true });
    onToast(
      'birthday',
      `🎉 اليوم عيد ميلاد ${todaysBirthdays.map((p) => p.name).join('، ')}! ${
        sentCount > 0 ? '(تم إرسال إشعار الجهاز)' : ''
      }`,
    );
  };

  const handleCopyText = async (text: string, successLabel: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast('success', successLabel);
    } catch {
      onToast('error', 'تعذر النسخ التلقائي للحافظة');
    }
  };

  const handleSaveBirthDate = async (role: PersonRole, id: string, dateVal: string) => {
    const key = `${role}_${id}`;
    setSavingKey(key);
    const res = await updatePersonBirthDate(role, id, dateVal || null);
    setSavingKey(null);
    setEditingKey(null);

    if (res.needsColumnMigration) {
      setShowSqlGuide(true);
      onToast(
        'info',
        '✅ تم حفظ تاريخ الميلاد محلياً على هذا الجهاز. لمزامنته مع كل الخدام أضف عمود birth_date في Supabase.',
      );
    } else if (res.savedToDb) {
      onToast('success', '✅ تم حفظ تاريخ الميلاد في قاعدة البيانات بنجاح!');
    } else {
      onToast('info', '✅ تم حفظ تاريخ الميلاد محلياً.');
    }

    await onRefreshPeople();
  };

  const selectedMonthLabel =
    selectedMonth === 'all' ? 'جميع الشهور (تجميع سنوي)' : `شهر ${ARABIC_MONTHS[selectedMonth - 1]}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
        <div className="flex items-center gap-3">
          <img
            src={LOGO_URL}
            alt="شعار خدمة خامسة وسادسة"
            referrerPolicy="no-referrer"
            className="h-16 w-auto rounded-xl shadow"
          />
          <div>
            <h2 className="text-2xl font-extrabold text-blue-900">🎂 أعياد الميلاد والتجميع الشهري</h2>
            <p className="text-sm text-gray-600">
              تجميع أعياد ميلاد المخدومين والخدام لكل شهر · إشعار تلقائي في يوم عيد الميلاد
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleEnableNotifications}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold shadow-sm transition ${
              notifPermission === 'granted'
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-violet-600 text-white hover:bg-violet-700'
            }`}
          >
            <Bell className="h-4 w-4" />
            {notifPermission === 'granted' ? 'إشعارات الجهاز مفعّلة' : 'تفعيل إشعارات الجهاز'}
          </button>

          <button
            type="button"
            onClick={handleTestOrTriggerNotification}
            className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600"
          >
            <Sparkles className="h-4 w-4" />
            إشعار أعياد اليوم
          </button>

          <button
            type="button"
            onClick={() => setShowExcelImport(true)}
            className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            <FileSpreadsheet className="h-4 w-4" />
            📤 استيراد من Excel
          </button>

          <button
            type="button"
            onClick={onBack}
            className="rounded-full bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            🔙 العودة
          </button>
        </div>
      </div>

      {/* Cross-device sync alert if birth_date column is missing or local-only entries exist */}
      {(needsSqlMigrationHint || pendingLocalBirthdaysCount > 0) && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-bold">
                ⚠️ التواريخ المحفوظة حالياً تظهر على هذا الجهاز فقط
                {pendingLocalBirthdaysCount > 0 ? ` (${pendingLocalBirthdaysCount} تاريخ في انتظار المزامنة)` : ''}
              </div>
              <p className="mt-1 text-xs text-amber-900">
                لظهور أعياد الميلاد وتعديلات Excel على كل الأجهزة فوراً، أضف عمود{' '}
                <code className="rounded bg-amber-200/70 px-1 font-mono">birth_date</code> مرة واحدة في Supabase SQL Editor ثم اضغط زر المزامنة.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  handleCopyText(
                    'ALTER TABLE students ADD COLUMN IF NOT EXISTS birth_date date;\nALTER TABLE servants ADD COLUMN IF NOT EXISTS birth_date date;',
                    'تم نسخ أمر SQL — شغّله في Supabase SQL Editor ثم اضغط مزامنة',
                  )
                }
                className="rounded-full bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
              >
                📋 نسخ أمر SQL
              </button>
              <button
                type="button"
                disabled={syncingNow}
                onClick={async () => {
                  setSyncingNow(true);
                  await onSyncLocalBirthdays();
                  setSyncingNow(false);
                }}
                className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {syncingNow ? 'جاري المزامنة...' : '🔄 مزامنة على كل الأجهزة'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Today's Birthdays Highlight + Upcoming 7 Days */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div
          className={`rounded-2xl border p-5 ${
            todaysBirthdays.length > 0
              ? 'border-amber-300 bg-gradient-to-l from-amber-50 to-rose-50'
              : 'border-gray-200 bg-gray-50'
          }`}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-bold text-blue-950">🎉 أعياد ميلاد اليوم</h3>
            <span className="text-sm font-bold text-amber-800 tabular-nums">
              {todaysBirthdays.length} {todaysBirthdays.length === 1 ? 'شخص' : 'أشخاص'}
            </span>
          </div>

          {todaysBirthdays.length === 0 ? (
            <p className="text-sm text-gray-600">
              لا توجد أعياد ميلاد مسجلة بتاريخ اليوم. عند حلول عيد ميلاد أي مخدوم أو خادم سيظهر تنبيه فوري هنا وفي إشعارات الجهاز.
            </p>
          ) : (
            <div className="space-y-2.5">
              {todaysBirthdays.map((person) => {
                const done = isCongratulatedToday(person.role, person.id);
                return (
                  <div
                    key={`${person.role}_${person.id}_${congratsTick}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white p-3 shadow-xs"
                  >
                    <div>
                      <div className="font-bold text-gray-900">
                        🎂 {person.name}
                        <span className="mr-2 text-xs font-semibold text-blue-800">
                          ({person.role === 'servant' ? 'خادم' : 'مخدوم'} · {person.className})
                        </span>
                      </div>
                      {person.ageTurning && (
                        <div className="text-xs text-gray-600 tabular-nums">
                          يتم اليوم {person.ageTurning} سنة
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyText(
                            buildWhatsAppGreeting(person),
                            `تم نسخ رسالة تهنئة ${person.name}`,
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-full bg-blue-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        نسخ التهنئة
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          markCongratulatedToday(person.role, person.id);
                          setCongratsTick((t) => t + 1);
                          onToast('success', `🎉 تم تسجيل تهنئة ${person.name}`);
                        }}
                        className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ${
                          done
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-emerald-600 text-white hover:bg-emerald-700'
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                        {done ? 'تمت التهنئة' : 'تمت'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Upcoming 7 days */}
        <div className="rounded-2xl border border-blue-100 bg-sky-50/70 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-bold text-blue-950">⏳ أعياد الميلاد القادمة (خلال 7 أيام)</h3>
            <span className="text-sm font-bold text-blue-800 tabular-nums">
              {upcomingBirthdays.length} قادم
            </span>
          </div>

          {upcomingBirthdays.length === 0 ? (
            <p className="text-sm text-gray-600">لا توجد أعياد ميلاد خلال الأسبوع القادم.</p>
          ) : (
            <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
              {upcomingBirthdays.map((person) => (
                <div
                  key={`${person.role}_${person.id}`}
                  className="flex items-center justify-between rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-bold text-gray-900">{person.name}</span>
                    <span className="mr-2 text-xs text-gray-500">
                      {person.role === 'servant' ? 'خادم' : 'مخدوم'} · {person.className}
                    </span>
                  </div>
                  <div className="text-left text-xs font-semibold text-blue-900 tabular-nums">
                    {person.day} {ARABIC_MONTHS[person.month - 1]} · بعد{' '}
                    {person.daysUntil === 1 ? 'يوم واحد' : `${person.daysUntil} أيام`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Gmail Email Notifications Panel */}
      <GmailEmailPanel
        gmailUser={gmailUser}
        gmailToken={gmailToken}
        todaysBirthdays={todaysBirthdays}
        upcomingBirthdays={upcomingBirthdays}
        onGmailConnected={onGmailConnected}
        onGmailDisconnected={onGmailDisconnected}
        onToast={onToast}
      />

      {/* 12-Month Grid Grouping */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold text-blue-950">
              <Calendar className="h-5 w-5 text-blue-700" />
              تجميع أعياد الميلاد حسب الشهر
            </h3>
            <p className="text-xs text-gray-500">
              إجمالي الأشخاص المسجل لهم تاريخ ميلاد: {filteredBirthdayPeople.length} · بدون تاريخ ميلاد:{' '}
              {missingBirthdayList.length}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setViewTab('monthly');
                setSelectedMonth('all');
              }}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                viewTab === 'monthly' && selectedMonth === 'all'
                  ? 'bg-blue-900 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              كل الشهور ({filteredBirthdayPeople.length})
            </button>
            <button
              type="button"
              onClick={() => setViewTab(viewTab === 'missing' ? 'monthly' : 'missing')}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                viewTab === 'missing'
                  ? 'bg-amber-500 text-white'
                  : 'bg-amber-50 text-amber-900 hover:bg-amber-100'
              }`}
            >
              إضافة التواريخ الناقصة ({missingBirthdayList.length})
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {ARABIC_MONTHS.map((mName, idx) => {
            const monthNum = idx + 1;
            const bucket = monthlyGroups.get(monthNum) || [];
            const studentCount = bucket.filter((p) => p.role === 'student').length;
            const servantCount = bucket.filter((p) => p.role === 'servant').length;
            const isSelected = viewTab === 'monthly' && selectedMonth === monthNum;
            const isCurrent = monthNum === currentMonth;

            return (
              <button
                key={monthNum}
                type="button"
                onClick={() => {
                  setViewTab('monthly');
                  setSelectedMonth(monthNum);
                }}
                className={`rounded-2xl border p-3 text-right transition ${
                  isSelected
                    ? 'border-blue-900 bg-blue-900 text-white shadow-md'
                    : isCurrent
                      ? 'border-blue-300 bg-sky-50 text-blue-950 hover:border-blue-500'
                      : 'border-gray-200 bg-gray-50 text-gray-800 hover:border-blue-300 hover:bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">{mName}</span>
                  <span
                    className={`text-lg font-extrabold tabular-nums ${
                      isSelected ? 'text-amber-300' : 'text-blue-900'
                    }`}
                  >
                    {bucket.length}
                  </span>
                </div>
                <div
                  className={`mt-1 text-xs tabular-nums ${
                    isSelected ? 'text-blue-100' : 'text-gray-500'
                  }`}
                >
                  {isCurrent ? 'الشهر الحالي · ' : ''}
                  {studentCount} مخدوم · {servantCount} خادم
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters & Export Toolbar */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالاسم أو الفصل..."
              className="w-52 rounded-xl border border-gray-300 bg-white py-2 pr-9 pl-3 text-sm focus:border-blue-600 focus:outline-none"
            />
          </div>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'all' | PersonRole)}
            className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
          >
            <option value="all">الكل (مخدومين + خدام)</option>
            <option value="student">المخدومين فقط</option>
            <option value="servant">الخدام فقط</option>
          </select>

          {isAdmin && (
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
            >
              <option value="all">كل الفصول</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.class_name}
                </option>
              ))}
            </select>
          )}
        </div>

        {viewTab === 'monthly' && (
          <div className="flex flex-wrap items-center gap-2">
            {selectedMonth !== 'all' && (
              <button
                type="button"
                onClick={() =>
                  handleCopyText(
                    buildMonthlyWhatsAppSummary(selectedMonth, displayedPeopleForMonth),
                    `تم نسخ قائمة أعياد ميلاد شهر ${ARABIC_MONTHS[selectedMonth - 1]}`,
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
              >
                <Copy className="h-4 w-4" />
                نسخ قائمة الشهر
              </button>
            )}

            <button
              type="button"
              onClick={() => exportMonthlyBirthdaysToExcel(selectedMonth, displayedPeopleForMonth)}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <Download className="h-4 w-4" />
              تصدير Excel {selectedMonth === 'all' ? '(كل الشهور)' : `(${ARABIC_MONTHS[selectedMonth - 1]})`}
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-900 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Printer className="h-4 w-4" />
              طباعة الكشف
            </button>
          </div>
        )}
      </div>

      {/* Main List: Monthly View OR Missing Birthdays Quick Entry */}
      {viewTab === 'monthly' ? (
        <div id="print-area" className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-blue-950">
              📋 كشف أعياد ميلاد: {selectedMonthLabel}
            </h3>
            <span className="text-sm font-semibold text-gray-600 tabular-nums">
              العدد: {displayedPeopleForMonth.length}
            </span>
          </div>

          {displayedPeopleForMonth.length === 0 ? (
            <div className="rounded-xl bg-gray-50 p-8 text-center text-gray-600">
              <p className="mb-3 font-semibold">لا توجد أعياد ميلاد مسجلة في {selectedMonthLabel}.</p>
              <button
                type="button"
                onClick={() => setViewTab('missing')}
                className="rounded-full bg-blue-900 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                ➕ إضافة تواريخ الميلاد للمخدومين والخدام
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-center text-sm">
                <thead>
                  <tr className="bg-blue-900 text-white">
                    <th className="border border-blue-800 px-3 py-3">اليوم والشهر</th>
                    <th className="border border-blue-800 px-3 py-3 text-right">الاسم</th>
                    <th className="border border-blue-800 px-3 py-3">الصفة</th>
                    <th className="border border-blue-800 px-3 py-3">الفصل</th>
                    <th className="border border-blue-800 px-3 py-3">تاريخ الميلاد</th>
                    <th className="border border-blue-800 px-3 py-3">العمر</th>
                    <th className="border border-blue-800 px-3 py-3">الحالة</th>
                    <th className="no-print border border-blue-800 px-3 py-3">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedPeopleForMonth.map((p) => {
                    const rowKey = `${p.role}_${p.id}`;
                    const isEditing = editingKey === rowKey;
                    const isSaving = savingKey === rowKey;
                    return (
                      <tr
                        key={rowKey}
                        className={
                          p.isToday
                            ? 'bg-amber-50 font-semibold'
                            : p.daysUntil <= 7
                              ? 'bg-sky-50/60'
                              : 'hover:bg-gray-50'
                        }
                      >
                        <td className="border border-gray-200 px-3 py-2.5 font-bold text-blue-900 tabular-nums">
                          {p.day} {ARABIC_MONTHS[p.month - 1]}
                        </td>
                        <td className="border border-gray-200 px-3 py-2.5 text-right font-semibold text-gray-900">
                          {p.isToday ? '🎂 ' : ''}
                          {p.name}
                        </td>
                        <td className="border border-gray-200 px-3 py-2.5">
                          <span
                            className={`text-xs font-bold ${
                              p.role === 'servant' ? 'text-sky-700' : 'text-emerald-700'
                            }`}
                          >
                            {p.role === 'servant' ? 'خادم' : 'مخدوم'}
                          </span>
                        </td>
                        <td className="border border-gray-200 px-3 py-2.5 text-gray-700">
                          {p.className}
                        </td>
                        <td className="border border-gray-200 px-3 py-2.5 tabular-nums">
                          {isEditing ? (
                            <div className="flex items-center justify-center gap-1">
                              <input
                                type="date"
                                value={editingDate}
                                onChange={(e) => setEditingDate(e.target.value)}
                                className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                              />
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => handleSaveBirthDate(p.role, p.id, editingDate)}
                                className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                              >
                                {isSaving ? '...' : 'حفظ'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingKey(null)}
                                className="rounded-lg bg-gray-200 px-2 py-1 text-xs text-gray-700"
                              >
                                إلغاء
                              </button>
                            </div>
                          ) : (
                            p.birthDate
                          )}
                        </td>
                        <td className="border border-gray-200 px-3 py-2.5 tabular-nums">
                          {p.ageTurning ?? '-'}
                        </td>
                        <td className="border border-gray-200 px-3 py-2.5 text-xs tabular-nums">
                          {p.isToday ? (
                            <span className="font-bold text-amber-700">🎉 اليوم عيد ميلاده!</span>
                          ) : p.daysUntil <= 7 ? (
                            <span className="font-semibold text-blue-700">
                              ⏳ بعد {p.daysUntil} {p.daysUntil === 1 ? 'يوم' : 'أيام'}
                            </span>
                          ) : (
                            <span className="text-gray-500">بعد {p.daysUntil} يوم</span>
                          )}
                        </td>
                        <td className="no-print border border-gray-200 px-3 py-2.5">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingKey(rowKey);
                                setEditingDate(p.birthDate);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-200"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              تعديل
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyText(
                                  buildWhatsAppGreeting(p),
                                  `تم نسخ رسالة تهنئة ${p.name}`,
                                )
                              }
                              className="inline-flex items-center gap-1 rounded-lg bg-sky-100 px-2.5 py-1 text-xs font-semibold text-blue-900 hover:bg-sky-200"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              تهنئة
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Quick Entry for Missing Birthdays */
        <div className="rounded-2xl border border-amber-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-bold text-blue-950">
                ✏️ استكمال تواريخ الميلاد الناقصة ({missingBirthdayList.length})
              </h3>
              <p className="text-xs text-gray-500">
                اختر تاريخ الميلاد واضغط حفظ ليظهر فوراً في التجميع الشهري وإشعارات أعياد الميلاد.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setViewTab('monthly')}
              className="rounded-full bg-blue-900 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              عرض التجميع الشهري
            </button>
          </div>

          {missingBirthdayList.length === 0 ? (
            <div className="rounded-xl bg-emerald-50 p-6 text-center font-semibold text-emerald-800">
              ✅ رائع! جميع المخدومين والخدام لديهم تاريخ ميلاد مسجل.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] border-collapse text-center text-sm">
                <thead>
                  <tr className="bg-blue-900 text-white">
                    <th className="border border-blue-800 px-3 py-3 text-right">الاسم</th>
                    <th className="border border-blue-800 px-3 py-3">الصفة</th>
                    <th className="border border-blue-800 px-3 py-3">الفصل</th>
                    <th className="border border-blue-800 px-3 py-3">تاريخ الميلاد</th>
                  </tr>
                </thead>
                <tbody>
                  {missingBirthdayList.map((item) => {
                    const rowKey = `${item.role}_${item.id}`;
                    const isEditing = editingKey === rowKey;
                    const isSaving = savingKey === rowKey;
                    return (
                      <tr key={rowKey} className="hover:bg-gray-50">
                        <td className="border border-gray-200 px-3 py-2.5 text-right font-semibold">
                          {item.name}
                        </td>
                        <td className="border border-gray-200 px-3 py-2.5">
                          {item.role === 'servant' ? 'خادم' : 'مخدوم'}
                        </td>
                        <td className="border border-gray-200 px-3 py-2.5 text-gray-600">
                          {item.className}
                        </td>
                        <td className="border border-gray-200 px-3 py-2.5">
                          {isEditing ? (
                            <div className="flex items-center justify-center gap-2">
                              <input
                                type="date"
                                value={editingDate}
                                onChange={(e) => setEditingDate(e.target.value)}
                                className="rounded-lg border border-gray-300 px-2.5 py-1 text-sm"
                              />
                              <button
                                type="button"
                                disabled={isSaving || !editingDate}
                                onClick={() => handleSaveBirthDate(item.role, item.id, editingDate)}
                                className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                {isSaving ? 'جاري الحفظ...' : 'حفظ'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingKey(null)}
                                className="rounded-lg bg-gray-200 px-2.5 py-1 text-xs text-gray-700"
                              >
                                إلغاء
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingKey(rowKey);
                                setEditingDate('');
                              }}
                              className="rounded-full bg-blue-50 px-4 py-1.5 text-xs font-semibold text-blue-900 hover:bg-blue-100"
                            >
                              📅 تحديد تاريخ الميلاد
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Collapsible Supabase Column Setup Helper */}
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm">
        <button
          type="button"
          onClick={() => setShowSqlGuide((v) => !v)}
          className="font-semibold text-blue-900 hover:underline"
        >
          {showSqlGuide ? '▾ إخفاء' : '▸ عرض'} إعداد عمود تاريخ الميلاد في قاعدة بيانات Supabase
        </button>

        {showSqlGuide && (
          <div className="mt-3 space-y-2 text-gray-700">
            <p className="text-xs">
              إذا لم تكن قد أضفت عمود <code className="rounded bg-gray-200 px-1">birth_date</code> في جدول{' '}
              <code className="rounded bg-gray-200 px-1">students</code> و{' '}
              <code className="rounded bg-gray-200 px-1">servants</code> بعد، نفّذ هذا الأمر في Supabase SQL Editor لمزامنة التواريخ بين جميع أجهزة الخدام:
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-900 p-3 font-mono text-xs text-emerald-300" dir="ltr">
              <span>
                ALTER TABLE students ADD COLUMN IF NOT EXISTS birth_date date; ALTER TABLE servants ADD COLUMN IF NOT EXISTS birth_date date;
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    handleCopyText(
                      'ALTER TABLE students ADD COLUMN IF NOT EXISTS birth_date date;\nALTER TABLE servants ADD COLUMN IF NOT EXISTS birth_date date;',
                      'تم نسخ أمر SQL لـ Supabase',
                    )
                  }
                  className="rounded bg-slate-700 px-2.5 py-1 text-white hover:bg-slate-600"
                >
                  نسخ SQL
                </button>
                <button
                  type="button"
                  disabled={syncingNow}
                  onClick={async () => {
                    setSyncingNow(true);
                    await onSyncLocalBirthdays();
                    setSyncingNow(false);
                  }}
                  className="rounded bg-emerald-600 px-2.5 py-1 text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {syncingNow ? '...' : 'مزامنة الآن'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ExcelImportModal
        open={showExcelImport}
        isAdmin={isAdmin}
        classes={classes}
        students={scopedStudents}
        servants={scopedServants}
        defaultClassId={userClassId}
        onClose={() => setShowExcelImport(false)}
        onImported={async (needsMig) => {
          if (needsMig) setShowSqlGuide(true);
          await onRefreshPeople();
        }}
        onToast={onToast}
      />
    </div>
  );
};
