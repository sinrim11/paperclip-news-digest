import Link from 'next/link';
import { loadPolicyParams } from '@/lib/tracker';

export const dynamic = 'force-dynamic';

export const metadata = { title: '부동산 정책 가이드 | 뉴스 다이제스트' };

const S = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-lg border bg-white p-5">
    <h2 className="text-lg font-bold text-gray-900">{title}</h2>
    <div className="mt-3 space-y-3 text-sm leading-relaxed text-gray-700">{children}</div>
  </section>
);

const Table = ({ head, rows }: { head: string[]; rows: (string | React.ReactNode)[][] }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[520px] text-sm">
      <thead>
        <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
          {head.map((h) => (
            <th key={h} className="px-3 py-2">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b align-top last:border-0">
            {r.map((c, j) => (
              <td key={j} className={`px-3 py-2 ${j === 0 ? 'font-medium text-gray-900' : ''}`}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const OK = () => <span className="font-bold text-green-600">가능</span>;
const NO = () => <span className="font-bold text-red-500">불가</span>;

export default function PolicyGuidePage() {
  const params = loadPolicyParams();

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">📚 무주택 실수요자를 위한 부동산 정책 가이드</h1>
        <p className="mt-1 text-sm text-gray-500">
          기준일 {params?.asOf ?? '2026-07-03'} · 서울에서 첫 집을 준비하는 무주택자 관점으로 정리 ·{' '}
          <Link href="/tracker" className="text-blue-600 hover:underline">매수 트래커 →</Link>
        </p>
        <p className="mt-2 rounded bg-amber-50 p-3 text-xs text-amber-800">
          ⚠️ 정책은 수시로 변경됩니다. 실행 전 반드시 최신 공고문·은행 심사·국토부/금융위 발표로 확인하세요. 이
          페이지는 참고용 요약이며 금융 자문이 아닙니다.
        </p>
      </header>

      <S title="1. 현행 규제 지형 (10·15 대책 체계)">
        <Table
          head={['항목', '내용']}
          rows={[
            ['규제지역', '서울 전역 + 경기 12곳(과천·광명·성남 분당 등) 투기과열지구·조정대상지역. 2026-06-30 동탄·용인 기흥·구리 추가 — 확대 기조'],
            ['토지거래허가구역', <>서울 전역 등. <b>매수 후 4개월 내 입주 + 2년 실거주 의무</b> → 전세 끼고 매수(갭투자) 불가</>],
            ['LTV', <><b>규제지역 40%</b> (서민·실수요자 +10%p 우대 → 50%) · 비규제 70%</>],
            ['주담대 한도', '주택가 15억 이하 → 최대 6억 · 15~25억 → 4억 · 25억 초과 → 2억'],
            ['DSR', <>총 40% + <b>스트레스 DSR 3단계</b>: 수도권·규제지역 가산 +3.0%p, 그 외 +1.2%p (한도 산정 시 가산금리 적용)</>],
            ['전세대출', '1주택자 전세대출도 DSR 반영'],
          ]}
        />
      </S>

      <S title="2. 정책대출·혜택 자격표">
        <Table
          head={['제도', '핵심 요건', '내용']}
          rows={[
            ['디딤돌대출', '부부합산 소득 6천만 이하 (생애최초 7천 · 신혼 8.5천), 5억 이하 주택', '한도 2~3.2억, 저금리. 만 30세 미만 단독세대주 제외'],
            ['보금자리론', '소득 7천만 이하 (신혼 8.5천 · 자녀 9천~1억), 6억 이하 주택', '한도 3.6~4.2억, LTV 최대 70%'],
            ['서민·실수요자 우대', '규제지역, 무주택, 소득 8천만 이하 (생애최초 9천만 이하)', '규제지역 LTV·DTI +10%p 우대 — 소득이 정책대출을 초과하는 실수요자의 사실상 유일한 대출 우대'],
            ['생애최초 취득세 감면', '12억 이하 주택, 생애 첫 취득', '취득세 100% 감면 (한도 200만 원, 소형·인구감소지역 300만) — 2026년 연장'],
          ]}
        />
        <p className="text-xs text-gray-500">
          요점: 연소득 7천만을 넘는 순간 정책대출은 대부분 닫히고, <b>서민·실수요자 우대(생초 9천만) + 취득세 감면 +
          청약</b>이 남는다.
        </p>
      </S>

      <S title="3. 청약 — 1인가구·중소득자 관점">
        <Table
          head={['트랙', '1인가구', '소득 기준', '비고']}
          rows={[
            ['민영 일반공급 추첨제', <OK key="a" />, <b key="b">없음</b>, '85㎡ 이하 규제지역: 가점 60% + 추첨 40%, 추첨분의 75% 무주택자 우선 — 가점 낮은 1인가구의 핵심 루트'],
            ['민영 생애최초 특공', '가능 (60㎡ 이하만)', '도시근로자 월평균소득 130~160%', '1인가구 소득기준이 낮아 연 7천만대 초과 시 탈락 가능 — 공고별 확인'],
            ['공공 생애최초 특공', <NO key="c" />, '—', '1인가구는 공공 생초 특공 신청 불가'],
            ['공공 일반공급', <OK key="d" />, '순차제', '3년 무주택 + 청약통장 저축총액 경쟁 (서울 당첨선 통상 2천만 원+)'],
          ]}
        />
        <p className="text-xs text-gray-500">
          가점제는 무주택기간·부양가족·통장기간 합산 84점 만점 — 부양가족 0인 1인가구는 구조적으로 불리해 추첨제
          물량을 노리는 것이 합리적. 민영 서울 85㎡ 이하 예치금 300만 원 충족 필요.
        </p>
      </S>

      <S title="4. 내 대출 한도 계산 원리 (스트레스 DSR)">
        <p>
          은행은 <b>연간 원리금 상환액 ≤ 연소득 × 40%</b>가 되도록 한도를 자르되, 금리는 실제 금리가 아니라{' '}
          <b>스트레스 가산이 붙은 금리</b>(수도권 +3.0%p)로 계산합니다. 30년 원리금균등 기준:
        </p>
        <div className="rounded bg-gray-50 p-3 font-mono text-xs">
          월 상환 한도 = 연소득 × 40% ÷ 12<br />
          산정 금리 = 명목 금리(예: 4%) + 스트레스 가산(수도권 3.0%p) = 7%<br />
          대출 한도 = 월 상환 한도 ÷ (7%·30년 원리금균등 월 상환액 per 1원)
        </div>
        <p>
          예시 — 연소득 1억: 월 한도 333만 → 7% 기준 대출 상한 약 5.0억. 하지만 규제지역에서는{' '}
          <b>LTV 40~50%가 먼저 구속</b>되는 경우가 대부분이라, 자기자본이 예산을 결정합니다: 최대 매수가 ≈ 자기자본 ÷
          (1 − LTV).
        </p>
      </S>

      <S title="5. 시장을 읽는 두 개의 렌즈">
        <Table
          head={['낙관(상승) 논거', '신중(둔화) 논거']}
          rows={[
            ['2026 서울 입주 약 1.6만 세대 — 전년 대비 60% 급감, 역대 최저', '규제 확대 기조 지속 (2026-06-30 규제지역 추가 지정)'],
            ['2026~2028 공급 공백기 (20~22년 인허가 급감의 후폭풍)', '토지거래허가제로 거래 동결 — 매물 잠김 속 호가 중심 시장'],
            ['금리 인하 국면 + 유동성', '스트레스 DSR로 실수요 구매력 자체가 제한'],
            ['전문가 다수 상승 전망', '과거 토허 해제 → 급등 → 재지정 전례: 정책 변동성 리스크'],
          ]}
        />
        <p className="text-xs text-gray-500">
          무주택 실수요자에게 함의: 시장 방향 맞히기보다 <b>규제 완화·금리 인하 같은 "요건 변화"가 감지되는 즉시
          움직일 준비</b>(자본·청약통장·사전 가심사)를 해두는 것이 우위다.
        </p>
      </S>

      <S title="6. 출처">
        <ul className="list-inside list-disc space-y-1 text-xs">
          <li><a className="text-blue-600 hover:underline" href="https://www.korea.kr/news/policyNewsView.do?newsId=148950959" target="_blank" rel="noreferrer">대한민국 정책브리핑 — 주담대 한도 축소</a></li>
          <li><a className="text-blue-600 hover:underline" href="https://www.korea.kr/news/policyNewsView.do?newsId=148950973" target="_blank" rel="noreferrer">정책브리핑 — 서울 전역·경기 12곳 투기과열지구·토허구역 지정</a></li>
          <li><a className="text-blue-600 hover:underline" href="https://www.fsc.go.kr/po020201/85518" target="_blank" rel="noreferrer">금융위원회 — 가계부채 정책문답</a></li>
          <li><a className="text-blue-600 hover:underline" href="https://www.hf.go.kr/ko/sub01/sub01_02_01.do" target="_blank" rel="noreferrer">한국주택금융공사 — 디딤돌대출</a> · <a className="text-blue-600 hover:underline" href="https://www.hf.go.kr/ko/sub01/sub01_01_01.do" target="_blank" rel="noreferrer">보금자리론</a></li>
          <li><a className="text-blue-600 hover:underline" href="https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000016&nttId=123270" target="_blank" rel="noreferrer">행정안전부 — 생애최초 취득세 감면 운영기준 (고시 2026-3호)</a></li>
          <li><a className="text-blue-600 hover:underline" href="https://easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=1773&ccfNo=2&cciNo=1&cnpClsNo=2" target="_blank" rel="noreferrer">찾기쉬운 생활법령 — 생애최초 특별공급</a> · <a className="text-blue-600 hover:underline" href="https://xn--vg1bl39d.kr/subscriptionIntro/qualify.do" target="_blank" rel="noreferrer">뉴:홈 입주자격</a></li>
          <li><a className="text-blue-600 hover:underline" href="https://www.news1.kr/realestate/general/6025139" target="_blank" rel="noreferrer">뉴스1 — 2026 공급 절벽·유동성</a></li>
        </ul>
      </S>
    </div>
  );
}
