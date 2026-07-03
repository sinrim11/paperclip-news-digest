import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  kendallTauB,
  rankArticles,
  runDivergenceGate,
  saveDivergenceGateLog,
  scoreArticle,
  PERSONAS,
  DIVERGENCE_THRESHOLD,
} from '../lib/divergence-gate';
import type { RawArticle } from '../lib/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeArticle(title: string, content: string, category: RawArticle['category'] = 'GLOBAL'): RawArticle {
  return { title, content, url: `https://test.com/${Math.random()}`, source: 'Test', category };
}

// ─── Kendall τ-b (known input/output) ────────────────────────────────────────

describe('kendallTauB', () => {
  it('returns 1.0 for identical rankings', () => {
    expect(kendallTauB([0, 1, 2, 3], [0, 1, 2, 3])).toBe(1);
  });

  it('returns -1.0 for perfectly reversed rankings', () => {
    expect(kendallTauB([0, 1, 2, 3], [3, 2, 1, 0])).toBe(-1);
  });

  it('returns 0 for orthogonal rankings (2 elements)', () => {
    // Only 2 elements: [0,1] vs [1,0] → exactly 0 concordant, 1 discordant, denom=1
    expect(kendallTauB([0, 1], [1, 0])).toBe(-1);
  });

  it('computes known partial agreement correctly', () => {
    // rankA=[0,1,2,3], rankB=[0,2,1,3]
    // bPositions = [0,2,1,3]
    // pairs: (0,1)→C, (0,2)→C, (0,3)→C, (1,2)→D, (1,3)→C, (2,3)→C
    // C=5, D=1, denom=6 → τ-b = 4/6 ≈ 0.667
    const tau = kendallTauB([0, 1, 2, 3], [0, 2, 1, 3]);
    expect(tau).toBeCloseTo(4 / 6, 5);
  });

  it('computes near-zero for near-random rankings', () => {
    // A: [0,1,2,3,4,5], B: [1,3,5,0,2,4] — manually computed
    // bPositions for A=[0,1,2,3,4,5]: b-pos of 0=3,1=0,2=4,3=1,4=5,5=2 → [3,0,4,1,5,2]
    // pairs (15 total):
    // (0,1): 3>0 → D
    // (0,2): 3<4 → C
    // (0,3): 3>1 → D
    // (0,4): 3<5 → C
    // (0,5): 3>2 → D
    // (1,2): 0<4 → C
    // (1,3): 0<1 → C
    // (1,4): 0<5 → C
    // (1,5): 0<2 → C
    // (2,3): 4>1 → D
    // (2,4): 4<5 → C
    // (2,5): 4>2 → D
    // (3,4): 1<5 → C
    // (3,5): 1<2 → C
    // (4,5): 5>2 → D
    // C=9, D=6 → τ-b = 3/15 = 0.2
    const tau = kendallTauB([0, 1, 2, 3, 4, 5], [1, 3, 5, 0, 2, 4]);
    expect(tau).toBeCloseTo(0.2, 5);
  });

  it('throws for mismatched lengths', () => {
    expect(() => kendallTauB([0, 1], [0, 1, 2])).toThrow();
  });

  it('returns 1.0 for a single element', () => {
    expect(kendallTauB([0], [0])).toBe(1);
  });
});

// ─── Persona scoring ──────────────────────────────────────────────────────────

describe('scoreArticle', () => {
  const personaA = PERSONAS.find((p) => p.id === 'A')!;
  const personaB = PERSONAS.find((p) => p.id === 'B')!;

  it('AI persona scores AI articles higher than real-estate persona', () => {
    const article = makeArticle('GPT-5 모델 학습 비용 공개', 'LLM 학습 GPU 인프라 확장', 'AI');
    expect(scoreArticle(article, personaA)).toBeGreaterThan(scoreArticle(article, personaB));
  });

  it('real-estate persona scores 부동산 articles higher than AI persona', () => {
    const article = makeArticle('서울 아파트 매매 시세 반등', '기준금리 인하로 대출 수요 증가', 'REALESTATE');
    expect(scoreArticle(article, personaB)).toBeGreaterThan(scoreArticle(article, personaA));
  });

  it('gives bonus for preferred category', () => {
    const aiArticle = makeArticle('AI 뉴스', '내용', 'AI');
    const sameContentGlobal = makeArticle('AI 뉴스', '내용', 'GLOBAL');
    expect(scoreArticle(aiArticle, personaA)).toBeGreaterThan(scoreArticle(sameContentGlobal, personaA));
  });
});

