import React, { useState } from 'react';
import { addStudent } from '../lib/supabase';
import type { ClassInfo } from '../types';

interface AddStudentModalProps {
  open: boolean;
  isAdmin: boolean;
  classes: ClassInfo[];
  defaultClassId: string | null;
  onClose: () => void;
  onSuccess: (classId: string, needsColumnMigration?: boolean) => void;
}

export const AddStudentModal: React.FC<AddStudentModalProps> = ({
  open,
  isAdmin,
  classes,
  defaultClassId,
  onClose,
  onSuccess,
}) => {
  const [name, setName] = useState('');
  const [selectedClassId, setSelectedClassId] = useState(defaultClassId || '');
  const [birthDate, setBirthDate] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const effectiveClassId = isAdmin ? selectedClassId || defaultClassId || '' : defaultClassId || '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setErrorMsg('⚠️ الرجاء إدخال اسم الطالب');
      return;
    }
    if (!effectiveClassId) {
      setErrorMsg('⚠️ الرجاء اختيار الفصل');
      return;
    }

    setSaving(true);
    setErrorMsg('');
    const result = await addStudent(trimmed, effectiveClassId, birthDate);
    setSaving(false);

    if (!result.ok) {
      setErrorMsg(result.error || 'حدث خطأ أثناء الإضافة');
      return;
    }

    setName('');
    setBirthDate('');
    onSuccess(effectiveClassId, result.needsColumnMigration);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-xl font-bold text-blue-900">➕ إضافة طالب جديد</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="newStudentName" className="mb-1 block text-sm font-semibold text-gray-700">
              اسم الطالب:
            </label>
            <input
              id="newStudentName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="أدخل الاسم كاملاً"
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-blue-600 focus:outline-none"
            />
          </div>

          {isAdmin && (
            <div>
              <label htmlFor="newStudentClass" className="mb-1 block text-sm font-semibold text-gray-700">
                الفصل:
              </label>
              <select
                id="newStudentClass"
                value={effectiveClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base focus:border-blue-600 focus:outline-none"
              >
                <option value="">اختر الفصل</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.class_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="newStudentBirthDate" className="mb-1 block text-sm font-semibold text-gray-700">
              🎂 تاريخ الميلاد (اختياري):
            </label>
            <input
              id="newStudentBirthDate"
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base focus:border-blue-600 focus:outline-none"
            />
          </div>

          {errorMsg && (
            <div className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {errorMsg}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-full bg-blue-900 px-5 py-3 text-base font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-full bg-amber-500 px-5 py-3 text-base font-semibold text-white transition hover:bg-amber-600"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
