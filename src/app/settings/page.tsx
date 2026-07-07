import Link from 'next/link';
import { cookies } from 'next/headers';
import { listProfiles, loadProfile, defaultProfile, PROFILE_COOKIE, DEFAULT_ID } from '@/lib/profiles';
import { useProfileAction, saveProfileAction, deleteProfileAction } from './actions';
import DecisionFlow from '@/components/DecisionFlow';

export const dynamic = 'force-dynamic';
export const metadata = { title: '프로필 설정 | 뉴스 다이제스트' };

const eok = (won: number) => (won / 100000000).toFixed(won % 100000000 === 0 ? 0 : 2).replace(/\.?0+$/, '') + '억';
const man = (won: number) => Math.round(won / 10000).toLocaleString() + '만';

export default async function SettingsPage({ searchParams }: { searchParams?: Promise<{ edit?: string; clone?: string; error?: string; ok?: string }> }) {
  const sp = (await searchParams) ?? {};
  const c = await cookies();
  const activeId = c.get(PROFILE_COOKIE)?.value ?? DEFAULT_ID;
  const profiles = listProfiles();

  // 폼 프리필: ?edit=<id>(수정, default=소유자 재무 patch) 또는 ?clone=default(기본 복제)
  const editing = sp.edit === DEFAULT_ID ? defaultProfile() : sp.edit ? loadProfile(sp.edit) : null;
  const editingOwner = sp.edit === DEFAULT_ID;
  const cloning = sp.clone === 'default' ? defaultProfile() : null;
  const pre = editing ?? cloning;
  const preMan = (v?: number) => (pre ? Math.round((v ?? 0) / 10000) : '');

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <DecisionFlow current={1} />
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">프로필 설정</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-700">
          투자분석의 판단 기준이 되는 <b>재무 전제(자산·소득)</b>를 프로필로 관리합니다.
        </p>
        <details className="mt-1 max-w-3xl text-xs text-gray-500">
          <summary className="cursor-pointer select-none hover:text-gray-700">자세히</summary>
          <ul className="mt-1.5 list-inside list-disc space-y-1 leading-relaxed">
            <li>프로필을 선택하면 <b>전체 매물 · 매수 분석 · 집vs주식</b>이 그 사람 기준으로 다시 계산됩니다(브라우저별 저장).</li>
            <li>지인이 쓰려면 새 프로필을 만들어 선택하면 됩니다.</li>
            <li>무주택 기준 모델 — 유주택 취득세 중과는 미지원.</li>
          </ul>
        </details>
      </header>

      {sp.error && <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">⚠️ {sp.error}</div>}
      {sp.ok && <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ {sp.ok}</div>}

      {/* 프로필 목록 */}
      <section className="mb-8">
        <h2 className="mb-2 text-lg font-bold">프로필 목록</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {profiles.map((p) => {
            const f = p.finances;
            const active = p.id === activeId || (p.id === DEFAULT_ID && !profiles.some((x) => x.id === activeId));
            return (
              <div key={p.id} className={`rounded-xl border p-4 ${active ? 'border-blue-500 bg-blue-50/40 shadow-sm' : 'border-gray-200 bg-white'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-base font-bold text-gray-900">{p.name}</b>
                  {active && <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[11px] font-bold text-white">사용 중</span>}
                  {p.id === DEFAULT_ID && <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">소유자</span>}
                  <span className="ml-auto font-mono text-xs text-gray-500">{p.id}</span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div><dt className="inline text-gray-500">자기자본 </dt><dd className="inline font-mono font-semibold text-gray-900">{eok(f.usableCapital)}</dd></div>
                  <div><dt className="inline text-gray-500">연소득 </dt><dd className="inline font-mono font-semibold text-gray-900">{eok(f.annualIncome)}</dd></div>
                  <div><dt className="inline text-gray-500">월 적립 </dt><dd className="inline font-mono font-semibold text-gray-900">{man(f.monthlyHomeSaving)}</dd></div>
                  <div><dt className="inline text-gray-500">월 실수령 </dt><dd className="inline font-mono font-semibold text-gray-900">{man(f.monthlyIncomeNet)}</dd></div>
                  <div><dt className="inline text-gray-500">월 생활비 </dt><dd className="inline font-mono font-semibold text-gray-900">{man(f.monthlyExpense)}</dd></div>
                  <div><dt className="inline text-gray-500">고정비(보험 등) </dt><dd className="inline font-mono font-semibold text-gray-900">{man(f.monthlyFixedCosts)}</dd></div>
                  <div><dt className="inline text-gray-500">기존대출 상환 </dt><dd className="inline font-mono font-semibold text-gray-900">{f.existingLoanMonthly > 0 ? man(f.existingLoanMonthly) + '/월' : '없음'}</dd></div>
                  <div><dt className="inline text-gray-500">전세보증금(본인) </dt><dd className="inline font-mono font-semibold text-gray-900">{eok(f.jeonseDepositSelf)}</dd></div>
                  <div className="col-span-2"><dt className="inline text-gray-500">생애최초 </dt><dd className="inline font-semibold text-gray-900">{f.firstTimeBuyer ? 'O (LTV70·취득세감면)' : 'X (LTV40)'}</dd></div>
                  <div className="col-span-2"><dt className="inline text-gray-500">출근지 </dt><dd className="inline font-semibold text-gray-900">{p.work?.label ?? '기본(전문건설회관)'}</dd></div>
                  <div className="col-span-2"><dt className="inline text-gray-500">분석 목적 </dt><dd className="inline font-semibold text-gray-900">{p.purpose === 'live' ? '실거주 우선(통근 가중)' : '투자 우선'}</dd></div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!active && (
                    <form action={useProfileAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700">이 프로필 사용</button>
                    </form>
                  )}
                  <Link href={`/settings?edit=${p.id}#form`} className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:border-blue-400">수정</Link>
                  {p.id === DEFAULT_ID ? (
                    <Link href="/settings?clone=default#form" className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:border-blue-400">복제해서 새로 만들기</Link>
                  ) : (
                    <form action={deleteProfileAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-500 hover:border-red-400">삭제</button>
                    </form>
                  )}
                </div>
                {p.id === DEFAULT_ID && <p className="mt-2 text-xs leading-relaxed text-gray-500">수정 시 config/reader-profile.json의 모델 소비 필드만 갱신(포트폴리오 등 상세는 보존).</p>}
              </div>
            );
          })}
        </div>
      </section>

      {/* 생성/수정 폼 */}
      <section id="form">
        <h2 className="mb-2 text-lg font-bold">{editingOwner ? '소유자(기본) 재무정보 수정' : editing ? `프로필 수정 — ${editing.name}` : '새 프로필 만들기'}</h2>
        {editingOwner && <p className="mb-2 text-xs leading-relaxed text-amber-700">⚠️ 이 수정은 config/reader-profile.json의 모델 소비 필드를 직접 갱신합니다(포트폴리오·계좌 등 상세 정보는 보존).</p>}
        <form action={saveProfileAction} className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-gray-600">이름 *</span>
              <input name="name" required defaultValue={pre && !cloning ? pre.name : ''} readOnly={editingOwner} placeholder="예: 김지인" className={`w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm ${editingOwner ? 'bg-gray-50 text-gray-400' : ''}`} />
            </label>
            <label className="block text-xs">
              <span className="block font-semibold text-gray-600">ID *</span>
              <span className="mb-1 mt-0.5 block text-gray-400">영문 소문자·숫자·하이픈 — 저장 파일명으로 사용</span>
              <input name="id" required pattern="default|[a-z0-9][a-z0-9_-]{0,31}" defaultValue={editing?.id ?? ''} readOnly={!!editing} placeholder="예: kim-friend" className={`w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm ${editing ? 'bg-gray-50 text-gray-400' : ''}`} />
            </label>
          </div>

          {/* 재무 정보 — 예산·DSR·보유부담 계산의 입력값 */}
          <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
            <div className="mb-2 text-xs font-bold text-emerald-800">💰 재무 정보 <span className="font-normal text-emerald-600">— 예산·DSR·보유부담 계산의 입력값</span></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs">
                <span className="block font-semibold text-gray-600">가용 자기자본(만원) *</span>
                <span className="mb-1 mt-0.5 block text-gray-400">전세보증금 포함 총알</span>
                <input name="usableCapital" type="number" min="0" step="100" required defaultValue={preMan(pre?.finances.usableCapital)} placeholder="예: 20000 (=2억)" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm" />
              </label>
              <label className="block text-xs">
                <span className="block font-semibold text-gray-600">연소득 세전(만원) *</span>
                <span className="mb-1 mt-0.5 block text-gray-400">DSR 산정 기준</span>
                <input name="annualIncome" type="number" min="0" step="100" required defaultValue={preMan(pre?.finances.annualIncome)} placeholder="예: 9000" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm" />
              </label>
              <label className="block text-xs">
                <span className="block font-semibold text-gray-600">월 실수령(만원) *</span>
                <span className="mb-1 mt-0.5 block text-gray-400">보유부담 점수 계산</span>
                <input name="monthlyIncomeNet" type="number" min="0" step="10" required defaultValue={preMan(pre?.finances.monthlyIncomeNet)} placeholder="예: 565" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm" />
              </label>
              <label className="block text-xs">
                <span className="block font-semibold text-gray-600">월 생활비(만원) *</span>
                <span className="mb-1 mt-0.5 block text-gray-400">고정비 포함 총지출(저축 제외)</span>
                <input name="monthlyExpense" type="number" min="0" step="10" required defaultValue={preMan(pre?.finances.monthlyExpense)} placeholder="예: 150" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm" />
              </label>
              <label className="block text-xs">
                <span className="block font-semibold text-gray-600">월 고정비(만원)</span>
                <span className="mb-1 mt-0.5 block text-gray-400">보험·통신·관리비 등, 생활비에 포함된 내역(참고)</span>
                <input name="monthlyFixedCosts" type="number" min="0" step="1" defaultValue={preMan(pre?.finances.monthlyFixedCosts)} placeholder="예: 43" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm" />
              </label>
              <label className="block text-xs">
                <span className="block font-semibold text-gray-600">기존 대출 월상환액(만원/월)</span>
                <span className="mb-1 mt-0.5 block text-gray-400">신용대출 등, DSR 한도·보유부담에서 차감 — 없으면 0</span>
                <input name="existingLoanMonthly" type="number" min="0" step="1" defaultValue={preMan(pre?.finances.existingLoanMonthly)} placeholder="예: 0" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm" />
              </label>
              <label className="block text-xs">
                <span className="block font-semibold text-gray-600">월 매수펀드 적립(만원)</span>
                <span className="mb-1 mt-0.5 block text-gray-400">비우면 자동 계산: 실수령 − 생활비 − 기존대출</span>
                <input name="monthlyHomeSaving" type="number" min="0" step="10" defaultValue={preMan(pre?.finances.monthlyHomeSaving)} placeholder="비우면 자동 계산" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm" />
              </label>
              <label className="block text-xs">
                <span className="block font-semibold text-gray-600">현 전세보증금 본인부담(만원)</span>
                <span className="mb-1 mt-0.5 block text-gray-400">집vs주식 비교용 — 없으면 0</span>
                <input name="jeonseDepositSelf" type="number" min="0" step="100" defaultValue={preMan(pre?.finances.jeonseDepositSelf)} placeholder="예: 16000" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm" />
              </label>
              <label className="block text-xs">
                <span className="block font-semibold text-gray-600">현 전세대출이자(만원/월)</span>
                <span className="mb-1 mt-0.5 block text-gray-400">매수 시 소멸 — 없으면 0</span>
                <input name="jeonseLoanInterest" type="number" min="0" step="1" defaultValue={preMan(pre?.finances.jeonseLoanInterestMonthly)} placeholder="예: 30" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm" />
              </label>
            </div>
            <label className="mt-3 flex items-start gap-2 text-xs text-gray-700">
              <input name="firstTimeBuyer" type="checkbox" defaultChecked={pre ? pre.finances.firstTimeBuyer : true} className="mt-0.5 h-4 w-4" />
              <span>
                <span className="font-semibold text-gray-700">생애최초 주택구입</span>
                <span className="mt-0.5 block text-gray-400">체크 시 LTV 70% · 취득세 감면 200만 — 해제 시 규제지역 LTV 40%</span>
              </span>
            </label>
          </div>

          {/* 출근지·목적 — 통근/상권 점수 */}
          <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
            <div className="mb-2 text-xs font-bold text-indigo-800">🚇 출근지 · 분석 목적 <span className="font-normal text-indigo-500">— 매물마다 통근시간·환승·상권을 계산해 점수화</span></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs">
                <span className="mb-1 block font-semibold text-gray-600">출근지 이름</span>
                <input name="workLabel" defaultValue={pre?.work?.label ?? '전문건설회관(신대방)'} placeholder="예: 전문건설회관" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
              </label>
              <label className="block text-xs">
                <span className="block font-semibold text-gray-600">주소/건물명으로 좌표 찾기</span>
                <span className="mb-1 mt-0.5 block text-emerald-600">★ 입력하면 카카오 지오코딩으로 좌표 자동 해석</span>
                <input name="workAddress" placeholder="예: 서울 동작구 보라매로5길 15 또는 '전문건설회관'" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
              </label>
              <label className="block text-xs">
                <span className="block font-semibold text-gray-600">위도</span>
                <span className="mb-1 mt-0.5 block text-gray-400">주소 미입력 시 사용</span>
                <input name="workLat" type="number" step="0.0001" defaultValue={pre?.work?.lat ?? 37.49199} className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm" />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block font-semibold text-gray-600">경도</span>
                <input name="workLng" type="number" step="0.0001" defaultValue={pre?.work?.lng ?? 126.92435} className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm" />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-700">
              <span className="font-semibold text-gray-600">분석 목적:</span>
              <label className="flex items-center gap-1.5"><input type="radio" name="purpose" value="invest" defaultChecked={(pre?.purpose ?? 'invest') === 'invest'} /> 투자 우선 <span className="text-gray-400">(통근·상권은 참고 표시만)</span></label>
              <label className="flex items-center gap-1.5"><input type="radio" name="purpose" value="live" defaultChecked={pre?.purpose === 'live'} /> 실거주 우선 <span className="text-gray-400">(통근 16%·상권 7% 가중 반영)</span></label>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button className="rounded-full bg-gray-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-gray-700">{editingOwner ? '소유자 정보 수정' : editing ? '수정 저장' : '프로필 생성'}</button>
            {(editing || cloning) && <Link href="/settings" className="text-xs text-gray-500 hover:underline">취소</Link>}
          </div>
        </form>
        <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs leading-relaxed text-gray-500">
          <li>저장 위치 — 소유자: config/reader-profile.json(필드 patch) / 지인 프로필: config/profiles/&lt;id&gt;.json</li>
          <li>둘 다 gitignored — 재무정보는 커밋되지 않습니다.</li>
          <li>프로필 선택은 브라우저 쿠키에 저장되어 기기별로 유지됩니다.</li>
        </ul>
      </section>

      <footer className="mt-8 space-y-1 border-t border-gray-100 pt-4 text-xs leading-relaxed text-gray-500">
        <p>프로필이 적용되는 화면: <Link href="/listings" className="text-blue-500 hover:underline">전체 매물</Link> · <Link href="/matching" className="text-blue-500 hover:underline">매수 분석</Link> · <Link href="/versus" className="text-blue-500 hover:underline">집vs주식</Link></p>
        <p className="text-gray-400">소유자 전용(프로필 미적용): 재무 트래커 · 오늘의 추천</p>
      </footer>
    </main>
  );
}
