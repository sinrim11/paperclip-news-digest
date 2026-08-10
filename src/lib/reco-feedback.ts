/**
 * reco-feedback.ts — 추천 피드백 루프 저장소 (2026-08-11).
 *
 * 텔레그램 추천 메시지의 [👍 관심 / 🚫 제외] 인라인 버튼 반응을 저장하고
 * 추천 엔진이 소비한다: 제외 = 전 트랙에서 배제, 관심 = 점수 가점.
 * 콜백 데이터 64바이트 제한 때문에 complexKey(한글 포함) 대신 12자 해시를 쓰고
 * keymap으로 역참조한다. 파일: config/reco-feedback.json (개인 선호 — gitignored).
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export type FeedbackStatus = 'like' | 'ban';

export interface FeedbackStore {
  _comment?: string;
  _offset?: number; // telegram getUpdates 오프셋(봇 전용)
  keymap: Record<string, { complexKey: string; name: string }>;
  feedback: Record<string, { status: FeedbackStatus; name: string; at: string }>;
}

const PATH = join(process.cwd(), 'config', 'reco-feedback.json');

export const hashKey = (complexKey: string) => createHash('md5').update(complexKey).digest('hex').slice(0, 12);

export function loadFeedback(): FeedbackStore {
  try {
    const s = JSON.parse(readFileSync(PATH, 'utf-8')) as FeedbackStore;
    return { ...s, keymap: s.keymap ?? {}, feedback: s.feedback ?? {} };
  } catch {
    return {
      _comment: '추천 피드백(텔레그램 버튼) — like=가점, ban=전 트랙 제외. keymap은 콜백 해시→단지 역참조.',
      keymap: {},
      feedback: {},
    };
  }
}

export function saveFeedback(store: FeedbackStore): void {
  // keymap 무한 성장 방지 — 800개 초과 시 피드백 없는 옛 항목부터 정리
  const keys = Object.keys(store.keymap);
  if (keys.length > 800) {
    for (const k of keys.slice(0, keys.length - 600)) {
      const ck = store.keymap[k]?.complexKey;
      if (ck && !store.feedback[ck]) delete store.keymap[k];
    }
  }
  writeFileSync(PATH, JSON.stringify(store, null, 2) + '\n');
}

/** 발송 직전 호출 — 추천 단지들의 해시를 keymap에 등록(버튼 콜백 역참조용). */
export function registerKeys(recos: Array<{ complexKey: string; name: string }>): void {
  const store = loadFeedback();
  for (const r of recos) store.keymap[hashKey(r.complexKey)] = { complexKey: r.complexKey, name: r.name };
  saveFeedback(store);
}
