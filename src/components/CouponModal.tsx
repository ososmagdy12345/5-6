import React from 'react';
import type { AttendanceRecord } from '../types';
import { LOGO_URL } from '../utils/helpers';

export interface CouponItem {
  studentName: string;
  className: string;
  startDate: string;
  endDate: string;
  records: AttendanceRecord[];
}

interface CouponModalProps {
  coupons: CouponItem[] | null;
  onClose: () => void;
}

export const CouponModal: React.FC<CouponModalProps> = ({ coupons, onClose }) => {
  if (!coupons || coupons.length === 0) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="no-print absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-xl font-bold text-gray-600 hover:bg-gray-200"
          aria-label="إغلاق"
        >
          ×
        </button>

        <div id="print-area" className="space-y-6">
          {coupons.map((coupon, idx) => {
            let tM = 0;
            let tC = 0;
            let tCl = 0;
            let tB = 0;
            coupon.records.forEach((r) => {
              tM += r.mass_grade || 0;
              tC += r.communion_grade || 0;
              tCl += r.class_grade || 0;
              tB += r.behavior_grade || 0;
            });
            const grand = tM + tC + tCl + tB;
            const days = coupon.records.length;

            return (
              <div
                key={`${coupon.studentName}-${idx}`}
                className="rounded-2xl bg-white p-4"
                style={{ pageBreakAfter: idx < coupons.length - 1 ? 'always' : 'auto' }}
              >
                <div className="mb-4 text-center">
                  <img
                    src={LOGO_URL}
                    alt="شعار الخدمة"
                    referrerPolicy="no-referrer"
                    className="mx-auto h-20 w-auto rounded-lg"
                  />
                  <h2 className="mt-2 text-xl font-bold text-blue-900">خدمة خامسة وسادسة</h2>
                  <h3 className="text-base font-semibold text-gray-700">كوبون تميز</h3>
                </div>

                <div className="rounded-2xl border-2 border-dashed border-blue-900 p-5 text-sm">
                  <div className="mb-3 flex justify-between">
                    <span className="font-bold text-gray-700">اسم المخدوم:</span>
                    <span className="font-bold text-blue-900">{coupon.studentName}</span>
                  </div>
                  <div className="mb-3 flex justify-between">
                    <span className="font-bold text-gray-700">الفصل:</span>
                    <span className="text-blue-900">{coupon.className}</span>
                  </div>
                  <div className="mb-3 flex justify-between">
                    <span className="font-bold text-gray-700">الفترة:</span>
                    <span className="tabular-nums">
                      {coupon.startDate} إلى {coupon.endDate}
                    </span>
                  </div>
                  <div className="mb-3 flex justify-between">
                    <span className="font-bold text-gray-700">عدد أيام الحضور:</span>
                    <span className="font-bold tabular-nums">{days}</span>
                  </div>

                  <div className="my-3 border-t border-gray-200" />

                  <div className="mb-2 flex justify-between">
                    <span>إجمالي درجات القداس:</span>
                    <span className="font-semibold tabular-nums">{tM}</span>
                  </div>
                  <div className="mb-2 flex justify-between">
                    <span>إجمالي درجات التناول:</span>
                    <span className="font-semibold tabular-nums">{tC}</span>
                  </div>
                  <div className="mb-2 flex justify-between">
                    <span>إجمالي درجات الخدمة:</span>
                    <span className="font-semibold tabular-nums">{tCl}</span>
                  </div>
                  <div className="mb-2 flex justify-between">
                    <span>إجمالي درجات السلوك:</span>
                    <span className="font-semibold tabular-nums">{tB}</span>
                  </div>

                  <div className="mt-4 rounded-xl bg-sky-100 p-4 text-center">
                    <div className="text-xs font-semibold text-blue-900">المجموع الكلي</div>
                    <div className="text-4xl font-extrabold text-blue-900 tabular-nums">{grand}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handlePrint}
          className="no-print mt-4 w-full rounded-full bg-blue-900 px-6 py-3 text-base font-semibold text-white transition hover:bg-blue-700"
        >
          🖨️ طباعة {coupons.length > 1 ? `(${coupons.length} كوبون)` : 'الكوبون'}
        </button>
      </div>
    </div>
  );
};
