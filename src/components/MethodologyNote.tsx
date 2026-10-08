/**
 * MethodologyNote — 투자분석 방법론 + 메뉴 안내를 담은 접이식 헤더.
 *   "이 점수가 어떻게 나오는가"를 페이지 상단에서 한 번에 설명. /listings·/matching 공용.
 *   지역 열기(regionHeat) 가정의 원천인 시장 리서치 출처(market-context.sources)를 링크로 병기.
 */
import Link from 'next/link';
import { readFileSync } from 'fs';
import { join } from 'path';

type CtxSource = string | { title?: string; url?: string };
/** DSR 가정 금리 — config/policy-params.json에서 읽는다(2026-10-08: 4.5%·스트레스 6%가 하드코딩돼 실제 계산과 어긋나 있었다). */
function loadDsr(): { base: number; stress: number } | null {
  try {
    const p = JSON.parse(readFileSync(join(process.cwd(), 'config', 'policy-params.json'), 'utf-8'));
    const base = Number(p?.dsr?.assumedBaseRatePct);
    const add = Number(p?.dsr?.stressAddPctRegulated);
    return Number.isFinite(base) && Number.isFinite(add) ? { base, stress: Math.round((base + add) * 100) / 100 } : null;
  } catch { return null; }
}

function loadCtxSources(): { asOf: string | null; sources: CtxSource[] } {
  try {
    const m = JSON.parse(readFileSync(join(process.cwd(), 'config', 'market-context.json'), 'utf-8'));
    return { asOf: m?.asOf ?? null, sources: Array.isArray(m?.sources) ? m.sources : [] };
  } catch {
    return { asOf: null, sources: [] };
  }
}
const urlOf = (s: CtxSource): string | null => {
  if (typeof s === 'string') { const m = s.match(/https?:\/\/[^\s)"']+/); return m ? m[0] : null; }
  return s.url ?? null;
};
const titleOf = (s: CtxSource): string => (typeof s === 'string' ? s.replace(/https?:\/\/[^\s)"']+/, '').trim() || s : s.title ?? s.url ?? '출처');

const DIMS: { label: string; weight: number; what: string }[] = [
  { label: '예산 적합', weight: 18, what: '2년 후 자기자본이 필요자본을 얼마나 여유롭게 덮는가' },
  { label: '자본수익(ROE)', weight: 22, what: '지역 상승률 가정 하 자기자본 대비 연 수익률' },
  { label: '전세전환 레버리지', weight: 13, what: '2년 후 전세보증금이 잔존대출을 갚고 현금을 빼주는 정도' },
  { label: '보유부담(캐리)', weight: 13, what: '월 원리금이 월 실수령에서 차지하는 비중(실거주=순유출)' },
  { label: '대안 대비 초과수익', weight: 13, what: '연 ROE가 주식·채권 혼합 기대수익을 넘는 폭' },
  { label: '상품성(연식)', weight: 12, what: '준공 연차 밴드 + 세대수(대단지 보너스)' },
  { label: '환금성(실거래)', weight: 9, what: '최근 180일 실거래 건수(팔기 쉬운 정도)' },
];

const MENUS: { href: string; name: string; shows: string }[] = [
  { href: '/recommend', name: '오늘의 추천', shows: '규칙 기반으로 매일 고른 매수 후보 5선(텔레그램 발송분)' },
  { href: '/matching', name: '매수 분석', shows: '준신축 shortlist + 추적 3단지 호가vs실거래 급매 진단 · 아래 3단 투자분석' },
  { href: '/listings', name: '전체 매물', shows: '네이버 수집 전 매물을 종합점수로 정렬 · 매물별 3단 투자분석' },
  { href: '/versus', name: '집vs주식', shows: '아파트 매수 vs S&P500 ETF 10년 장기 비교(조건별 승자 지도)' },
  { href: '/settings', name: '설정', shows: '프로필(재무 전제) 관리 — 지인도 자기 자산 기준으로 분석 가능' },
  { href: '/tracker', name: '재무 트래커', shows: '자기자본·대출한도·2년 매수준비 재무 플랜(소유자 전용)' },
];

export default function MethodologyNote({ current }: { current: '/listings' | '/matching' }) {
  const ctx = loadCtxSources();
  const dsr = loadDsr();
  return (
    <details className="mb-4 rounded-lg border border-gray-200 bg-white open:shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-semibold text-gray-700">
        <span className="text-gray-400">❓</span> 점수는 어떻게 계산되나요? · 메뉴 안내
        <span className="ml-auto text-gray-300 transition group-open:rotate-90">▾</span>
      </summary>
      <div className="space-y-5 border-t border-gray-100 px-4 py-4 text-[13px] leading-relaxed text-gray-600">
        {/* 3단 설명 */}
        <div>
          <div className="mb-1.5 font-bold text-gray-800">각 매물은 3단으로 분해해 보여줍니다</div>
          <ol className="space-y-1.5">
            <li><b className="text-gray-800">① 판단 근거</b> — 계산에 넣은 원천 데이터(매매가·전세가율·실거래·지역상승률·연식·보유자본).</li>
            <li><b className="text-gray-800">② 추론 과정</b> — 그 데이터로 자금조달 → 2년 보유비용 → 자산가치 → 순익 → 전세전환 → 대안비교까지 <b>실제 금액을 대입한 단계별 계산</b>.</li>
            <li><b className="text-gray-800">③ 점수 산출</b> — 7개 영역마다 <b>계산식(공식)</b>에 근거값을 넣어 0~100점을 매기고, 가중 합산해 종합점수를 냅니다.</li>
          </ol>
        </div>

        {/* 영역·가중치 */}
        <div>
          <div className="mb-1.5 font-bold text-gray-800">종합점수 = Σ(영역점수 × 가중치)</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[440px] text-xs">
              <thead>
                <tr className="border-b text-left text-gray-400">
                  <th className="py-1 pr-3">영역</th><th className="py-1 pr-3 text-right">가중치</th><th className="py-1">무엇을 보는가</th>
                </tr>
              </thead>
              <tbody>
                {DIMS.map((x) => (
                  <tr key={x.label} className="border-b last:border-0">
                    <td className="py-1 pr-3 font-medium text-gray-700">{x.label}</td>
                    <td className="py-1 pr-3 text-right font-mono tabular-nums text-gray-500">{x.weight}%</td>
                    <td className="py-1 text-gray-500">{x.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 공통 가정 */}
        <div>
          <div className="mb-1 font-bold text-gray-800">공통 가정</div>
          <p className="leading-relaxed">
            생애최초 <b>LTV 70%</b> · <b>DSR 40%</b>(스트레스 금리 {dsr ? `${dsr.stress}%` : '—'}, 마통 해지 전제) · 주담대 <b>6억 상한</b> · 대출금리 <b>{dsr ? `${dsr.base}%` : '—'}</b>(30년 원리금균등) ·
            집값상승은 <b>지역 열기(regionHeat)</b>로 매물마다 차등(2~5%/년, 보수 −3%p·낙관 +2%p) ·
            대안투자 <b>S&amp;P500 지수 ETF 세전 8%</b>(차익 22%·배당 15.4% 과세 후 비교)·채권 4%(이자세 후) · 취득세 1.1%(생애최초 감면) · 2년 실거주 후 전세/월세 전환.
            통근·상권은 <b>카카오 지도 API 실데이터</b>(최근접역 실거리·자차 실경로·반경 내 편의점/마트/음식점/병원/학원 실측 개수) + 지하철 환승은 좌표 기반 근사.
            재무 전제(자기자본·소득·적립)와 출근지·목적(투자/실거주)은 <b>활성 프로필</b>을 따름 — 설정에서 변경.
          </p>
          {ctx.sources.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-400">
              📎 지역 열기·시장 가정 출처({ctx.asOf ?? '—'} 리서치):
              {ctx.sources.map((s, i) => {
                const u = urlOf(s);
                return u
                  ? <a key={i} href={u} target="_blank" rel="noreferrer" className="rounded border border-gray-200 px-1.5 py-0.5 text-blue-500 hover:border-blue-300 hover:underline">{titleOf(s).slice(0, 40)}</a>
                  : <span key={i} className="rounded border border-gray-100 px-1.5 py-0.5">{titleOf(s).slice(0, 40)} <i className="text-gray-300">(링크 미수집)</i></span>;
              })}
            </div>
          )}
        </div>

        {/* 메뉴 안내 */}
        <div>
          <div className="mb-1.5 font-bold text-gray-800">어떤 메뉴가 무엇을 보여주나</div>
          <ul className="space-y-1">
            {MENUS.map((m) => (
              <li key={m.href} className="flex gap-2">
                {m.href === current
                  ? <span className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-[11px] font-bold text-white">지금 화면</span>
                  : <Link href={m.href} className="shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-[11px] font-medium text-blue-600 hover:border-blue-400">{m.name}</Link>}
                <span className="text-gray-500"><b className="text-gray-700">{m.name}</b> — {m.shows}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}
