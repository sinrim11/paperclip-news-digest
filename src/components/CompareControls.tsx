'use client';

/**
 * CompareControls — 단지 비교 선택 UX(localStorage 기반, 최대 4곳).
 *   CompareToggle: 카드/프로필의 ⭐ 비교담기 버튼 · CompareBar: 하단 플로팅 "비교하기(N)" 바.
 */
import { useEffect, useState, useCallback } from 'react';

const KEY = 'compare_complexes'; // [{no, name}]
interface Item { no: string; name: string }

function load(): Item[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
function save(items: Item[]) {
  localStorage.setItem(KEY, JSON.stringify(items.slice(0, 4)));
  window.dispatchEvent(new Event('compare-changed'));
}

export function CompareToggle({ complexNo, name }: { complexNo: string; name: string }) {
  const [on, setOn] = useState(false);
  const sync = useCallback(() => setOn(load().some((i) => i.no === complexNo)), [complexNo]);
  useEffect(() => { sync(); window.addEventListener('compare-changed', sync); return () => window.removeEventListener('compare-changed', sync); }, [sync]);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault(); e.stopPropagation();
        const items = load();
        if (items.some((i) => i.no === complexNo)) save(items.filter((i) => i.no !== complexNo));
        else { if (items.length >= 4) { alert('비교는 최대 4곳까지입니다'); return; } save([...items, { no: complexNo, name }]); }
      }}
      title={on ? '비교에서 제거' : '비교에 담기'}
      className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${on ? 'border-amber-400 bg-amber-100 text-amber-800' : 'border-gray-300 bg-white text-gray-500 hover:border-amber-400 hover:text-amber-700'}`}
    >
      {on ? '★ 비교담김' : '☆ 비교'}
    </button>
  );
}

export function CompareBar() {
  const [items, setItems] = useState<Item[]>([]);
  const sync = useCallback(() => setItems(load()), []);
  useEffect(() => { sync(); window.addEventListener('compare-changed', sync); return () => window.removeEventListener('compare-changed', sync); }, [sync]);
  if (items.length === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[92vw] items-center gap-2 rounded-full border border-gray-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur">
      <span className="text-xs font-semibold text-gray-500">비교함</span>
      {items.map((i) => (
        <span key={i.no} className="flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">
          {i.name}
          <button type="button" onClick={() => save(load().filter((x) => x.no !== i.no))} className="text-gray-400 hover:text-red-500">×</button>
        </span>
      ))}
      {items.length >= 2 ? (
        <a href={`/compare?ids=${items.map((i) => i.no).join(',')}`} className="rounded-full bg-gray-900 px-4 py-1.5 text-xs font-bold text-white hover:bg-gray-700">
          나란히 비교 ({items.length}) →
        </a>
      ) : (
        <span className="text-xs text-gray-400">1곳 더 담으면 비교 가능</span>
      )}
    </div>
  );
}
