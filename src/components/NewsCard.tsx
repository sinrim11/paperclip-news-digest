import type { Urgency } from '@/lib/types';
import { UrgencyBadge } from './UrgencyBadge';

export interface NewsCardData {
  id: string;
  title: string;
  urgency: Urgency;
  fact: string;
  impact: string;
  action: string;
  contextTags: string[];
  source: string;
  sourceUrl: string;
  isTop3: boolean;
  top3Rank?: number | null;
}

const URGENCY_BG: Record<string, string> = {
  breaking: 'bg-red-50 border-red-200',
  watch:    'bg-yellow-50 border-yellow-200',
  note:     'bg-white border-gray-200',
};

export function NewsCard({ item }: { item: NewsCardData }) {
  return (
    <article className={`rounded-lg border p-4 ${URGENCY_BG[item.urgency] ?? URGENCY_BG.note}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="font-medium text-sm flex-1 leading-snug">
          {item.sourceUrl ? (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline hover:text-blue-600"
            >
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </h4>
        <UrgencyBadge urgency={item.urgency} />
      </div>

      <div className="space-y-1 text-xs text-gray-700">
        <p><span className="font-semibold">📌 팩트:</span> {item.fact}</p>
        <p><span className="font-semibold">💡 임팩트:</span> {item.impact}</p>
        <p><span className="font-semibold">🎯 액션:</span> {item.action}</p>
      </div>

      {item.contextTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {item.contextTags.map((tag) => (
            <span key={tag} className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
              #{tag}
            </span>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-2">{item.source}</p>
    </article>
  );
}
