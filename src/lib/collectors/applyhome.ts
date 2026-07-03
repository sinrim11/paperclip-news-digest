/**
 * 청약홈(한국부동산원) 분양정보 수집기 (data.go.kr odcloud, JSON)
 * - APT 분양: ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail
 * - 무순위/잔여세대: ApplyhomeInfoDetailSvc/v1/getRemndrLttotPblancDetail
 * 신규 공고를 반환해 아침 브리핑 Telegram 알림에 사용.
 */

import type { PrismaClient, SubscriptionNotice } from '@prisma/client';

const KEY = process.env.DATA_GO_KR_API_KEY ?? '';
const BASE = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1';

interface RawNotice {
  HOUSE_MANAGE_NO?: string | number;
  PBLANC_NO?: string | number;
  HOUSE_NM?: string;
  HSSPLY_ADRES?: string;
  SUBSCRPT_AREA_CODE_NM?: string;
  CNSTRCT_ENTRPS_NM?: string;
  BSNS_MBY_NM?: string;
  TOT_SUPLY_HSHLDCO?: number;
  RCRIT_PBLANC_DE?: string;
  RCEPT_BGNDE?: string;
  RCEPT_ENDDE?: string;
  SUBSCRPT_RCEPT_BGNDE?: string;
  SUBSCRPT_RCEPT_ENDDE?: string;
  GNRL_RCEPT_BGNDE?: string;
  GNRL_RCEPT_ENDDE?: string;
  PRZWNER_PRESNATN_DE?: string;
  PBLANC_URL?: string;
  [k: string]: unknown;
}

async function fetchNotices(op: string, region: string, sinceDate: string): Promise<RawNotice[]> {
  if (!KEY) throw new Error('DATA_GO_KR_API_KEY not set');
  const params = new URLSearchParams({
    page: '1',
    perPage: '100',
    serviceKey: KEY,
  });
  params.set('cond[SUBSCRPT_AREA_CODE_NM::EQ]', region);
  params.set('cond[RCRIT_PBLANC_DE::GTE]', sinceDate);
  const res = await fetch(`${BASE}/${op}?${params.toString()}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`applyhome ${op} HTTP ${res.status}`);
  const data = (await res.json()) as { data?: RawNotice[] };
  return data.data ?? [];
}

function toRow(n: RawNotice, noticeType: 'APT' | '무순위') {
  return {
    houseManageNo: String(n.HOUSE_MANAGE_NO ?? n.PBLANC_NO ?? ''),
    noticeType,
    houseName: n.HOUSE_NM ?? '(이름 없음)',
    address: n.HSSPLY_ADRES ?? null,
    region: n.SUBSCRPT_AREA_CODE_NM ?? null,
    builder: n.CNSTRCT_ENTRPS_NM ?? n.BSNS_MBY_NM ?? null,
    totalSupply: typeof n.TOT_SUPLY_HSHLDCO === 'number' ? n.TOT_SUPLY_HSHLDCO : null,
    noticeDate: n.RCRIT_PBLANC_DE ?? null,
    rceptBegin: n.RCEPT_BGNDE ?? n.SUBSCRPT_RCEPT_BGNDE ?? n.GNRL_RCEPT_BGNDE ?? null,
    rceptEnd: n.RCEPT_ENDDE ?? n.SUBSCRPT_RCEPT_ENDDE ?? n.GNRL_RCEPT_ENDDE ?? null,
    winnerDate: n.PRZWNER_PRESNATN_DE ?? null,
    url: (n.PBLANC_URL as string) ?? null,
    raw: JSON.parse(JSON.stringify(n)) as object,
  };
}

/** 서울 분양·무순위 공고 수집. 새로 발견된 공고 목록 반환 */
export async function collectSubscriptionNotices(
  prisma: PrismaClient,
  region = '서울',
  sinceDays = 60,
): Promise<SubscriptionNotice[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
  const [apt, remndr] = await Promise.all([
    fetchNotices('getAPTLttotPblancDetail', region, since).catch((e) => {
      console.warn('[applyhome] APT fetch failed:', e);
      return [];
    }),
    fetchNotices('getRemndrLttotPblancDetail', region, since).catch((e) => {
      console.warn('[applyhome] 무순위 fetch failed:', e);
      return [];
    }),
  ]);

  const rows = [
    ...apt.map((n) => toRow(n, 'APT' as const)),
    ...remndr.map((n) => toRow(n, '무순위' as const)),
  ].filter((r) => r.houseManageNo);

  const fresh: SubscriptionNotice[] = [];
  for (const row of rows) {
    const existing = await prisma.subscriptionNotice.findUnique({
      where: { houseManageNo_noticeType: { houseManageNo: row.houseManageNo, noticeType: row.noticeType } },
    });
    if (existing) continue;
    fresh.push(await prisma.subscriptionNotice.create({ data: row }));
  }
  return fresh;
}
