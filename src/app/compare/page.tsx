/**
 * /compare — 후보 단지 나란히 비교(최대 4곳). 시간 없는 사용자의 압축 단계:
 *   탐색에서 ☆로 담은 후보를 한 표에서 비교 → 1~2곳으로 좁혀 프로필 검증·임장.
 *   모든 수치는 원천 병기(참고자료 원칙) · 리스크(반대 근거)도 나란히.
 */
import Link from 'next/link';
import { cookies } from 'next/headers';
import { resolveContext, PROFILE_COOKIE } from '@/lib/profiles';
import { getComplexSummary, type ComplexSummary } from '@/lib/complex-summary';
import { RADAR_PART_META } from '@/lib/radar-score';
import DecisionFlow from '@/components/DecisionFlow';
import ProfileBadge from '@/components/ProfileBadge';

export const dynamic = 'force-dynamic';
export const metadata = { title: '단지 비교 | 뉴스 다이제스트' };

const eok = (m: number) => (m / 10000).toFixed(2).replace(/\.?0+$/, '') + '억';

export default async function ComparePage({ searchParams }: { searchParams?: Promise<{ ids?: string }> }) {
  const sp = (await searchParams) ?? {};
  const ids = (sp.ids ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).slice(0, 4);
  const cookieStore = await cookies();
  const ctx = resolveContext(cookieStore.get(PROFILE_COOKIE)?.value);
  const summaries = (await Promise.all(ids.map((id) => getComplexSummary(id, ctx)))).filter(Boolean) as ComplexSummary[];

  if (summaries.length < 2) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <DecisionFlow current={3} />
        <h1 className="text-2xl font-bold tracking-tight">단지 나란히 비교</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-600">
          <b>전체 매물</b>이나 <b>단지 프로필</b>에서 <span className="rounded-full border border-gray-300 px-2 py-0.5 text-xs">☆ 비교</span> 버튼으로 2~4곳을 담으면,
          하단 비교함에서 이 화면으로 넘어와 한 표로 비교할 수 있습니다.
        </p>
        <Link href="/listings" className="mt-4 inline-block rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700">후보 탐색으로 →</Link>
      </main>
    );
  }

  const best = (vals: Array<number | null>, dir: 'min' | 'max') => {
    const nums = vals.filter((v): v is number => v != null);
    if (!nums.length) return null;
    return dir === 'min' ? Math.min(...nums) : Math.max(...nums);
  };
  const hl = (v: number | null, b: number | null) => (v != null && b != null && v === b ? 'bg-emerald-50 font-bold text-emerald-800' : '');

  const rows: Array<{ label: string; sub?: string; vals: Array<{ text: string; cls?: string }> }> = [];
  const push = (label: string, sub: string | undefined, get: (s: ComplexSummary) => number | null, fmt: (v: number | null, s: ComplexSummary) => string, dir: 'min' | 'max' | null) => {
    const raw = summaries.map(get);
    const b = dir ? best(raw, dir) : null;
    rows.push({ label, sub, vals: summaries.map((s, i) => ({ text: fmt(raw[i], s), cls: dir ? hl(raw[i], b) : '' })) });
  };

  push('최저 호가', `매물 수집 ${summaries[0].sweptAt}`, (s) => s.minPrice, (v) => (v ? eok(v) : '-'), 'min');
  push('실거래 중간(180일)', '국토부', (s) => s.tradeMedian, (v, s) => (v ? `${eok(v)} (${s.tradeCount}건)` : '표본 없음'), null);
  push('호가 갭', '호가 vs 실거래 — 낮을수록 거품 적음', (s) => s.gapPct, (v) => (v != null ? `${v >= 0 ? '+' : ''}${v}%` : '-'), 'min');
  push('전세가율', '실거주 수요·방어력', (s) => s.jeonseRatioPct, (v, s) => (v != null ? `${v}% (${s.jeonseCount}건)` : '표본 부족'), 'max');
  push('180일 거래량', '환금성의 실체', (s) => s.tradeCount, (v) => `${v ?? 0}건`, 'max');
  push('매매 매물', '선택지·협상 여지', (s) => s.dealArticles, (v) => `${v ?? 0}건`, 'max');
  push('세대수', undefined, (s) => s.household, (v) => `${v?.toLocaleString()}세대`, 'max');
  push('연식', undefined, (s) => s.elapsedYear, (v) => (v != null ? `${v}년차` : '미상'), null);
  push('용적률', '30년↑이면 낮을수록 재건축 유리', (s) => s.far, (v) => (v != null ? `${Math.round(v)}%` : '-'), null);
  rows.push({ label: '재건축 판정', vals: summaries.map((s) => ({ text: s.rebuild ? s.rebuild.label : '해당 없음', cls: s.rebuild?.good ? 'text-emerald-700 font-semibold' : '' })) });
  push('통근(지하철)', ctx?.work.label, (s) => s.commute?.totalMin ?? null, (v, s) => (s.commute ? `~${v}분 · 환승${s.commute.transfers} (${s.commute.station})` : '-'), 'min');
  push('통근(자차)', undefined, (s) => s.commute?.driveMin ?? null, (v, s) => (v != null ? `~${v}분${s.commute?.driveReal ? '' : '(근사)'}` : '-'), 'min');
  push('상권 점수', '카카오 실측', (s) => s.amenity?.score ?? null, (v) => (v != null ? `${v}점` : '-'), 'max');
  push('레이더 지수', '공개 4지표(개인 무관)', (s) => s.radar.score, (v) => `${v}/100`, 'max');
  if (summaries.some((s) => s.invest)) {
    push('투자점수(내 프로필)', undefined, (s) => s.invest?.totalScore ?? null, (v) => (v != null ? `${v}/100` : '-'), 'max');
    push('연 ROE(기본 상승)', undefined, (s) => s.invest?.roeAnnualPct ?? null, (v) => (v != null ? `${v}%` : '-'), 'max');
    push('필요 자기자본', undefined, (s) => s.invest?.equityIn ?? null, (v, s) => (v != null ? `${eok(v)}${s.invest!.feasibleToday ? ' · 오늘 가능' : s.invest!.feasible2yr ? ' · 2년 후' : ' · 부족 ⚠️'}` : '-'), 'min');
    push('💸 총 월 부담', '원리금+보유세(관리비 별도)', (s) => s.monthly?.total ?? null, (v, s) => (v != null ? `${v.toLocaleString()}만/월 (실수령의 ${s.monthly!.burdenPct}%)` : '-'), 'min');
    push('그중 순수 비용', '이자+보유세(원금은 자산화)', (s) => (s.monthly ? s.monthly.interest + Math.round(s.monthly.propertyTax) : null), (v) => (v != null ? `${v.toLocaleString()}만/월` : '-'), 'min');
    rows.push({ label: '10년 집vs ETF', sub: 'S&P500 8%', vals: summaries.map((s) => ({ text: s.vs ? `${s.vs.winner === 'APT' ? '🏠 매수' : '📈 ETF'} 우위 · 분기 ${s.vs.gStar}%` : '-', cls: s.vs?.winner === 'APT' ? 'text-emerald-700' : '' })) });
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <DecisionFlow current={3} />
      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">단지 나란히 비교 <span className="text-base font-normal text-gray-400">{summaries.length}곳</span></h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-gray-600">🟩 초록 = 해당 지표 우위. 표는 압축용 — 결정 전 각 단지 <b>프로필</b>에서 근거를 검증하고 1~2곳만 임장하세요.</p>
      </header>
      <ProfileBadge />

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="w-44 px-3 py-3 text-left text-xs font-semibold text-gray-500">지표</th>
              {summaries.map((s) => (
                <th key={s.complexNo} className="px-3 py-3 text-left">
                  <Link href={`/complex/${s.complexNo}`} className="text-[15px] font-bold text-gray-900 hover:text-blue-600 hover:underline">{s.name}</Link>
                  <div className="mt-0.5 text-xs font-normal text-gray-500">{s.gu} {s.dong} · 레이더 <b className="font-mono">{s.radar.score}</b></div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b last:border-0">
                <td className="px-3 py-2.5 align-top">
                  <div className="font-semibold text-gray-700">{row.label}</div>
                  {row.sub && <div className="text-[11px] text-gray-400">{row.sub}</div>}
                </td>
                {row.vals.map((v, i) => (
                  <td key={i} className={`px-3 py-2.5 align-top font-mono tabular-nums text-gray-800 ${v.cls ?? ''}`}>{v.text}</td>
                ))}
              </tr>
            ))}
            {/* 설득 게이트 — 시스템 자기검증 판정 */}
            <tr className="border-b">
              <td className="px-3 py-2.5 align-top"><div className="font-semibold text-gray-700">🎯 매수 케이스 판정</div><div className="text-[11px] text-gray-400">시스템 자기검증 — 근거 부족이면 보류</div></td>
              {summaries.map((s) => (
                <td key={s.complexNo} className="px-3 py-2.5 align-top">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${s.buyCase.verdict === '추천 가능' ? 'bg-emerald-600 text-white' : s.buyCase.verdict === '조건부 추천' ? 'bg-amber-500 text-white' : 'bg-red-600 text-white'}`}>{s.buyCase.verdict}</span>
                  <div className="mt-1 text-[11px] text-gray-500">설득력 {s.buyCase.strength}점 · 상세는 프로필</div>
                </td>
              ))}
            </tr>
            {/* 리스크(반대 근거) — 압축 판단의 균형추 */}
            <tr className="border-b last:border-0 bg-red-50/40">
              <td className="px-3 py-2.5 align-top">
                <div className="font-semibold text-red-700">⚠️ 확인할 리스크</div>
                <div className="text-[11px] text-gray-400">데이터 기반 자동 추출</div>
              </td>
              {summaries.map((s) => (
                <td key={s.complexNo} className="px-3 py-2.5 align-top">
                  {s.risks.length === 0 ? <span className="text-gray-400">특이 리스크 없음</span> : (
                    <ul className="space-y-1 text-xs leading-relaxed text-red-800">
                      {s.risks.map((r, i) => <li key={i}>· {r}</li>)}
                    </ul>
                  )}
                </td>
              ))}
            </tr>
            {/* 레이더 세부 */}
            <tr className="border-b last:border-0">
              <td className="px-3 py-2.5 align-top"><div className="font-semibold text-gray-700">레이더 구성</div><div className="text-[11px] text-gray-400">갭40·유동30·연식15·전세15</div></td>
              {summaries.map((s) => (
                <td key={s.complexNo} className="px-3 py-2.5 align-top">
                  <div className="flex h-2.5 w-full max-w-[180px] overflow-hidden rounded-full">
                    {RADAR_PART_META.map((m) => (
                      <div key={m.key} className="relative bg-gray-200" style={{ width: `${m.max}%`, borderRight: '1px solid #fff' }}>
                        <div className="absolute inset-y-0 left-0" style={{ width: `${(s.radar.parts[m.key as keyof typeof s.radar.parts] / m.max) * 100}%`, background: m.color }} />
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 text-[11px] text-gray-500">{RADAR_PART_META.map((m) => `${m.label} ${s.radar.parts[m.key as keyof typeof s.radar.parts]}`).join(' · ')}</div>
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-3 py-3 font-semibold text-gray-700">다음 단계</td>
              {summaries.map((s) => (
                <td key={s.complexNo} className="px-3 py-3">
                  <Link href={`/complex/${s.complexNo}`} className="rounded-full bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700">④ 프로필 검증 →</Link>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <footer className="mt-6 border-t border-gray-100 pt-4 text-xs leading-relaxed text-gray-400">
        🧭 이 표는 사전 조사·분석의 요약(참고자료)입니다 — 최종 판단은 사람이 합니다. 데이터: 국토부 실거래(180일)·네이버 호가·카카오 실측 · 투자 자문 아님
      </footer>
    </main>
  );
}
