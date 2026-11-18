import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { CheckCircle2, LogOut, Mail, Send } from 'lucide-react';
import {
  getSavedEmailRecipients,
  googleSignOut,
  markBirthdayEmailSentToday,
  saveEmailRecipients,
  sendBirthdayNotificationEmail,
  signInWithGoogleGmail,
  wasBirthdayEmailSentToday,
} from '../lib/gmail';
import type { BirthdayPerson } from '../types';
import { ConfirmDialog } from './ConfirmDialog';

interface GmailEmailPanelProps {
  gmailUser: User | null;
  gmailToken: string | null;
  todaysBirthdays: BirthdayPerson[];
  upcomingBirthdays: BirthdayPerson[];
  onGmailConnected: (user: User, token: string) => void;
  onGmailDisconnected: () => void;
  onToast: (type: 'success' | 'error' | 'info' | 'birthday', text: string) => void;
}

export const GmailEmailPanel: React.FC<GmailEmailPanelProps> = ({
  gmailUser,
  gmailToken,
  todaysBirthdays,
  upcomingBirthdays,
  onGmailConnected,
  onGmailDisconnected,
  onToast,
}) => {
  const [recipientsInput, setRecipientsInput] = useState(() =>
    getSavedEmailRecipients(gmailUser?.email || ''),
  );
  const [connecting, setConnecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentToday, setSentToday] = useState(wasBirthdayEmailSentToday());
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (gmailUser?.email && !recipientsInput.trim()) {
      const saved = getSavedEmailRecipients(gmailUser.email);
      setRecipientsInput(saved || gmailUser.email);
    }
  }, [gmailUser?.email, recipientsInput]);

  const parsedRecipients = recipientsInput
    .split(/[،,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));

  const handleConnectGoogle = async () => {
    setConnecting(true);
    try {
      const res = await signInWithGoogleGmail();
      onGmailConnected(res.user, res.accessToken);
      if (!recipientsInput.trim() && res.user.email) {
        setRecipientsInput(res.user.email);
        saveEmailRecipients(res.user.email);
      }
      onToast('success', `✅ تم ربط حساب Gmail (${res.user.email}) بنجاح!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر تسجيل الدخول عبر Google';
      onToast('error', msg);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    await googleSignOut();
    onGmailDisconnected();
    onToast('info', 'تم فصل حساب Gmail.');
  };

  const handleConfirmSend = async () => {
    setShowConfirm(false);
    if (!gmailToken || !gmailUser?.email) {
      onToast('error', 'يرجى تسجيل الدخول بحساب Google أولاً.');
      return;
    }

    setSending(true);
    try {
      saveEmailRecipients(recipientsInput);
      await sendBirthdayNotificationEmail({
        accessToken: gmailToken,
        toEmails: parsedRecipients,
        fromEmail: gmailUser.email,
        todaysBirthdays,
        upcomingBirthdays,
      });
      markBirthdayEmailSentToday();
      setSentToday(true);
      onToast(
        'success',
        `📧 تم إرسال إيميل أعياد ميلاد اليوم بنجاح إلى ${parsedRecipients.join('، ')}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'حدث خطأ أثناء إرسال الإيميل';
      onToast('error', msg);
    } finally {
      setSending(false);
    }
  };

  const confirmMessage =
    todaysBirthdays.length > 0
      ? `سيتم إرسال رسالة بريد إلكتروني عبر حسابك (${gmailUser?.email}) إلى:\n${parsedRecipients.join('، ')}\n\nتتضمن أعياد ميلاد اليوم (${todaysBirthdays.length}):\n${todaysBirthdays
          .map((p) => `• ${p.name} (${p.className})`)
          .join('\n')}`
      : `لا توجد أعياد ميلاد مسجلة اليوم.\nهل تريد إرسال ملخص أعياد الميلاد القادمة إلى:\n${parsedRecipients.join('، ')}؟`;

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-indigo-700" />
          <h3 className="text-lg font-bold text-blue-950">📧 إشعارات البريد الإلكتروني (Gmail)</h3>
        </div>

        {sentToday && (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            تم إرسال إيميل اليوم
          </span>
        )}
      </div>

      {!gmailToken || !gmailUser ? (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-gray-700">
            اربط حساب Gmail لإرسال رسالة تذكير يومية بأعياد ميلاد اليوم على البريد الإلكتروني.
          </p>

          {/* Official Google Sign-In styled button */}
          <button
            type="button"
            disabled={connecting}
            onClick={handleConnectGoogle}
            className="inline-flex items-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 shadow-xs transition hover:bg-gray-50 disabled:opacity-60"
          >
            <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            <span>{connecting ? 'جاري الربط...' : 'Sign in with Google · ربط Gmail'}</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-700">
            <span>
              الحساب المربوط: <strong className="text-blue-900" dir="ltr">{gmailUser.email}</strong>
            </span>
            <button
              type="button"
              onClick={handleDisconnectGoogle}
              className="inline-flex items-center gap-1 text-red-700 hover:underline"
            >
              <LogOut className="h-3.5 w-3.5" />
              فصل الحساب
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              dir="ltr"
              value={recipientsInput}
              onChange={(e) => {
                setRecipientsInput(e.target.value);
                saveEmailRecipients(e.target.value);
              }}
              placeholder="name@gmail.com, another@gmail.com"
              className="min-w-[240px] flex-1 rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm focus:border-indigo-600 focus:outline-none"
            />

            <button
              type="button"
              disabled={sending || parsedRecipients.length === 0}
              onClick={() => setShowConfirm(true)}
              className="inline-flex items-center gap-2 rounded-full bg-indigo-700 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-800 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {sending
                ? 'جاري الإرسال...'
                : todaysBirthdays.length > 0
                  ? `إرسال إيميل أعياد اليوم (${todaysBirthdays.length})`
                  : 'إرسال تقرير أعياد الميلاد'}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            يمكنك كتابة أكثر من بريد إلكتروني مفصولين بفاصلة لإرسال التنبيه لكل خدام الفصل.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={showConfirm}
        title="📧 تأكيد إرسال إشعار أعياد الميلاد بالبريد"
        message={confirmMessage}
        confirmLabel="تأكيد وإرسال الإيميل"
        cancelLabel="إلغاء"
        onConfirm={handleConfirmSend}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
