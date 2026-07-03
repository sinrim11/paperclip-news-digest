# 다출처 뉴스 수집·통합 지침 (Multi-Source Collection Guide)

> 이 문서는 뉴스 다이제스트 수집 파이프라인의 **필수 규칙**이다.
> 모든 수집 작업은 이 지침을 반드시 따라야 한다.

## 핵심 원칙

**같은 사건은 여러 출처에서 수집하고, 하나의 통합 기사로 병합하며, 모든 출처를 명시한다.**

단일 출처 기사는 신뢰성이 낮다. 다출처 통합 기사가 뉴스 다이제스트의 핵심 가치다.

## 파이프라인 3단계

### Stage 1: 클러스터링 (같은 스토리 그룹핑)

**현재 방식 (금지):** 제목 Jaccard 0.80 → 중복 제거 (본문 버림)
**올바른 방식:** 3-signal 복합 유사도 0.55 → 클러스터링 (본문 보존)

```
복합 유사도 = 제목 Jaccard × 0.40
            + 엔티티 겹침 × 0.35
            + 본문 1문단 bigram × 0.25

임계치: 0.55 이상이면 같은 클러스터
```

**엔티티 추출 대상:**
- 영어 고유명사 (대문자 시작 단어): Meta, Apple, Trump
- 숫자+단위: $299, 3%, 2026
- 약어: AI, GDP, KOSPI
- 한국어 고유명사: 조사 앞 2글자 이상 명사

**예외:** GitHub Trending 항목은 클러스터링하지 않음 (항상 단일 항목)

### Stage 2: 본문 통합 (mergedContent 생성)

클러스터 내 모든 기사 본문을 하나의 텍스트로 합침:

```
[출처 1: Reuters]
<본문 800자>

---

[출처 2: Bloomberg]
<본문 800자>

---

[출처 3: AP]
<본문 800자>
```

**규칙:**
- 출처당 최대 800자 (토큰 절약)
- 최대 5개 출처까지 (LLM context 한도)
- 본문 길이 내림차순 정렬 (가장 풍부한 출처 먼저)
- 단일 출처 클러스터는 그대로 사용

### Stage 3: LLM 요약 (다출처 지시 포함)

**다출처 클러스터 (sourceCount >= 2) 프롬프트:**
```
[다중 출처 기사 — 아래 각 출처별 본문을 비교하여 공통 사실과 이견을 추출하세요]

출처(N개): Reuters, Bloomberg, AP
source_count=N
```

**LLM 출력 필수 필드:**
- `fact`: "[N곳 공통 보도] 핵심 사실 요약" (sourceCount >= 2일 때 접두사 필수)
- `consensusFacts`: 모든 출처가 동의하는 사실 3~5문장
- `conflictingFacts`: 출처 간 수치/주장/시점 차이 ("출처A: X, 출처B: Y" 형식, 없으면 null)

**단일 출처 클러스터 (sourceCount = 1):**
- `fact`: 접두사 없이 사실 요약
- `consensusFacts`: null
- `conflictingFacts`: null

## 수정 대상 코드 (4개 파일)

| 파일 | 변경 |
|---|---|
| `src/lib/types.ts` | `RawCluster` 인터페이스 추가 |
| `src/lib/news-collector.ts` | `deduplicateAndMerge` → `clusterArticles` 교체 |
| `src/lib/prompts/daily-digest.ts` | `buildCategoryPrompt`에 클러스터 본문 통합 |
| `src/app/api/digest/generate/route.ts` | 클러스터 데이터로 DB 저장 |

## DB 필드 (이미 존재, 마이그레이션 불필요)

- `NewsItem.sourceCount Int @default(1)`
- `NewsItem.sourceList String[]`
- `NewsItem.consensusFacts String? @db.Text`
- `NewsItem.conflictingFacts String? @db.Text`

## UI 표시 규칙

- sourceCount >= 2: `[N곳 공통 보도]` 배지 + 출처 목록 링크
- sourceCount >= 3: 강조 표시 (높은 신뢰도)
- 출처 목록은 기사 하단에 모두 표시

## 검증 기준

수집 완료 후 반드시 확인:
1. 카테고리당 다출처 클러스터(sourceCount >= 2) 최소 2개 이상
2. consensusFacts가 비어있지 않은 다출처 기사 >= 80%
3. fact 앞에 "[N곳 공통 보도]" 접두사 존재 (sourceCount >= 2인 모든 기사)
4. 단일 출처 기사에 가짜 다출처 표시 0건
