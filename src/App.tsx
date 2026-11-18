import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { Bell, Cake, FileSpreadsheet, Mail, RefreshCw, X } from 'lucide-react';
import { AddStudentModal } from './components/AddStudentModal';
import { BirthdaysView } from './components/BirthdaysView';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ExcelImportModal } from './components/ExcelImportModal';
import { ServantsSection } from './components/ServantsSection';
import { StudentsSection, StudentViewMode } from './components/StudentsSection';
import {
  getSavedEmailRecipients,
  initGoogleAuth,
  markBirthdayEmailSentToday,
  sendBirthdayNotificationEmail,
} from './lib/gmail';
import {
  fetchAllClasses,
  fetchAllServants,
  fetchAllStudents,
  subscribeToRealtimeChanges,
  syncLocalBirthdaysToSupabase,
} from './lib/supabase';
import type { ClassInfo, Servant, Student, ToastMessage } from './types';
import {
  ARABIC_MONTHS,
  buildBirthdayPeople,
  buildWhatsAppGreeting,
  dispatchTodayBirthdayNotifications,
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
} from './utils/birthdays';
import { LOGO_URL } from './utils/helpers';

type AppScreen =
  | 'main'
  | 'allClassesReport'
  | 'servantSelector'
  | 'allServantsReport'
  | 'birthdays';

