/**
 * gosi-extract.ts — 고시 PDF에서 핵심 수치 추출 (2026-08-29).
 *
 * 고시 양식은 지자체·유형마다 다르다(조사: 10건 중 인라인 5·표 5). 완전 파싱은 과하므로
 * "되면 붙이고 안 되면 생략"을 원칙으로, 두 가지 형태만 확실히 잡는다:
 *   ① 인라인 — "나. 면 적: 2,333.20 ㎡"
 *   ② 표 헤더 — "면 적(㎡)" 가 헤더에만 있고 숫자는 다음 줄들에 흩어진 형태
 * 잘못된 값을 붙이느니 생략하는 쪽이 낫다(지번·연번을 면적으로 오인하면 안 됨).
 */

/** 면적으로 인정할 최소값(㎡) — 지번·연번 같은 작은 수를 배제. */
const MIN_AREA = 300;
const MAX_AREA = 5_000_000;

const toNum = (s: string) => Number(s.replace(/,/g, ''));

/** 콤마 또는 소수점을 가진 수만 후보로 — 면적 표기는 대부분 이 형태다. */
const NUM_RE = /\b(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+)\b/g;

export interface GosiFacts {
  areaM2?: number;
  /** 제한기간처럼 유효기간이 명시된 경우(예: "고시일로부터 2년") */
  periodText?: string;
}

export function extractGosiFacts(text: string): GosiFacts {
  const out: GosiFacts = {};
  const lines = text.split('\n');

  // ① 인라인: 면적 뒤에 바로 숫자와 ㎡
  const inline = text.match(/면\s*적\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*(?:㎡|m2|m²)/);
  if (inline) {
    const v = toNum(inline[1]);
    if (v >= MIN_AREA && v <= MAX_AREA) out.areaM2 = v;
  }

  // ② 표 헤더형: "면 적(㎡)" 헤더 아래 5줄에서 가장 큰 후보값
  if (out.areaM2 == null) {
    const hdr = lines.findIndex((l) => /면\s*적\s*\(\s*(?:㎡|m2|m²)\s*\)/.test(l));
    if (hdr >= 0) {
      const cands: number[] = [];
      for (const l of lines.slice(hdr + 1, hdr + 6)) {
        for (const m of l.matchAll(NUM_RE)) {
          const v = toNum(m[1]);
          if (v >= MIN_AREA && v <= MAX_AREA) cands.push(v);
        }
      }
      // 같은 면적이 '기정/변경후'로 반복되는 표가 흔해 최댓값이 대표값에 가깝다
      if (cands.length) out.areaM2 = Math.max(...cands);
    }
  }

  const period = text.match(/제한기간\s*[:：]?\s*([^\n]{0,40})/);
  if (period) out.periodText = period[1].replace(/\s+/g, ' ').trim().slice(0, 30);

  return out;
}

/** 카드·알림 표기용 — 면적은 ㎡와 평을 함께(실무에서 평으로 감을 잡는다). */
export function formatArea(m2: number): string {
  const py = Math.round(m2 / 3.3058);
  return `${m2.toLocaleString()}㎡(약 ${py.toLocaleString()}평)`;
}