// ─── Divergence gate — PASS case ─────────────────────────────────────────────

describe('runDivergenceGate', () => {
  // Build 30 clearly differentiated articles
  const aiArticles: RawArticle[] = Array.from({ length: 10 }, (_, i) =>
    makeArticle(
      `AI 뉴스 ${i}: LLM 모델 학습 GPU 벤치마크`,
      `transformer 기반 생성형 AI 오픈소스 모델 fine-tuning 학습 데이터`,
      'AI',
    ),
  );
  const reArticles: RawArticle[] = Array.from({ length: 10 }, (_, i) =>
    makeArticle(
      `부동산 뉴스 ${i}: 서울 아파트 매매 시세 반등`,
      `기준금리 인하로 주택 대출 수요 증가 청약 분양 규제 완화`,
      'REALESTATE',
    ),
  );
  const polArticles: RawArticle[] = Array.from({ length: 10 }, (_, i) =>
    makeArticle(
      `외교 뉴스 ${i}: 미중 무역 제재 협정 지정학`,
      `nato 안보리 정상회담 외교부 관세 공급망 인도태평양 유엔`,
      'POLICY',
    ),
  );
  const articles = [...aiArticles, ...reArticles, ...polArticles];

  it('produces 3 pair results', () => {
    const result = runDivergenceGate(articles);
    expect(result.pairs).toHaveLength(3);
    expect(result.pairs.map((p) => p.pair).sort()).toEqual(['A-B', 'A-C', 'B-C'].sort());
  });

  it('reports correct article count', () => {
    const result = runDivergenceGate(articles);
    expect(result.article_count).toBe(30);
  });

  it('all pairs τ-b ≤ 0.2 → overall_pass true for divergent persona set', () => {
    const result = runDivergenceGate(articles);
    expect(result.overall_pass).toBe(true);
    for (const p of result.pairs) {
      expect(p.tau_b).toBeLessThanOrEqual(DIVERGENCE_THRESHOLD);
    }
  });

  it('uses correct threshold', () => {
    const result = runDivergenceGate(articles);
    expect(result.threshold).toBe(0.2);
  });

  // ── FAIL case: all articles about same topic → B-C personas rank identically ──
  it('overall_pass is false when personas rank articles the same way', () => {
    // All AI articles — B and C personas give score=0 to everything, ranking by idx → identical
    const sameTopicArticles = Array.from({ length: 30 }, (_, i) =>
      makeArticle(
        `LLM 모델 ${i}: transformer 학습 GPU 벤치마크 오픈소스`,
        `생성형 AI fine-tuning 학습 데이터 inference speed`,
        'AI',
      ),
    );
    const result = runDivergenceGate(sameTopicArticles);
    // B-C pair: both score everything identically → τ-b = 1.0 → FAIL
    const bcPair = result.pairs.find((p) => p.pair === 'B-C')!;
    expect(bcPair.tau_b).toBeGreaterThan(DIVERGENCE_THRESHOLD);
    expect(bcPair.pass).toBe(false);
    expect(result.overall_pass).toBe(false);
  });
});

// ─── saveDivergenceGateLog ────────────────────────────────────────────────────

describe('saveDivergenceGateLog', () => {
  const tmpDir = path.join('/tmp', `divergence-gate-test-${Date.now()}`);

  beforeEach(() => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a JSON file with the expected structure', () => {
    const result = runDivergenceGate([
      makeArticle('기사 A', '내용', 'AI'),
      makeArticle('기사 B', '부동산 금리', 'REALESTATE'),
    ]);
    const filePath = saveDivergenceGateLog(result, tmpDir);
    expect(fs.existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(parsed).toHaveProperty('date');
    expect(parsed).toHaveProperty('overall_pass');
    expect(parsed).toHaveProperty('pairs');
    expect(Array.isArray(parsed.pairs)).toBe(true);
  });

  it('filename contains the date', () => {
    const result = runDivergenceGate([
      makeArticle('A', '내용', 'AI'),
      makeArticle('B', '내용', 'GLOBAL'),
    ]);
    const filePath = saveDivergenceGateLog(result, tmpDir);
    expect(path.basename(filePath)).toMatch(/^divergence-gate-\d{4}-\d{2}-\d{2}\.json$/);
  });
});