export default function App() {
  const [initialLoading, setInitialLoading] = useState(true);

  // Shared domain data
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [allServants, setAllServants] = useState<Servant[]>([]);
  const [selectedAdminClassId, setSelectedAdminClassId] = useState('');

  // Screen & modals
  const [screen, setScreen] = useState<AppScreen>('main');
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [showExcelImport, setShowExcelImport] = useState(false);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [needsSqlHint, setNeedsSqlHint] = useState(false);
  const [pendingLocalBirthdaysCount, setPendingLocalBirthdaysCount] = useState(0);
  const [syncVersion, setSyncVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [notifPerm, setNotifPerm] = useState(getBrowserNotificationPermission());

  // Gmail OAuth state (in-memory token only)
  const [gmailUser, setGmailUser] = useState<User | null>(null);
  const [gmailToken, setGmailToken] = useState<string | null>(null);
  const [showQuickEmailConfirm, setShowQuickEmailConfirm] = useState(false);
  const [sendingQuickEmail, setSendingQuickEmail] = useState(false);

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = useCallback(
    (type: ToastMessage['type'], text: string) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((prev) => [...prev.slice(-3), { id, type, text }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    },
    [],
  );

  const isAdmin = true;

  const loadAllData = useCallback(async () => {
    const [cls, stds, srvs] = await Promise.all([
      fetchAllClasses(),
      fetchAllStudents(),
      fetchAllServants(),
    ]);

    const syncRes = await syncLocalBirthdaysToSupabase(stds, srvs);
    setNeedsSqlHint(syncRes.needsColumnMigration);
    setPendingLocalBirthdaysCount(syncRes.pendingLocalCount);

    if (syncRes.syncedCount > 0) {
      const [freshStds, freshSrvs] = await Promise.all([
        fetchAllStudents(),
        fetchAllServants(),
      ]);
      setClasses(cls);
      setAllStudents(freshStds);
      setAllServants(freshSrvs);
    } else {
      setClasses(cls);
      setAllStudents(stds);
      setAllServants(srvs);
    }
  }, []);

  const initializeApp = useCallback(async () => {
    setInitialLoading(true);
    await loadAllData();
    setInitialLoading(false);
  }, [loadAllData]);

  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  // Real-time multi-device sync via Supabase Realtime + tab focus / reconnect refresh
  useEffect(() => {
    const unsubscribeRealtime = subscribeToRealtimeChanges(async (tables) => {
      if (tables.includes('classes') || tables.includes('students') || tables.includes('servants')) {
        await loadAllData();
      }
      setSyncVersion((v) => v + 1);
    });

    const handleResumeSync = async () => {
      if (document.hidden) return;
      await loadAllData();
      setSyncVersion((v) => v + 1);
    };

    window.addEventListener('focus', handleResumeSync);
    window.addEventListener('online', handleResumeSync);
    document.addEventListener('visibilitychange', handleResumeSync);

    return () => {
      unsubscribeRealtime();
      window.removeEventListener('focus', handleResumeSync);
      window.removeEventListener('online', handleResumeSync);
      document.removeEventListener('visibilitychange', handleResumeSync);
    };
  }, [loadAllData]);

  useEffect(() => {
    return initGoogleAuth(
      (u, tok) => {
        setGmailUser(u);
        setGmailToken(tok);
      },
      (u) => {
        setGmailUser(u);
        setGmailToken(null);
      },
    );
  }, []);

  const birthdayPeople = useMemo(
    () => buildBirthdayPeople(allStudents, allServants, classes),
    [allStudents, allServants, classes],
  );

  const todaysBirthdays = useMemo(
    () => birthdayPeople.filter((p) => p.isToday),
    [birthdayPeople],
  );

  const upcomingBirthdays = useMemo(
    () =>
      birthdayPeople
        .filter((p) => !p.isToday && p.daysUntil > 0 && p.daysUntil <= 7)
        .sort((a, b) => a.daysUntil - b.daysUntil),
    [birthdayPeople],
  );

  // Automatic birthday notification dispatch on load + hourly check
  useEffect(() => {
    if (initialLoading || todaysBirthdays.length === 0) return;

    const triggerCheck = () => {
      const { sentCount } = dispatchTodayBirthdayNotifications(todaysBirthdays);
      if (sentCount > 0) {
        pushToast(
          'birthday',
          `🎂 اليوم عيد ميلاد: ${todaysBirthdays.map((p) => p.name).join('، ')}`,
        );
      }
    };

    triggerCheck();
    const timer = window.setInterval(triggerCheck, 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [initialLoading, todaysBirthdays, pushToast]);

  const handleEnableNotificationsFromBell = async () => {
    const perm = await requestBrowserNotificationPermission();
    setNotifPerm(perm);
    if (perm === 'granted') {
      dispatchTodayBirthdayNotifications(todaysBirthdays, { force: true });
      pushToast('success', '✅ تم تفعيل إشعارات أعياد الميلاد بنجاح');
    } else if (perm === 'denied') {
      pushToast('error', '⚠️ الإشعارات محظورة في المتصفح. يرجى السماح بها من إعدادات الموقع.');
    }
  };

  const quickEmailRecipients = useMemo(
    () =>
      getSavedEmailRecipients(gmailUser?.email || '')
        .split(/[،,;\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.includes('@')),
    [gmailUser?.email],
  );

  const handleQuickEmailAction = () => {
    if (!gmailUser || !gmailToken || quickEmailRecipients.length === 0) {
      setScreen('birthdays');
      pushToast('info', 'اربط حساب Gmail وأدخل البريد المستلم لإرسال التنبيه.');
      return;
    }
    setShowQuickEmailConfirm(true);
  };

  const handleConfirmQuickEmail = async () => {
    setShowQuickEmailConfirm(false);
    if (!gmailToken || !gmailUser?.email || quickEmailRecipients.length === 0) return;

    setSendingQuickEmail(true);
    try {
      await sendBirthdayNotificationEmail({
        accessToken: gmailToken,
        toEmails: quickEmailRecipients,
        fromEmail: gmailUser.email,
        todaysBirthdays,
        upcomingBirthdays,
      });
      markBirthdayEmailSentToday();
      pushToast(
        'success',
        `📧 تم إرسال إيميل أعياد ميلاد اليوم إلى ${quickEmailRecipients.join('، ')}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر إرسال الإيميل';
      pushToast('error', msg);
    } finally {
      setSendingQuickEmail(false);
    }
  };

  const activeClassId = selectedAdminClassId || null;
  const activeClassStudents = useMemo(
    () => (activeClassId ? allStudents.filter((s) => s.class_id === activeClassId) : []),
    [allStudents, activeClassId],
  );
  const activeClassName = useMemo(() => {
    if (!activeClassId) return 'الفصل';
    return classes.find((c) => c.id === activeClassId)?.class_name || 'الفصل';
  }, [activeClassId, classes]);

  if (initialLoading) {
    return (
      <div className="app-bg flex min-h-screen items-center justify-center p-4">
        <div className="relative z-10 rounded-3xl bg-white/95 px-8 py-6 text-center shadow-xl">
          <img
            src={LOGO_URL}
            alt="شعار الخدمة"
            referrerPolicy="no-referrer"
            className="mx-auto mb-3 h-16 w-auto rounded-xl"
          />
          <div className="text-lg font-bold text-blue-900">جاري تحميل خدمة خامسة وسادسة...</div>
        </div>
      </div>
    );
  }

  const refreshAllPeople = async () => {
    await loadAllData();
    setSyncVersion((v) => v + 1);
  };

  const handleManualSync = async () => {
    setRefreshing(true);
    await loadAllData();
    setSyncVersion((v) => v + 1);
    setRefreshing(false);
    pushToast('success', '✅ تم تحديث البيانات من السيرفر');
  };

  const handleSyncLocalBirthdays = async () => {
    const res = await syncLocalBirthdaysToSupabase(allStudents, allServants);
    setNeedsSqlHint(res.needsColumnMigration);
    setPendingLocalBirthdaysCount(res.pendingLocalCount);
    if (res.needsColumnMigration) {
      pushToast(
        'error',
        '⚠️ عمود birth_date غير موجود في Supabase بعد. شغّل أمر SQL في Supabase SQL Editor أولاً.',
      );
      return;
    }
    await loadAllData();
    setSyncVersion((v) => v + 1);
    if (res.syncedCount > 0) {
      pushToast('success', `✅ تم مزامنة ${res.syncedCount} تاريخ ميلاد وتسمع الآن على كل الأجهزة!`);
    } else {
      pushToast('success', '✅ جميع التواريخ متزامنة بالفعل على كل الأجهزة!');
    }
  };

  const studentSectionInitialMode: StudentViewMode =
    screen === 'allClassesReport' ? 'allClasses' : 'daily';

  const currentMonthName = ARABIC_MONTHS[new Date().getMonth()];

  return (
    <div className="app-bg min-h-screen p-2.5 sm:p-5">
      <div className="relative z-10 mx-auto max-w-6xl space-y-5 rounded-3xl bg-white/95 p-4 shadow-xl sm:p-6">
        {/* Today's Birthday Alert Banner (always visible when someone has a birthday today) */}
        {todaysBirthdays.length > 0 && screen !== 'birthdays' && (
          <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-gradient-to-l from-amber-50 via-yellow-50 to-rose-50 px-4 py-3 shadow-xs">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎂</span>
              <div>
                <div className="text-sm font-extrabold text-amber-950">
                  اليوم عيد ميلاد {todaysBirthdays.map((p) => p.name).join(' و ')}! 🎉
                </div>
                <div className="text-xs text-amber-800">
                  {todaysBirthdays
                    .map((p) => `${p.name} (${p.role === 'servant' ? 'خادم' : 'مخدوم'} · ${p.className})`)
                    .join(' | ')}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  const text = todaysBirthdays.map((p) => buildWhatsAppGreeting(p)).join('\n\n');
                  try {
                    await navigator.clipboard.writeText(text);
                    pushToast('success', '✅ تم نسخ رسالة التهنئة!');
                  } catch {
                    pushToast('error', 'تعذر النسخ');
                  }
                }}
                className="rounded-full bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-amber-600"
              >
                📋 نسخ التهنئة
              </button>
              <button
                type="button"
                disabled={sendingQuickEmail}
                onClick={handleQuickEmailAction}
                className="inline-flex items-center gap-1 rounded-full bg-indigo-700 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-800 disabled:opacity-50"
              >
                <Mail className="h-3.5 w-3.5" />
                {sendingQuickEmail ? 'جاري الإرسال...' : 'إرسال إيميل اليوم'}
              </button>
              <button
                type="button"
                onClick={() => setScreen('birthdays')}
                className="rounded-full bg-blue-900 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
              >
                عرض أعياد الميلاد
              </button>
            </div>
          </div>
        )}

        {/* Top Bar for Main Screens */}
        {screen === 'main' && (
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
            <div className="flex items-center gap-3">
              <img
                src={LOGO_URL}
                alt="شعار خدمة خامسة وسادسة"
                referrerPolicy="no-referrer"
                className="h-16 w-auto rounded-xl shadow"
              />
              <div>
                <h1 className="text-2xl font-extrabold text-blue-900">خدمة خامسة وسادسة</h1>
                <p className="text-xs font-semibold text-gray-500">
                  {isAdmin ? 'لوحة تحكم الأمين العام' : activeClassName} · شهر {currentMonthName}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Notification Bell Dropdown Trigger */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowNotifPanel((v) => !v)}
                  className="relative inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3.5 py-2.5 text-sm font-bold text-gray-800 hover:bg-gray-200"
                  title="إشعارات أعياد الميلاد"
                >
                  <Bell className="h-4 w-4 text-blue-900" />
                  <span className="tabular-nums">
                    {todaysBirthdays.length + upcomingBirthdays.length}
                  </span>
                </button>

                {showNotifPanel && (
                  <div className="absolute left-0 top-12 z-40 w-80 rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl">
                    <div className="mb-3 flex items-center justify-between border-b border-gray-100 pb-2">
                      <span className="text-sm font-bold text-blue-900">🔔 تنبيهات أعياد الميلاد</span>
                      <button
                        type="button"
                        onClick={() => setShowNotifPanel(false)}
                        className="text-gray-400 hover:text-gray-700"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {notifPerm !== 'granted' && notifPerm !== 'unsupported' && (
                      <button
                        type="button"
                        onClick={handleEnableNotificationsFromBell}
                        className="mb-3 w-full rounded-xl bg-violet-600 py-2 text-xs font-bold text-white hover:bg-violet-700"
                      >
                        🔔 تفعيل إشعارات الجهاز التلقائية
                      </button>
                    )}

                    <div className="max-h-60 space-y-2 overflow-y-auto text-xs">
                      {todaysBirthdays.length === 0 && upcomingBirthdays.length === 0 ? (
                        <p className="py-3 text-center text-gray-500">
                          لا توجد أعياد ميلاد اليوم أو خلال الـ 7 أيام القادمة.
                        </p>
                      ) : (
                        <>
                          {todaysBirthdays.map((p) => (
                            <div
                              key={`today-${p.role}-${p.id}`}
                              className="rounded-xl bg-amber-50 p-2.5 font-semibold text-amber-950"
                            >
                              🎂 <strong>اليوم:</strong> {p.name} ({p.className})
                            </div>
                          ))}
                          {upcomingBirthdays.map((p) => (
                            <div
                              key={`up-${p.role}-${p.id}`}
                              className="rounded-xl bg-sky-50 p-2.5 text-blue-950"
                            >
                              ⏳ بعد {p.daysUntil} {p.daysUntil === 1 ? 'يوم' : 'أيام'}:{' '}
                              <strong>{p.name}</strong> ({p.day} {ARABIC_MONTHS[p.month - 1]})
                            </div>
                          ))}
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setShowNotifPanel(false);
                        setScreen('birthdays');
                      }}
                      className="mt-3 w-full rounded-xl bg-blue-900 py-2 text-xs font-bold text-white hover:bg-blue-700"
                    >
                      فتح التجميع الشهري لأعياد الميلاد
                    </button>
                  </div>
                )}
              </div>

              {isAdmin && (
                <>
                  <button
                    type="button"
                    onClick={() => setScreen('allClassesReport')}
                    className="rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                  >
                    📋 تقرير شامل
                  </button>
                  <button
                    type="button"
                    onClick={() => setScreen('servantSelector')}
                    className="rounded-full bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-600"
                  >
                    👥 حضور الخدام
                  </button>
                  <button
                    type="button"
                    onClick={() => setScreen('allServantsReport')}
                    className="rounded-full bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-700"
                  >
                    📊 تقرير الخدام
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setScreen('birthdays')}
                className="inline-flex items-center gap-1.5 rounded-full bg-pink-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-pink-700"
              >
                <Cake className="h-4 w-4" />
                أعياد الميلاد
                {todaysBirthdays.length > 0 && (
                  <span className="rounded-full bg-white px-1.5 py-0.5 text-xs font-extrabold text-pink-700 tabular-nums">
                    {todaysBirthdays.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowExcelImport(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
              >
                <FileSpreadsheet className="h-4 w-4" />
                استيراد Excel
              </button>

              <button
                type="button"
                disabled={refreshing}
                onClick={handleManualSync}
                className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3.5 py-2.5 text-sm font-semibold text-gray-800 shadow-xs hover:bg-gray-200 disabled:opacity-60"
                title="تحديث البيانات من السيرفر"
              >
                <RefreshCw className={`h-4 w-4 text-blue-900 ${refreshing ? 'animate-spin' : ''}`} />
                تحديث
              </button>
            </div>
          </div>
        )}

        {/* Screen Router */}
        {screen === 'birthdays' && (
          <BirthdaysView
            isAdmin={isAdmin}
            classes={classes}
            students={allStudents}
            servants={allServants}
            userClassId={activeClassId}
            needsSqlMigrationHint={needsSqlHint}
            pendingLocalBirthdaysCount={pendingLocalBirthdaysCount}
            gmailUser={gmailUser}
            gmailToken={gmailToken}
            onGmailConnected={(u, tok) => {
              setGmailUser(u);
              setGmailToken(tok);
            }}
            onGmailDisconnected={() => {
              setGmailUser(null);
              setGmailToken(null);
            }}
            onSyncLocalBirthdays={handleSyncLocalBirthdays}
            onRefreshPeople={refreshAllPeople}
            onToast={pushToast}
            onBack={() => setScreen('main')}
          />
        )}

        {(screen === 'servantSelector' || screen === 'allServantsReport') && (
          <ServantsSection
            initialView={screen === 'servantSelector' ? 'selector' : 'allReport'}
            classes={classes}
            userId={null}
            syncVersion={syncVersion}
            onBack={() => setScreen('main')}
            onToast={pushToast}
          />
        )}

        {screen === 'allClassesReport' && (
          <StudentsSection
            isAdmin={isAdmin}
            userId={null}
            classId={null}
            className="جميع الفصول"
            classes={classes}
            students={[]}
            initialMode={studentSectionInitialMode}
            syncVersion={syncVersion}
            onOpenAddStudent={() => setShowAddStudent(true)}
            onBackToAdminMain={() => setScreen('main')}
            onToast={pushToast}
          />
        )}

        {screen === 'main' && (
          <>
            {isAdmin && (
              <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-gray-50 p-4">
                <label htmlFor="adminClassSelect" className="font-semibold text-gray-700">
                  اختر الفصل:
                </label>
                <select
                  id="adminClassSelect"
                  value={selectedAdminClassId}
                  onChange={(e) => setSelectedAdminClassId(e.target.value)}
                  className="min-w-[220px] flex-1 rounded-xl border border-gray-300 bg-white p-2.5 text-base"
                >
                  <option value="">اختر الفصل</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.class_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {activeClassId ? (
              <StudentsSection
                isAdmin={isAdmin}
                userId={null}
                classId={activeClassId}
                className={activeClassName}
                classes={classes}
                students={activeClassStudents}
                initialMode="daily"
                syncVersion={syncVersion}
                onOpenAddStudent={() => setShowAddStudent(true)}
                onToast={pushToast}
              />
            ) : (
              isAdmin && (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-gray-600">
                  <p className="text-base font-semibold">
                    اختر فصلاً من القائمة أعلاه لتسجيل الحضور، أو افتح 🎂 أعياد الميلاد أو 📤 استيراد Excel.
                  </p>
                </div>
              )
            )}
          </>
        )}
      </div>

      {/* Add Student Modal */}
      <AddStudentModal
        open={showAddStudent}
        isAdmin={isAdmin}
        classes={classes}
        defaultClassId={activeClassId}
        onClose={() => setShowAddStudent(false)}
        onSuccess={async (cid, needsMig) => {
          if (needsMig) setNeedsSqlHint(true);
          if (isAdmin && !selectedAdminClassId) {
            setSelectedAdminClassId(cid);
          }
          await refreshAllPeople();
          pushToast('success', '✅ تم إضافة الطالب بنجاح');
        }}
      />

      {/* Excel Import Modal */}
      <ExcelImportModal
        open={showExcelImport}
        isAdmin={isAdmin}
        classes={classes}
        students={allStudents}
        servants={allServants}
        defaultClassId={activeClassId}
        onClose={() => setShowExcelImport(false)}
        onImported={async (needsMig) => {
          if (needsMig) setNeedsSqlHint(true);
          await refreshAllPeople();
        }}
        onToast={pushToast}
      />

      {/* Quick Birthday Email Confirmation Dialog */}
      <ConfirmDialog
        open={showQuickEmailConfirm}
        title="📧 تأكيد إرسال إيميل أعياد ميلاد اليوم"
        message={`سيتم إرسال إيميل عبر حسابك (${gmailUser?.email || ''}) إلى:\n${quickEmailRecipients.join('، ')}\n\nأعياد ميلاد اليوم (${todaysBirthdays.length}):\n${todaysBirthdays
          .map((p) => `• ${p.name} (${p.className})`)
          .join('\n')}`}
        confirmLabel="تأكيد وإرسال الإيميل"
        cancelLabel="إلغاء"
        onConfirm={handleConfirmQuickEmail}
        onCancel={() => setShowQuickEmailConfirm(false)}
      />

      {/* Toast Stack */}
      {toasts.length > 0 && (
        <div className="no-print fixed bottom-4 left-4 z-50 flex max-w-sm flex-col gap-2">
          {toasts.map((t) => {
            const bg =
              t.type === 'success'
                ? 'bg-emerald-700 text-white'
                : t.type === 'error'
                  ? 'bg-red-700 text-white'
                  : t.type === 'birthday'
                    ? 'bg-amber-500 text-amber-950'
                    : 'bg-blue-900 text-white';
            return (
              <div
                key={t.id}
                className={`rounded-2xl px-4 py-3 text-sm font-bold shadow-xl ${bg}`}
              >
                {t.text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
