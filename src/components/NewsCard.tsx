// vercel-react-best-practices §rerender: RSC — no "use client", pure Tailwind styling
import type { Urgency } from '@/lib/types';
import { UrgencyBadge } from './UrgencyBadge';
import { CopyButton } from './CopyButton';

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
  const copyText = `${item.title}\n📌 팩트: ${item.fact}\n💡 임팩트: ${item.impact}\n🎯 액션: ${item.action}${item.source ? `\n출처: ${item.source}` : ''}`;

  return (
    <article className={`rounded-lg border p-4 shadow-sm hover:shadow-md transition-all duration-200 ease-out group ${URGENCY_BG[item.urgency] ?? URGENCY_BG.note}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="font-semibold text-sm flex-1 leading-snug text-gray-900">
          {item.sourceUrl ? (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-blue-600 hover:underline underline-offset-2 decoration-blue-300 transition-colors duration-150"
            >
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </h4>
        <div className="flex items-center gap-1.5 shrink-0">
          <CopyButton text={copyText} />
          <UrgencyBadge urgency={item.urgency} />
        </div>
      </div>

      <div className="space-y-1 text-xs text-gray-600 leading-relaxed">
        <p><span className="font-semibold text-gray-700">📌 팩트:</span> {item.fact}</p>
        <p><span className="font-semibold text-gray-700">💡 임팩트:</span> {item.impact}</p>
        <p><span className="font-semibold text-gray-700">🎯 액션:</span> {item.action}</p>
      </div>

      {item.contextTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2.5">
          {item.contextTags.map((tag) => (
            <span key={tag} className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full group-hover:bg-gray-200 transition-colors duration-150">
              #{tag}
            </span>
          ))}
        </div>
      )}

      {item.source && (
        <p className="text-xs text-gray-400 mt-2 italic">{item.source}</p>
      )}
    </article>
  );
}
