import type { Urgency } from '@/lib/types';

const CONFIG: Record<Urgency, { label: string; className: string }> = {
  breaking: { label: '🔴 속보', className: 'bg-red-100 text-red-700 border-red-200' },
  watch:    { label: '🟡 주목', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  note:     { label: '🔵 참고', className: 'bg-blue-100 text-blue-600 border-blue-200' },
};

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  const { label, className } = CONFIG[urgency] ?? CONFIG.note;
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${className}`}>
      {label}
    </span>
  );
}
