import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import type { BirthdayPerson } from '../types';
import { ARABIC_MONTHS, buildWhatsAppGreeting } from '../utils/birthdays';
import { getTodayDate } from '../utils/helpers';

export const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({ prompt: 'select_account' });

// In-memory token storage ONLY (never localStorage/sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initGoogleAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: (user: User | null) => void,
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.(user);
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.(null);
    }
  });
};

export const signInWithGoogleGmail = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('تعذر الحصول على تصريح الوصول لحساب Gmail.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getGmailAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const googleSignOut = async (): Promise<void> => {
  cachedAccessToken = null;
  await auth.signOut();
};

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function utf8ToBase64Url(text: string): string {
  return utf8ToBase64(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeRfc2047Subject(subject: string): string {
  return `=?UTF-8?B?${utf8ToBase64(subject)}?=`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const EMAIL_SENT_KEY_PREFIX = 'sunday_school_bday_email_sent_';
const RECIPIENTS_KEY = 'sunday_school_bday_email_recipients';

export function getSavedEmailRecipients(fallbackEmail?: string | null): string {
  try {
    const saved = localStorage.getItem(RECIPIENTS_KEY);
    if (saved !== null && saved.trim() !== '') return saved;
  } catch {
    // Ignore
  }
  return fallbackEmail || '';
}

export function saveEmailRecipients(recipients: string): void {
  try {
    localStorage.setItem(RECIPIENTS_KEY, recipients);
  } catch {
    // Ignore
  }
}

export function wasBirthdayEmailSentToday(): boolean {
  try {
    return localStorage.getItem(`${EMAIL_SENT_KEY_PREFIX}${getTodayDate()}`) === '1';
  } catch {
    return false;
  }
}

export function markBirthdayEmailSentToday(): void {
  try {
    localStorage.setItem(`${EMAIL_SENT_KEY_PREFIX}${getTodayDate()}`, '1');
  } catch {
    // Ignore
  }
}

export async function sendBirthdayNotificationEmail(params: {
  accessToken: string;
  toEmails: string[];
  fromEmail: string;
  todaysBirthdays: BirthdayPerson[];
  upcomingBirthdays?: BirthdayPerson[];
}): Promise<void> {
  const { accessToken, toEmails, fromEmail, todaysBirthdays, upcomingBirthdays = [] } = params;

  const cleanRecipients = toEmails.map((e) => e.trim()).filter(Boolean);
  if (cleanRecipients.length === 0) {
    throw new Error('يرجى إدخال بريد إلكتروني مستلم واحد على الأقل.');
  }

  const today = new Date();
  const dateLabel = `${today.getDate()} ${ARABIC_MONTHS[today.getMonth()]} ${today.getFullYear()}`;
  const namesList = todaysBirthdays.map((p) => p.name).join('، ');
  const subject =
    todaysBirthdays.length > 0
      ? `🎂 تذكير أعياد ميلاد اليوم (${dateLabel}): ${namesList}`
      : `🎂 تقرير أعياد الميلاد - خدمة خامسة وسادسة (${dateLabel})`;

  const todayItemsHtml =
    todaysBirthdays.length > 0
      ? todaysBirthdays
          .map((p) => {
            const roleLabel = p.role === 'servant' ? 'خادم' : 'مخدوم';
            const ageText = p.ageTurning ? ` · يتم ${p.ageTurning} سنة` : '';
            const greeting = escapeHtml(buildWhatsAppGreeting(p)).replace(/\n/g, '<br/>');
            return `
              <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:14px;padding:14px;margin-bottom:12px;">
                <div style="font-size:16px;font-weight:bold;color:#1e3a8a;">🎂 ${escapeHtml(p.name)}</div>
                <div style="font-size:13px;color:#4b5563;margin-top:4px;">${roleLabel} · ${escapeHtml(p.className)}${ageText}</div>
                <div style="margin-top:10px;padding:10px;background:#ffffff;border-radius:10px;font-size:12px;color:#374151;border:1px dashed #d1d5db;">
                  <strong>رسالة تهنئة جاهزة:</strong><br/>
                  ${greeting}
                </div>
              </div>
            `;
          })
          .join('')
      : `<p style="color:#4b5563;font-size:14px;">لا توجد أعياد ميلاد مسجلة بتاريخ اليوم (${dateLabel}).</p>`;

  const upcomingHtml =
    upcomingBirthdays.length > 0
      ? `
        <div style="margin-top:20px;padding-top:14px;border-top:1px solid #e5e7eb;">
          <h3 style="margin:0 0 10px 0;font-size:15px;color:#1e3a8a;">⏳ أعياد الميلاد القادمة خلال 7 أيام</h3>
          <ul style="margin:0;padding-right:18px;color:#374151;font-size:13px;line-height:1.8;">
            ${upcomingBirthdays
              .map(
                (p) =>
                  `<li><strong>${escapeHtml(p.name)}</strong> (${p.role === 'servant' ? 'خادم' : 'مخدوم'} · ${escapeHtml(p.className)}) — ${p.day} ${ARABIC_MONTHS[p.month - 1]}</li>`,
              )
              .join('')}
          </ul>
        </div>
      `
      : '';

  const htmlBody = `<!doctype html>
<html lang="ar" dir="rtl">
<body style="margin:0;padding:20px;background:#f3f4f6;font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:18px;padding:24px;border:1px solid #e5e7eb;">
    <div style="text-align:center;border-bottom:2px solid #eff6ff;padding-bottom:14px;margin-bottom:18px;">
      <h2 style="margin:0;color:#1e3a8a;font-size:20px;">🎂 خدمة خامسة وسادسة - مدارس الأحد</h2>
      <p style="margin:6px 0 0 0;color:#6b7280;font-size:13px;">تنبيه أعياد ميلاد اليوم · ${dateLabel}</p>
    </div>
    ${todayItemsHtml}
    ${upcomingHtml}
  </div>
</body>
</html>`;

  const bodyBase64 = utf8ToBase64(htmlBody);
  const rawMessage = [
    `From: ${fromEmail}`,
    `To: ${cleanRecipients.join(', ')}`,
    `Subject: ${encodeRfc2047Subject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    bodyBase64,
  ].join('\r\n');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: utf8ToBase64Url(rawMessage),
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg = errData?.error?.message || `فشل إرسال الإيميل (${res.status})`;
    throw new Error(msg);
  }
}
