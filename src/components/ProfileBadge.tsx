/**
 * ProfileBadge — 활성 프로필 표시(Server Component, 쿠키 기반).
 *   mode="badge": 프로필 적용 페이지(/listings·/matching·/versus) 상단 — "현재 프로필: X"
 *   mode="ownerOnly": 소유자 전용 페이지(/tracker·/recommend 등) — 비-default 프로필 활성 시 경고 배너
 */
import Link from 'next/link';
import { cookies } from 'next/headers';
import { loadProfile, validId, PROFILE_COOKIE, DEFAULT_ID } from '@/lib/profiles';

export default async function ProfileBadge({ mode = 'badge' }: { mode?: 'badge' | 'ownerOnly' }) {
  const c = await cookies();
  const v = c.get(PROFILE_COOKIE)?.value;
  const custom = v && v !== DEFAULT_ID && validId(v) ? loadProfile(v) : null;

  if (mode === 'ownerOnly') {
    if (!custom) return null;
    return (
      <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        ⚠️ 이 화면은 <b>소유자(기본) 재무 기준</b>으로만 계산됩니다 — 선택한 프로필 &apos;{custom.name}&apos;은 여기에 적용되지 않습니다.
        프로필 적용 화면: <Link href="/listings" className="underline">전체 매물</Link> · <Link href="/matching" className="underline">매수 분석</Link> · <Link href="/versus" className="underline">집vs주식</Link>
      </div>
    );
  }

  return (
    <div className="mb-3 flex items-center gap-2 text-xs">
      <span className={`rounded-full px-2.5 py-1 font-semibold ${custom ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'}`}>
        👤 현재 프로필: {custom ? custom.name : '기본(소유자)'}
      </span>
      <Link href="/settings" className="text-blue-500 hover:underline">프로필 변경/추가 →</Link>
    </div>
  );
}
