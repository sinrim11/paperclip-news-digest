/**
 * RecoCompareTable — 추천 상위 단지 한눈 비교표 (2026-08-29).
 *
 * 추천 페이지가 TOP 20을 세로로만 나열해 7,286px가 됐고, 1위와 7위를 나란히 볼 수 없었다.
 * 카드뉴스에 먼저 넣었던 비교표를 웹에도 이식한다 — 숫자로 먼저 좁히고, 상세는 아래 카드에서.
 * 행 클릭 시 해당 상세 카드로 이동(앵커).
 */

interface CompareRow {
  complexNo: string;
  rank: number;
  name: string;
  gu: string;
  dong: string;
  minPrice: number | null; // 최저 호가(만원)
  tradeMedian: number | null; // 실거래 중간(만원)
  gapPct: number | null;
  household?: number | null;
  elapsedYear?: number | null;
  tradeCount: number;
  monthly?: number | null; // 정책/은행 경로 월 상환(만원)
  cash?: number | null; // 같은 경로에서 필요한 자기자본(만원)
  evidence: string; // 근거 강/중/보류
}

const eok = (m: number) => {
  const v = m / 10000;
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + '억';
};

export function RecoCompareTable({ rows }: { rows: CompareRow[] }) {
  if (rows.length < 2) return null;
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">한눈 비교 <span className="text-sm font-normal text-gray-400">상위 {rows.length}곳</span></h2>
        <span className="text-xs text-gray-400">숫자로 먼저 좁히고, 아래에서 근거를 확인하세요</span>
      </div>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b-2 border-gray-900 text-left text-xs text-gray-500">
              <th scope="col" className="py-2 pr-2 font-medium">단지</th>
              <th scope="col" className="py-2 px-2 text-right font-medium">최저 호가</th>
              <th scope="col" className="py-2 px-2 text-right font-medium">실거래 중간</th>
              <th scope="col" className="py-2 px-2 text-right font-medium">갭</th>
              <th scope="col" className="py-2 px-2 text-right font-medium">필요 현금*</th>
              <th scope="col" className="hidden py-2 px-2 text-right font-medium sm:table-cell">세대·연식</th>
              <th scope="col" className="py-2 pl-2 text-right font-medium">근거</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.complexNo} className="hover:bg-gray-50">
                <td className="py-2.5 pr-2">
                  <a href={`#reco-${r.complexNo}`} className="group">
                    <span className="mr-1.5 text-xs font-bold text-gray-300 tabular-nums">{r.rank}</span>
                    <span className="font-semibold group-hover:text-blue-600 group-hover:underline">{r.name}</span>
                    <span className="ml-1.5 text-xs text-gray-400">{r.gu} {r.dong}</span>
                  </a>
                </td>
                <td className="py-2.5 px-2 text-right font-bold tabular-nums text-blue-700">
                  {r.minPrice ? eok(r.minPrice) : '—'}
                </td>
                <td className="py-2.5 px-2 text-right tabular-nums text-gray-700">
                  {r.tradeMedian ? eok(r.tradeMedian) : '—'}
                  {r.tradeCount > 0 && <span className="ml-1 text-xs text-gray-400">{r.tradeCount}건</span>}
                </td>
                <td className={`py-2.5 px-2 text-right font-semibold tabular-nums ${
                  r.gapPct == null ? 'text-gray-300' : r.gapPct <= 2 ? 'text-emerald-600' : r.gapPct > 10 ? 'text-red-600' : 'text-amber-600'
                }`}>
                  {r.gapPct == null ? '—' : `${r.gapPct >= 0 ? '+' : ''}${r.gapPct}%`}
                </td>
                <td className="py-2.5 px-2 text-right tabular-nums">
                  <span className="font-semibold text-indigo-700">{r.cash ? eok(r.cash) : '—'}</span>
                  {r.monthly ? <span className="block text-xs text-gray-400">월 {r.monthly}만</span> : null}
                </td>
                <td className="hidden py-2.5 px-2 text-right text-xs tabular-nums text-gray-500 sm:table-cell">
                  {r.household ? `${r.household.toLocaleString()}세대` : '—'}
                  {r.elapsedYear != null ? ` · ${r.elapsedYear}년` : ''}
                </td>
                <td className="py-2.5 pl-2 text-right">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    r.evidence.includes('보류') ? 'bg-red-50 text-red-700'
                      : r.evidence.includes('강') ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
                  }`}>{r.evidence}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 text-xs leading-relaxed text-gray-500">
        · <b className="text-emerald-600">갭 마이너스</b> = 호가가 최근 실거래보다 낮음 → 급매 가능성(층·향·동 확인 필수)
        &nbsp;·&nbsp; <b className="text-indigo-700">필요 현금*</b>은 무주택 생애최초 대출 후 남는 자기자본(5억 이하 디딤돌 한도 2.4억, 초과는 시중은행 LTV 70%·30년) — 취득세·중개보수 별도
        &nbsp;·&nbsp; <b>근거</b>는 실거래 표본 수와 갭으로 판정
      </p>
    </section>
  );
}

export type { CompareRow };
