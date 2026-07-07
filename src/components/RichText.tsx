/**
 * RichText — 수치가 섞인 산문 문자열의 가독성 렌더러(공용).
 *   문제: 모델이 생성하는 근거/판정 문자열은 "여유율 = (2.86억 − 1.2억) / 2.86억 = 58% → 100점. ..." 처럼
 *   한 줄 산문이라 수치가 묻힘. 이 컴포넌트가 문자열을 구조화해 렌더:
 *   ① 숫자+단위 토큰(2.86억·58%·142만·-2.2%p·100점 등) 자동 굵게(모노)
 *   ② ' · '(공백 가운뎃점) 절 단위 → 줄바꿈
 *   ③ ' → ' 계산 체인 → 화살표 구분자 스타일
 *   ④ ' + ' 항목이 3개 이상인 절(상권 합산 등) → 칩 나열
 * 소비처: InvestBreakdown(점수 근거·대안 판정·통근), /matching 급매 진단 등.
 */

const NUM_RE = /([+−-]?\d[\d,]*(?:\.\d+)?\s?(?:억|만원|만|%p|%|점|건|년차|세대|년|개월|분|회|개|호선|㎡|km|m)?)/g;

function numClass(tok: string): string {
  if (/점$/.test(tok)) return 'font-mono font-bold text-gray-900';
  if (/^[−-]/.test(tok)) return 'font-mono font-semibold text-red-600';
  return 'font-mono font-semibold text-gray-900';
}

/** 숫자 토큰만 강조하는 인라인 렌더 */
export function RichText({ text }: { text: string }) {
  const parts = text.split(NUM_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? <b key={i} className={numClass(p)}>{p}</b> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

/** ' → ' 계산 체인을 화살표 구분으로 렌더 */
function Chain({ text }: { text: string }) {
  const segs = text.split(' → ');
  return (
    <>
      {segs.map((s, i) => (
        <span key={i}>
          <RichText text={s} />
          {i < segs.length - 1 && <span className="mx-1.5 font-bold text-blue-400">→</span>}
        </span>
      ))}
    </>
  );
}

/** 근거 블록: 절 단위 개행 + 합산식 칩 + 계산 체인 */
export function BasisBlock({ text }: { text: string }) {
  const clauses = text.split(' · ');
  return (
    <div className="space-y-1.5">
      {clauses.map((clause, i) => {
        const plusParts = clause.split(' + ');
        if (plusParts.length >= 3) {
          // 합산식(상권 등): 마지막 항에 "= 결과 (...)"가 붙어있으면 결과 줄로 분리
          let resultLine: string | null = null;
          const last = plusParts[plusParts.length - 1];
          const eq = last.indexOf(' = ');
          if (eq >= 0) {
            plusParts[plusParts.length - 1] = last.slice(0, eq);
            resultLine = last.slice(eq + 3);
          }
          return (
            <div key={i}>
              <div className="flex flex-wrap items-center gap-1">
                {plusParts.map((part, j) => (
                  <span key={j} className="flex items-center gap-1">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700"><RichText text={part.trim()} /></span>
                    {j < plusParts.length - 1 && <span className="text-gray-400">+</span>}
                  </span>
                ))}
              </div>
              {resultLine && (
                <div className="mt-1"><span className="mr-1 text-gray-400">=</span><Chain text={resultLine} /></div>
              )}
            </div>
          );
        }
        return <div key={i}><Chain text={clause} /></div>;
      })}
    </div>
  );
}
