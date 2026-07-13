import { readFileSync } from 'fs';
import { join } from 'path';
import { generateCardnews, sendCardnewsToTelegram, publishCardnewsToInstagram, retryInstagramPublish } from './actions';
import { igStatus, getPending } from '@/lib/instagram';
import CopyCaptionButton from './CopyCaptionButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: '카드뉴스 | 뉴스 다이제스트' };

interface CardSet { date: string; series?: string; dir?: string; files: string[]; picks: string[]; caption?: string }

const dirOf = (s: CardSet) => s.dir ?? s.date;
const seriesLabel = (s?: string) => (s === 'price8' ? '6~8억 큐레이션' : s === 'price9' ? '8~9억 큐레이션' : s === 'briefing' ? '호재·정책 브리핑' : '6억 이하 큐레이션');

function loadIndex(): CardSet[] {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'output', 'cardnews', 'index.json'), 'utf-8')) as CardSet[];
  } catch {
    return [];
  }
}

export default async function CardnewsPage({ searchParams }: { searchParams?: Promise<{ ok?: string; error?: string }> }) {
  const sp = (await searchParams) ?? {};
  const sets = loadIndex();
  const latest = sets[0];

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">📸 카드뉴스</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600">
          오늘의 추천·정책 요약을 <b>인스타그램 규격(4:5, 1080×1350 ×2배율)</b> 캐러셀로 만듭니다. 이미지를 저장해 그대로 업로드하세요.
        </p>
        <details className="mt-1 max-w-3xl text-xs text-gray-500">
          <summary className="cursor-pointer select-none hover:text-gray-700">자세히</summary>
          <ul className="mt-1.5 list-inside list-disc space-y-1 leading-relaxed">
            <li>구성: 표지 → 추천 TOP5(단지별 1장) → 정책 한눈에 → 아웃트로 = 8장(인스타 캐러셀 10장 한도 내).</li>
            <li>개인 재무 수치는 포함되지 않습니다 — 매물·정책 공개 정보만.</li>
            <li>텔레그램 전송을 누르면 원본 8장이 앨범으로 도착 — 폰에서 저장 후 인스타 업로드가 가장 빠릅니다.</li>
          </ul>
        </details>
      </header>

      {sp.error && <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">⚠️ {sp.error}</div>}
      {sp.ok && <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ {sp.ok}</div>}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <form action={generateCardnews}>
          <button className="rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-700">오늘 데이터로 새로 생성 (~20초)</button>
        </form>
        {latest && (
          <form action={sendCardnewsToTelegram}>
            <input type="hidden" name="date" value={dirOf(latest)} />
            <button className="rounded-full border border-blue-500 px-5 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50">📨 텔레그램으로 전송 ({latest.date} · {seriesLabel(latest.series)})</button>
          </form>
        )}
        {latest && igStatus().available && (
          <form action={publishCardnewsToInstagram}>
            <input type="hidden" name="date" value={dirOf(latest)} />
            <button className="rounded-full bg-gradient-to-r from-purple-600 to-pink-500 px-5 py-2 text-sm font-semibold text-white hover:opacity-90">
              📸 인스타그램 게시 — @{igStatus().label}
            </button>
          </form>
        )}
        {getPending() && (
          <form action={retryInstagramPublish}>
            <button className="rounded-full border-2 border-purple-500 px-5 py-2 text-sm font-semibold text-purple-600 hover:bg-purple-50">
              ⏳ 게시 재시도 (컨테이너 {getPending()!.date} 준비됨)
            </button>
          </form>
        )}
      </div>
      {latest && igStatus().available && (
        <p className="-mt-3 mb-6 text-xs text-gray-400">⚠️ 인스타그램 버튼은 <b className="text-gray-600">@{igStatus().label} 계정에 실제 공개 게시</b>됩니다(캐러셀 {latest.files.length}장 + 본문 캡션). 게시 전 카드·본문을 확인하세요.</p>
      )}

      {!latest ? (
        <p className="rounded-lg border bg-white p-10 text-center text-sm text-gray-500">아직 생성된 카드뉴스가 없습니다 — 위 버튼으로 생성하세요.</p>
      ) : (
        <>
          <h2 className="mb-1 text-lg font-bold">{latest.date} · {seriesLabel(latest.series)} <span className="text-sm font-normal text-gray-400">{latest.files.length}장</span></h2>
          <p className="mb-3 text-xs text-gray-500">구성: {latest.picks.join(' · ')} — 이미지 클릭 시 원본(다운로드)</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {latest.files.map((f) => (
              <a key={f} href={`/api/cardnews/${dirOf(latest)}/${f}`} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/cardnews/${dirOf(latest)}/${f}`} alt={f} className="aspect-[4/5] w-full object-cover transition group-hover:scale-[1.02]" />
                <div className="px-2.5 py-1.5 text-center text-xs font-medium text-gray-600">{f.replace('.png', '')}</div>
              </a>
            ))}
          </div>

          {/* 인스타 게시글 본문(캡션) */}
          {latest.caption && (
            <section className="mt-8">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-bold">📝 인스타 게시글 본문</h2>
                <CopyCaptionButton text={latest.caption} />
                <span className="text-xs text-gray-400">카드와 같은 데이터로 자동 작성 — 붙여넣고 필요하면 수정하세요</span>
              </div>
              <pre className="whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-4 text-[13px] leading-relaxed text-gray-800">{latest.caption}</pre>
            </section>
          )}
        </>
      )}

      {sets.length > 1 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-semibold text-gray-600">지난 세트 {sets.length - 1}개</summary>
          <ul className="mt-2 space-y-1 text-sm text-gray-600">
            {sets.slice(1).map((s) => (
              <li key={dirOf(s)} className="flex flex-wrap items-center gap-2">
                <b>{s.date}</b><span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">{seriesLabel(s.series)}</span><span className="text-xs text-gray-400">{s.files.length}장 · {s.picks.slice(0, 3).join('·')}</span>
                <a href={`/api/cardnews/${dirOf(s)}/${s.files[0]}`} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">표지 보기 ↗</a>
              </li>
            ))}
          </ul>
        </details>
      )}

      <footer className="mt-8 border-t border-gray-100 pt-4 text-xs leading-relaxed text-gray-400">
        생성기 scripts/gen-cardnews.ts · 저장 output/cardnews/ · 콘텐츠에 개인 재무정보 미포함 · 공개 데이터(국토부·네이버) 기반 — 투자 자문 아님
      </footer>
    </main>
  );
}
