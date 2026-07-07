/**
 * DecisionFlow — 매수 의사결정 5단계 내비(현재 단계 하이라이트).
 *   시간 없는 사용자가 "지금 어디고, 다음은 뭘 하나"를 잃지 않게 하는 흐름 안내.
 *   ① 조건 설정 → ② 후보 탐색 → ③ 나란히 비교 → ④ 단지 검증 → ⑤ 임장·결정
 */
import Link from 'next/link';

const STEPS = [
  { n: 1, label: '조건 설정', href: '/settings', hint: '예산·출근지·목적' },
  { n: 2, label: '후보 탐색', href: '/listings', hint: '점수로 좁히기' },
  { n: 3, label: '나란히 비교', href: '/compare', hint: '☆로 담아 3~4곳' },
  { n: 4, label: '단지 검증', href: null as string | null, hint: '프로필에서 근거 확인' },
  { n: 5, label: '임장·결정', href: null as string | null, hint: '1~2곳만 현장, 판단은 사람' },
];

export default function DecisionFlow({ current }: { current: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <div className="mb-4 overflow-x-auto">
      <div className="flex min-w-fit items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2">
        {STEPS.map((s, i) => {
          const active = s.n === current;
          const inner = (
            <span className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs ${active ? 'bg-gray-900 font-bold text-white' : 'text-gray-500'}`}>
              <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${active ? 'bg-white text-gray-900' : 'bg-gray-200 text-gray-500'}`}>{s.n}</span>
              {s.label}
              {active && <span className="font-normal text-gray-300">· {s.hint}</span>}
            </span>
          );
          return (
            <span key={s.n} className="flex items-center gap-1">
              {s.href && !active ? <Link href={s.href} className="hover:opacity-70">{inner}</Link> : inner}
              {i < STEPS.length - 1 && <span className="text-gray-300">→</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
