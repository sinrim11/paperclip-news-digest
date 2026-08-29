/**
 * /gosi — 개발 고시 선행감지 이력 (2026-08-29).
 *
 * 이 시스템의 유일한 정보 우위는 재개발·재건축 고시를 기사보다 먼저 본다는 것이다.
 * 그런데 그 결과가 텔레그램 알림으로만 흘러가 지나가면 사라졌고, 홈에서도 최근 3건만
 * 보였다. 이력을 남겨야 '이 동네에 뭐가 쌓였는지'를 나중에 되짚을 수 있다.
 *
 * 데이터는 scripts/collect-gosi.ts가 토지이음 원문(PDF 포함)에서 뽑아 둔 config/gosi-hits.json.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';

interface Gosi {
  seq: string;
  date: string;
  no: string;
  title: string;
  org: string;
  gu: string;
  grade?: string;
  facts?: { areaM2?: number; periodText?: string };
}

function load(): Gosi[] {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'config', 'gosi-hits.json'), 'utf-8')) as Gosi[];
  } catch {
    return [];
  }
}

const pyeong = (m2: number) => Math.round(m2 / 3.3058);

export default function GosiPage() {
  const hits = load().sort((a, b) => b.date.localeCompare(a.date));

  // 지역별로 몇 건 쌓였는지 — 한 건보다 '누적'이 신호다
  const byGu = new Map<string, number>();
  for (const h of hits) byGu.set(h.gu, (byGu.get(h.gu) ?? 0) + 1);
  const guRank = [...byGu].sort((a, b) => b[1] - a[1]);

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">
          📜 개발 고시 선행감지 <span className="text-base font-normal text-gray-400">{hits.length}건</span>
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
          토지이음 고시 원문을 매일 훑어 재개발·재건축·지구단위계획 신호를 잡습니다. 기사로 나오기 전 단계의
          <b> 1차 자료</b>이며, 고시 자체가 사업 확정을 뜻하지는 않습니다. 제목을 누르면 원문으로 이동합니다.
        </p>
      </header>

      {guRank.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold">지역별 누적</h2>
          <p className="mt-0.5 text-xs text-gray-500">한 건보다 같은 지역에 쌓이는 흐름이 신호에 가깝습니다.</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {guRank.map(([gu, n]) => (
              <span key={gu} className="rounded-full bg-gray-100 px-3 py-1 text-[13px]">
                {gu} <b className="tabular-nums">{n}</b>
              </span>
            ))}
          </div>
        </section>
      )}

      {hits.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-gray-500">
          아직 감지된 고시가 없습니다. 매일 06:20에 자동 수집합니다.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {hits.map((h) => (
            <li key={h.seq} className="rounded-lg border bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                  h.grade === '중간' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'
                }`}>
                  {h.grade === '중간' ? '🟡 중간' : '🔴 높음'}
                </span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-[13px] font-semibold text-gray-700">{h.gu}</span>
                <span className="ml-auto text-xs tabular-nums text-gray-400">{h.date}</span>
              </div>

              <h3 className="mt-1.5 text-[15px] font-semibold leading-snug">
                <a
                  href={`https://www.eum.go.kr/web/gs/gv/gvGosiDet.jsp?seq=${h.seq}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-gray-900 hover:text-blue-600 hover:underline"
                >
                  {h.title}
                </a>
              </h3>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-gray-500">
                <span>{h.no}</span>
                <span>{h.org}</span>
              </div>

              {(h.facts?.areaM2 || h.facts?.periodText) && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-gray-50 px-3 py-2 text-[13px]">
                  {h.facts.areaM2 && (
                    <span className="text-gray-500">
                      면적 <b className="font-mono text-gray-900">{h.facts.areaM2.toLocaleString()}㎡</b>
                      <span className="text-gray-400"> (약 {pyeong(h.facts.areaM2).toLocaleString()}평)</span>
                    </span>
                  )}
                  {h.facts.periodText && (
                    <span className="text-gray-500">
                      기간 <b className="text-gray-900">{h.facts.periodText}</b>
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
