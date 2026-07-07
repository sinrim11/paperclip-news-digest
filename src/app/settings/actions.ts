'use server';

/** /settings 서버 액션 — 프로필 저장·선택·삭제. 재무값은 만원 단위 입력 → 원 단위 저장. */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { saveProfile, deleteProfile, loadProfile, validId, validateFinances, patchOwnerFinances, PROFILE_COOKIE, DEFAULT_ID, type ProfileFinances } from '@/lib/profiles';
import { DEFAULT_WORK, type WorkPlace } from '@/lib/commute';
import { geocode } from '@/lib/kakao-map';

const manToWon = (v: FormDataEntryValue | null): number => Math.round(Number(v ?? 0) * 10000);

/** 폼 → 출근지·목적. 주소 입력 시 카카오 지오코딩 우선(venueContext.mjs 패턴), 아니면 좌표 직접값, 둘 다 없으면 기본. */
async function workFromForm(formData: FormData): Promise<{ work: WorkPlace; purpose: 'invest' | 'live'; geoNote?: string }> {
  const label = String(formData.get('workLabel') ?? '').trim() || DEFAULT_WORK.label;
  const purpose: 'invest' | 'live' = formData.get('purpose') === 'live' ? 'live' : 'invest';
  const address = String(formData.get('workAddress') ?? '').trim();
  if (address) {
    const g = await geocode(address);
    if (g) return { work: { label: label || g.label, lat: g.lat, lng: g.lng }, purpose, geoNote: `'${address}' → ${g.label} (${g.lat.toFixed(5)}, ${g.lng.toFixed(5)})` };
    return { work: { ...DEFAULT_WORK, label }, purpose, geoNote: `'${address}' 좌표 해석 실패 — 기본 출근지 사용` };
  }
  const lat = Number(formData.get('workLat'));
  const lng = Number(formData.get('workLng'));
  const valid = isFinite(lat) && isFinite(lng) && lat > 33 && lat < 39 && lng > 124 && lng < 132;
  return { work: valid ? { label, lat, lng } : { ...DEFAULT_WORK, label }, purpose };
}

/** 폼 → ProfileFinances. 월 적립 미입력 시 실수령−생활비−기존대출로 자동 산출. */
function financesFromForm(formData: FormData): ProfileFinances {
  const incomeNet = manToWon(formData.get('monthlyIncomeNet'));
  const expense = manToWon(formData.get('monthlyExpense'));
  const existingLoan = manToWon(formData.get('existingLoanMonthly'));
  const savingRaw = formData.get('monthlyHomeSaving');
  const saving = savingRaw == null || String(savingRaw).trim() === ''
    ? Math.max(0, incomeNet - expense - existingLoan)
    : manToWon(savingRaw);
  return {
    annualIncome: manToWon(formData.get('annualIncome')),
    usableCapital: manToWon(formData.get('usableCapital')),
    monthlyHomeSaving: saving,
    monthlyIncomeNet: incomeNet,
    monthlyExpense: expense,
    monthlyFixedCosts: manToWon(formData.get('monthlyFixedCosts')),
    existingLoanMonthly: existingLoan,
    jeonseDepositSelf: manToWon(formData.get('jeonseDepositSelf')),
    jeonseLoanInterestMonthly: manToWon(formData.get('jeonseLoanInterest')),
    firstTimeBuyer: formData.get('firstTimeBuyer') === 'on',
  };
}

export async function useProfileAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const c = await cookies();
  if (id === DEFAULT_ID) {
    c.set(PROFILE_COOKIE, DEFAULT_ID, { path: '/', maxAge: 3600 * 24 * 365 });
  } else if (validId(id) && loadProfile(id)) {
    c.set(PROFILE_COOKIE, id, { path: '/', maxAge: 3600 * 24 * 365 });
  } else {
    redirect('/settings?error=' + encodeURIComponent('프로필을 찾을 수 없습니다'));
  }
  revalidatePath('/', 'layout');
  redirect('/settings?ok=' + encodeURIComponent('프로필 적용됨'));
}

export async function saveProfileAction(formData: FormData) {
  const id = String(formData.get('id') ?? '').trim().toLowerCase();
  const name = String(formData.get('name') ?? '').trim();
  const finances = financesFromForm(formData);
  const { work, purpose, geoNote } = await workFromForm(formData);
  const okSuffix = geoNote ? ` · 출근지 ${geoNote}` : '';

  // 소유자(default) 수정 — reader-profile.json의 모델 소비 필드만 외과적 patch
  if (id === DEFAULT_ID) {
    try {
      validateFinances(finances);
      patchOwnerFinances(finances, work, purpose);
    } catch (e) {
      redirect('/settings?error=' + encodeURIComponent(e instanceof Error ? e.message : '저장 실패'));
    }
    revalidatePath('/', 'layout');
    redirect('/settings?ok=' + encodeURIComponent('소유자 재무정보 수정됨 (reader-profile.json)' + okSuffix));
  }

  if (!validId(id)) redirect('/settings?error=' + encodeURIComponent('ID는 영문 소문자·숫자·하이픈 1~32자 (default 예약어 불가)'));
  try {
    saveProfile({ id, name, updatedAt: '', finances, work, purpose });
  } catch (e) {
    redirect('/settings?error=' + encodeURIComponent(e instanceof Error ? e.message : '저장 실패'));
  }
  revalidatePath('/', 'layout');
  redirect('/settings?ok=' + encodeURIComponent(`'${name}' 저장됨` + okSuffix));
}

export async function deleteProfileAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (validId(id)) {
    deleteProfile(id);
    const c = await cookies();
    if (c.get(PROFILE_COOKIE)?.value === id) c.set(PROFILE_COOKIE, DEFAULT_ID, { path: '/', maxAge: 3600 * 24 * 365 });
  }
  revalidatePath('/', 'layout');
  redirect('/settings?ok=' + encodeURIComponent('삭제됨'));
}
