/**
 * EconCalendar — 오늘 발표 예정 US/KR 경제지표 (2026-09-15 신설).
 *
 * 왜 홈에 두는가: 이 대시보드의 실사용은 부동산 매수 판단이고, 거기서 가장 크게 움직이는
 * 변수가 금리다. 물가·고용·통화량 발표는 그 선행 지표인데 지금까지 어디에도 없었다.
 *
 * 데이터는 investing.com 경제캘린더를 그대로 주입한다(무날조). 값이 없으면 항목을 비워 두고
 * 추정하지 않는다 — 예상치가 없는 지표는 실제로 컨센서스가 집계되지 않은 것이다.
 *
 * 렌더하지 않는 조건은 `loadEconCalendar`가 판단한다(캐시 없음·날짜 불일치·파싱 실패·0건).
 * 주말엔 US/KR 발표가 없어 0건이 정상이므로 "없음" 문구도 띄우지 않는다.
 */

import { loadEconCalendar } from '@/lib/econ-calendar';

const COUNTRY_STYLE: Record<string, string> = {
  US: 'bg-blue-50 text-blue-700 ring-blue-100',
  KR: 'bg-rose-50 text-rose-700 ring-rose-100',
};

export function EconCalendar() {
  const cal = loadEconCalendar();
  if (!cal) return null;

  // 필터 단계는 '예상값 있는 것 우선'으로 정렬돼 있다. 화면에서는 시간순이 읽기 쉽다.
  const events = [...cal.events].sort((a, b) => a.time.localeCompare(b.time)).slice(0, 8);
  const collected = cal.collectedAt.slice(11, 16);

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 px-4 pt-2.5">
        <h2 className="text-sm font-semibold text-gray-700">
          📅 오늘 발표 예정 <span className="font-normal text-gray-400">US·KR 주요 지표</span>
        </h2>
        <span className="text-[11px] text-gray-400">investing.com · {collected} 기준</span>
      </div>
      <ul className="mt-1.5 divide-y divide-gray-100 border-t border-gray-100">
        {events.map((e, i) => (
          <li key={`${e.time}-${e.indicator}-${i}`} className="flex items-baseline gap-2 px-4 py-1.5 text-[13px]">
            <span className="w-11 shrink-0 font-mono tabular-nums text-gray-500">{e.time}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${COUNTRY_STYLE[e.country] ?? 'bg-gray-50 text-gray-600 ring-gray-200'}`}>
              {e.country}
            </span>
            <span className="min-w-0 flex-1 truncate text-gray-800">{e.indicator}</span>
            {(e.forecast || e.previous) && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-gray-400">
                {e.forecast && <>예상 <b className="font-semibold text-gray-600">{e.forecast}</b></>}
                {e.forecast && e.previous && ' · '}
                {e.previous && <>이전 {e.previous}</>}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="px-4 py-1.5 text-[11px] text-gray-400">
        예상치가 비어 있으면 컨센서스가 집계되지 않은 지표입니다. 금리·물가 발표는 대출금리 방향에 직결됩니다.
      </p>
    </section>
  );
}
