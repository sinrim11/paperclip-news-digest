/**
 * 국토교통부 아파트 실거래가 수집기 (data.go.kr)
 * - 매매: RTMSDataSvcAptTrade / 전월세: RTMSDataSvcAptRent
 * - 주의: https + User-Agent 필수 (없으면 WAF가 "Request Blocked" 반환, 2026-07-03 확인)
 * - 응답은 XML — 의존성 없이 정규식으로 파싱
 */

import type { PrismaClient } from '@prisma/client';

const KEY = process.env.DATA_GO_KR_API_KEY ?? '';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const BASE = 'https://apis.data.go.kr/1613000';

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return (m?.[1] ?? '').trim();
}

function toInt(s: string): number | null {
  const n = parseInt(s.replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

async function fetchItems(service: string, op: string, lawdCd: string, dealYmd: string): Promise<string[]> {
  if (!KEY) throw new Error('DATA_GO_KR_API_KEY not set');
  const url = `${BASE}/${service}/${op}?serviceKey=${KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=1000&pageNo=1`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
  const xml = await res.text();
  const code = tag(xml, 'resultCode');
  if (code && code !== '000' && code !== '00') {
    throw new Error(`molit ${service} error ${code}: ${tag(xml, 'resultMsg')}`);
  }
  return xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
}

function dealDateOf(block: string): Date | null {
  const y = toInt(tag(block, 'dealYear'));
  const m = toInt(tag(block, 'dealMonth'));
  const d = toInt(tag(block, 'dealDay')) ?? 1;
  if (!y || !m) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

/** 매매 실거래 수집·적재. 신규 저장 건수 반환 */
export async function collectAptTrades(prisma: PrismaClient, lawdCd: string, dealYmd: string): Promise<number> {
  const items = await fetchItems('RTMSDataSvcAptTrade', 'getRTMSDataSvcAptTrade', lawdCd, dealYmd);
  const rows = items
    .map((b) => {
      const dealDate = dealDateOf(b);
      const dealAmount = toInt(tag(b, 'dealAmount'));
      if (!dealDate || !dealAmount || !tag(b, 'aptNm')) return null;
      return {
        lawdCd,
        dong: tag(b, 'umdNm'),
        aptName: tag(b, 'aptNm'),
        jibun: tag(b, 'jibun') || null,
        excluUseAr: parseFloat(tag(b, 'excluUseAr')) || 0,
        floor: toInt(tag(b, 'floor')),
        dealDate,
        dealAmount,
        buildYear: toInt(tag(b, 'buildYear')),
        dealingGbn: tag(b, 'dealingGbn') || null,
        cdealType: tag(b, 'cdealType') || null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const result = await prisma.aptTrade.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

/** 전월세 실거래 수집·적재. 신규 저장 건수 반환 */
export async function collectAptRents(prisma: PrismaClient, lawdCd: string, dealYmd: string): Promise<number> {
  const items = await fetchItems('RTMSDataSvcAptRent', 'getRTMSDataSvcAptRent', lawdCd, dealYmd);
  const rows = items
    .map((b) => {
      const dealDate = dealDateOf(b);
      if (!dealDate || !tag(b, 'aptNm')) return null;
      return {
        lawdCd,
        dong: tag(b, 'umdNm'),
        aptName: tag(b, 'aptNm'),
        excluUseAr: parseFloat(tag(b, 'excluUseAr')) || 0,
        floor: toInt(tag(b, 'floor')),
        dealDate,
        deposit: toInt(tag(b, 'deposit')) ?? 0,
        monthlyRent: toInt(tag(b, 'monthlyRent')) ?? 0,
        contractType: tag(b, 'contractType') || null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const result = await prisma.aptRent.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}
