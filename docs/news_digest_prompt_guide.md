# 📰 일일 뉴스 다이제스트 시스템 - 프롬프트 설계 가이드

---

## 1단계: 마켓 데이터 수집 프롬프트

> 뉴스 요약 전에 먼저 오늘의 핵심 지표를 수집하는 단계입니다.
> 이 데이터는 증권 카테고리 상단의 미니 대시보드와, 뉴스 요약 시 맥락 연결에 활용됩니다.

```
당신은 금융 데이터 수집 전문가입니다.
오늘 날짜: {{DATE}}

아래 항목의 최신 데이터를 수집하여 JSON 형식으로 반환하세요.

수집 항목:
- KOSPI (지수, 전일대비 등락률)
- KOSDAQ (지수, 전일대비 등락률)
- 원/달러 환율 (현재가, 전일대비)
- WTI 유가 (현재가, 전일대비 등락률)
- 미국채 10년물 금리 (현재, 전일대비)
- 비트코인 (현재가 USD, 전일대비 등락률)

출력 형식:
{
  "date": "2026-04-14",
  "market_snapshot": {
    "kospi": { "value": 2650.32, "change": "+1.2%", "direction": "up" },
    "kosdaq": { "value": 870.15, "change": "-0.3%", "direction": "down" },
    "usd_krw": { "value": 1385.50, "change": "+5.20", "direction": "up" },
    "wti": { "value": 72.30, "change": "+3.5%", "direction": "up" },
    "us_10y": { "value": 4.35, "change": "+0.05", "direction": "up" },
    "btc_usd": { "value": 67500, "change": "-2.1%", "direction": "down" }
  }
}
```

---

## 2단계: 뉴스 수집 및 구조화 요약 프롬프트 (핵심)

> 이것이 메인 프롬프트입니다. 카테고리별 뉴스 수집 + 3줄 요약 + 긴급도 분류 + 맥락 태깅을 한번에 처리합니다.

```
# 역할 정의
당신은 시니어 뉴스 에디터 겸 투자 애널리스트입니다.
매일 아침 의사결정자를 위한 뉴스 브리핑을 작성합니다.
독자는 IT업계 시니어 개발자이면서 적극적 투자자이며, 정책과 부동산에도 관심이 많은 사람입니다.

# 오늘 날짜
{{DATE}}

# 마켓 데이터 (1단계에서 수집된 데이터)
{{MARKET_SNAPSHOT_JSON}}

# 작업 지시

## [STEP 1] 뉴스 수집
아래 5개 카테고리에서 각 10건, 총 50건의 오늘자 주요 뉴스를 수집하세요.

카테고리:
1. 🌍 글로벌 - 국제정세, 지정학, 주요국 경제, 글로벌 이벤트
2. 📈 증권 - 주식시장, 기업실적, IPO, M&A, 투자전략
3. 🤖 AI - 인공지능 기술, 빅테크, 스타트업, 규제, 신제품
4. 🏛️ 정부정책 - 국내 법안, 규제, 세제, 산업정책, 인사
5. 🏠 부동산 - 아파트 시세, 청약, 재개발, 대출, 정책 변화

## [STEP 2] 각 뉴스를 아래 구조로 요약

각 뉴스는 반드시 아래 3줄 구조를 따르세요. 기사 원문을 그대로 복사하지 마세요.
독자가 10초 안에 핵심을 파악할 수 있도록 작성하세요.

### 3줄 요약 구조:

| 구분 | 설명 | 예시 |
|------|------|------|
| 📌 팩트 (What) | 무슨 일이 일어났는가. 수치/날짜/주체를 포함한 객관적 사실 1문장 | "미국, 4월 13일부터 이란 출입 해상교통 전면 봉쇄 발표" |
| 💡 임팩트 (Why) | 왜 중요한가. 시장/산업/사회에 미치는 영향 1문장 | "호르무즈 해협 봉쇄 시 글로벌 원유 수송량 20% 차질, 유가 배럴당 4달러 이상 급등 전망" |
| 🎯 액션 (So What) | 독자에게 어떤 의미인가. 구체적 행동 지침 1문장 | "에너지주(두산에너빌리티, S-Oil) 단기 모멘텀 주시, 유가 ETF 헤지 검토" |

## [STEP 3] 긴급도 분류

각 뉴스에 아래 3단계 중 하나의 긴급도 태그를 부여하세요.

- 🔴 속보 (Breaking): 오늘 당장 포트폴리오/의사결정에 영향. 즉시 대응 필요
  - 기준: 시장 급변, 전쟁/재난, 긴급 정책 발표, 금리/환율 급변동
- 🟡 주목 (Watch): 1~2주 내 영향 예상. 모니터링 필요
  - 기준: 정책 예고, 실적 발표 예정, 기술 트렌드 변화, 시장 구조 변화
- 🔵 참고 (Note): 알아두면 좋은 배경 지식. 중장기 관점
  - 기준: 산업 동향, 해외 사례, 연구 결과, 인물/기업 소식

### 긴급도 부여 원칙:
- 🔴 속보는 카테고리당 최대 2건으로 제한 (남발 금지)
- 투자/자산에 직접 영향을 주는 뉴스는 긴급도를 1단계 올림
- 글로벌 이슈가 국내 시장에 연쇄 영향이 있으면 긴급도를 1단계 올림

## [STEP 4] 맥락 연결 태깅

뉴스 간 인과관계나 연쇄 영향이 있는 경우, 관련 뉴스끼리 동일한 `context_tag`를 부여하세요.

예시:
- 이란 해상봉쇄(글로벌) ↔ 유가 급등 전망(증권) ↔ 에너지 정책 변화(정부정책)
  → context_tag: "이란_에너지_위기"
- AI 규제 법안(정부정책) ↔ 빅테크 주가 영향(증권) ↔ AI 스타트업 투자 위축(AI)
  → context_tag: "AI_규제_파급"

하나의 뉴스에 여러 context_tag가 붙을 수 있습니다.

## [STEP 5] 카테고리 브리핑 요약

각 카테고리의 10건 뉴스를 종합하여, 카테고리별 2~3문장의 총평을 작성하세요.
"오늘 이 카테고리에서 가장 중요한 흐름은 무엇인가"를 한눈에 전달하는 것이 목적입니다.

예시:
"오늘 글로벌은 이란 해상봉쇄 이슈가 지배적. 미-이란 협상 결렬로 호르무즈 해협 긴장 최고조이며, 유가 4달러 이상 상승 전망. 캐나다 북극 순찰 완수와 네덜란드 에너지 전환 이슈도 주목."

## [STEP 6] 크로스 카테고리 TOP 3 선정

전체 50건 중 오늘 가장 임팩트가 큰 뉴스 3건을 선정하세요.
카테고리에 관계없이 "오늘 반드시 알아야 할 뉴스"를 기준으로 선정합니다.

선정 기준 (가중치 순):
1. 내 자산(주식/부동산/연금)에 직접 영향 → 최우선
2. 시장 전체 방향성에 영향 → 우선
3. 향후 1개월 내 중대한 변화 예고 → 높음
4. 산업/기술 패러다임 변화 → 보통

각 TOP 뉴스는 일반 3줄 요약에 추가로 아래 내용을 포함하세요:
- 📊 관련 수치: 핵심 데이터 포인트 2~3개
- 🔗 맥락 연결: 다른 카테고리 뉴스와의 연관 관계
- 📅 향후 일정: 관련 후속 이벤트나 발표 일정

---

# 출력 형식

반드시 아래 JSON 구조로 출력하세요. 마크다운이나 추가 설명 없이 순수 JSON만 출력하세요.

{
  "date": "2026-04-14",
  "market_snapshot": { ... 1단계 데이터 ... },

  "top3_highlights": [
    {
      "rank": 1,
      "title": "뉴스 제목",
      "category": "글로벌",
      "urgency": "🔴 속보",
      "fact": "팩트 1문장",
      "impact": "임팩트 1문장",
      "action": "액션 1문장",
      "related_data": ["WTI +3.5%", "호르무즈 해협 원유 수송량 20%"],
      "context_links": ["이란_에너지_위기 → 증권 #3, 정부정책 #7"],
      "upcoming_events": ["4/16 OPEC 긴급회의", "4/18 미-이란 2차 회담"],
      "source": "출처 매체명"
    }
  ],

  "categories": {
    "글로벌": {
      "summary": "카테고리 총평 2~3문장",
      "news": [
        {
          "id": 1,
          "title": "뉴스 제목",
          "urgency": "🔴 속보 | 🟡 주목 | 🔵 참고",
          "fact": "팩트 1문장 (What happened)",
          "impact": "임팩트 1문장 (Why it matters)",
          "action": "액션 1문장 (What to do)",
          "context_tags": ["이란_에너지_위기"],
          "source": "출처 매체명",
          "source_url": "원문 URL"
        }
      ]
    },
    "증권": { ... },
    "AI": { ... },
    "정부정책": { ... },
    "부동산": { ... }
  },

  "context_map": {
    "이란_에너지_위기": {
      "description": "이란 해상봉쇄 → 유가급등 → 에너지주 모멘텀 → 인플레 우려",
      "related_news": ["글로벌#1", "글로벌#5", "증권#3", "정부정책#7"],
      "investment_implication": "에너지 섹터 단기 강세, 항공/운송 약세 전망"
    }
  }
}

---

# 품질 체크리스트 (출력 전 반드시 확인)

□ 각 뉴스의 fact/impact/action이 모두 1문장인가?
□ fact에 구체적 수치/날짜/주체가 포함되어 있는가?
□ action이 "~검토", "~주시", "~대비" 등 구체적 행동을 제시하는가?
□ 🔴 속보가 카테고리당 2건을 초과하지 않는가?
□ 맥락 연결이 있는 뉴스에 context_tag가 부여되었는가?
□ top3_highlights에 카테고리가 편중되지 않았는가? (가급적 2개 이상 카테고리)
□ 기사 원문을 그대로 복사한 문장이 없는가?
□ 카테고리별 summary가 작성되었는가?
```

---

## 3단계: 프론트엔드 렌더링 가이드

> 위 JSON 출력을 프론트엔드에서 어떤 구조로 렌더링할지에 대한 가이드입니다.

### 페이지 구조 (위에서 아래 순서)

```
┌─────────────────────────────────────────────────┐
│  📊 마켓 미니 대시보드                              │
│  KOSPI 2,650 (+1.2%) | KOSDAQ 870 (-0.3%)       │
│  USD/KRW 1,385 (+5.2) | WTI $72.3 (+3.5%)       │
│  US10Y 4.35% (+0.05) | BTC $67,500 (-2.1%)      │
├─────────────────────────────────────────────────┤
│  🔥 오늘의 핵심 TOP 3                              │
│  ┌───────────────────────────────────────────┐   │
│  │ 🔴 #1 이란 해상봉쇄 발효                      │   │
│  │ 📌 미국, 이란 출입 해상교통 전면 봉쇄 발표      │   │
│  │ 💡 호르무즈 해협 봉쇄 시 유가 $4+ 급등 전망    │   │
│  │ 🎯 에너지주 단기 모멘텀, 유가ETF 헤지 검토     │   │
│  │ 📊 WTI+3.5% | 수송량 20% 차질               │   │
│  │ 🔗 → 증권#3, 정부정책#7                       │   │
│  │ 📅 4/16 OPEC긴급회의, 4/18 2차회담           │   │
│  └───────────────────────────────────────────┘   │
│  [#2 카드] [#3 카드]                               │
├─────────────────────────────────────────────────┤
│  📂 카테고리 탭: [글로벌] [증권] [AI] [정책] [부동산] │
├─────────────────────────────────────────────────┤
│  🌍 글로벌 브리핑                                   │
│  "오늘 글로벌은 이란 봉쇄 이슈가 지배적..."          │
│                                                   │
│  ┌──────────────────────────────────────────┐    │
│  │ 🔴 이란 해상봉쇄 발효              [이란_에너지] │    │
│  │ 📌 미국, 4/13부터 이란 해상교통 전면 봉쇄       │    │
│  │ 💡 호르무즈 봉쇄 시 글로벌 원유수송 20% 차질   │    │
│  │ 🎯 에너지주 단기 모멘텀 주시, 유가ETF 헤지     │    │
│  ├──────────────────────────────────────────┤    │
│  │ 🟡 캐나다 북극 순찰 완수                       │    │
│  │ 📌 캐나다군, 역사상 최대 규모 북극 순찰 완료    │    │
│  │ 💡 북극 자원 경쟁 가속, NATO 북극 전략 변화    │    │
│  │ 🎯 방산주 중장기 관심, 북극항로 관련주 모니터   │    │
│  ├──────────────────────────────────────────┤    │
│  │ ... (리스트 뷰로 10건 모두 표시)                │    │
│  └──────────────────────────────────────────┘    │
├─────────────────────────────────────────────────┤
│  🔗 맥락 연결 맵 (하단 또는 사이드바)                │
│  [이란_에너지_위기] → 글로벌#1, 증권#3, 정책#7     │
│  "이란 봉쇄 → 유가급등 → 에너지주↑ → 인플레 우려"  │
└─────────────────────────────────────────────────┘
```

### 리스트 뷰 vs 카드 뷰 전환

```
리스트 뷰 (기본 - 정보밀도 최대):
┌─────┬────────────────────────────────────────┐
│ 🔴  │ 이란 해상봉쇄 발효                        │
│     │ 📌 미국, 이란 출입 해상교통 전면 봉쇄       │
│     │ 💡 호르무즈 봉쇄 시 유가 $4+ 급등          │
│     │ 🎯 에너지주 모멘텀, 유가ETF 헤지           │
├─────┼────────────────────────────────────────┤
│ 🟡  │ 캐나다 북극 순찰 완수                      │
│     │ 📌 캐나다군, 역사상 최대 규모 북극 순찰     │
│     │ 💡 북극 자원 경쟁 가속                     │
│     │ 🎯 방산주 중장기 관심                      │
└─────┴────────────────────────────────────────┘

카드 뷰 (토글 선택):
현재 디자인과 유사하지만, 본문을 3줄 구조로 교체
```

---

## 4단계: 보조 프롬프트들

### 4-1. 맥락 연결 분석 프롬프트 (선택적으로 별도 실행)

> 뉴스 간 인과관계를 더 깊이 분석하고 싶을 때 사용합니다.

```
당신은 거시경제 분석가입니다.

아래 뉴스 목록을 분석하여 뉴스 간의 인과관계와 연쇄 영향을 파악하세요.

뉴스 목록:
{{NEWS_LIST_JSON}}

분석 지시:
1. 직접적 인과관계가 있는 뉴스 그룹을 식별하세요
2. 각 그룹에 대해 "원인 → 경로 → 결과" 체인을 작성하세요
3. 투자 관점에서의 시사점을 도출하세요
4. 1주일, 1개월, 3개월 시계열로 예상 영향을 구분하세요

출력 형식:
{
  "context_chains": [
    {
      "tag": "이란_에너지_위기",
      "chain": "이란 봉쇄 → 호르무즈 차단 → 유가 급등 → 인플레 재점화 → 금리인하 지연",
      "related_news_ids": ["글로벌#1", "글로벌#5", "증권#3", "정부정책#7"],
      "timeline": {
        "1주": "유가 $4~6 상승, 에너지주 단기 급등",
        "1개월": "인플레 지표 반등, 원/달러 환율 상승 압력",
        "3개월": "금리인하 기대 후퇴, 성장주 밸류에이션 압박"
      },
      "action_items": [
        "에너지 섹터 비중 확대 (두산에너빌리티, S-Oil)",
        "항공/운송 섹터 비중 축소",
        "유가 ETF(KODEX WTI선물) 헤지 포지션 검토"
      ]
    }
  ]
}
```

### 4-2. 개인화 필터 프롬프트

> 독자의 관심 종목/테마에 맞춰 뉴스 우선순위를 재조정합니다.

```
당신은 개인 투자 어드바이저입니다.

독자 프로필:
- 관심 섹터: 반도체 (한미반도체, HBM), 에너지/원자력 (두산에너빌리티, SMR), 반도체장비 (IMT)
- 투자 스타일: 중기 스윙 (1~3개월), 분할매수 선호
- 자산: DC형 퇴직연금 (70/30 위험/안전), 개별주식 포트폴리오
- 관심 부동산: 수도권 아파트
- 직업 관련: IT/클라우드/AI 인프라

아래 뉴스 다이제스트를 분석하여, 독자 프로필 기준으로 개인화된 알림을 생성하세요.

{{FULL_DIGEST_JSON}}

출력:
{
  "personalized_alerts": [
    {
      "priority": 1,
      "type": "portfolio_impact",
      "message": "보유 관심종목 두산에너빌리티: 이란 봉쇄로 에너지 섹터 강세 전망. 현재가 대비 +5~8% 단기 상승 가능성",
      "related_news": ["글로벌#1", "증권#3"],
      "suggested_action": "두산에너빌리티 분할매수 2차 진입 검토 (목표가 상향)"
    },
    {
      "priority": 2,
      "type": "sector_watch",
      "message": "반도체 장비: 삼성전자 HBM4 양산 앞두고 한미반도체 TC본더 수주 확대 전망",
      "related_news": ["AI#5", "증권#8"],
      "suggested_action": "한미반도체 실적발표(4/25) 전 포지션 점검"
    }
  ],
  "retirement_portfolio_note": "이란 리스크로 인플레 상승 시 채권 비중 조정 필요. 안전자산 30% 내 물가연동채 ETF 편입 검토"
}
```

---

## 5단계: 워크플로우 자동화 구조

> n8n 또는 자체 스케줄러에서 매일 아침 실행하는 전체 파이프라인입니다.

```
[매일 오전 7:00 자동 실행]

Step 1: 마켓 데이터 수집
  → API 호출 (한국투자증권 API / Yahoo Finance / 네이버 금융 크롤링)
  → market_snapshot JSON 생성
  → market_daily 테이블에도 저장 (주간 차트용)

Step 2: 뉴스 소스 수집
  → RSS/크롤링으로 원문 뉴스 수집 (카테고리별 20~30건)
  → 중복 제거, 기본 필터링

Step 3: Claude API 호출 - 메인 다이제스트 생성
  → 2단계 프롬프트 실행
  → market_snapshot + 수집된 뉴스 원문 입력
  → 구조화된 JSON 출력

Step 4: (선택) Claude API 호출 - 맥락 연결 심화 분석
  → 4-1 프롬프트 실행
  → Step 3 결과 입력

Step 5: (선택) Claude API 호출 - 개인화 알림 생성
  → 4-2 프롬프트 실행
  → Step 3 + Step 4 결과 입력

Step 6: DB 저장 (6단계 참조)
  → daily_digest, category_briefing, news_item, market_daily INSERT
  → context_tag_history UPSERT
  → JSON 스키마 검증 포함

Step 7: 프론트엔드 렌더링
  → DB에서 조회하여 렌더링 (JSON 직접 사용이 아닌 DB 기반)
  → 일일 뷰 + 날짜 네비게이터 업데이트

Step 8: Slack/텔레그램 알림 (요약본)
  → "🔥 오늘의 핵심 3선" + 마켓 스냅샷만 전송
  → 상세 내용은 웹 대시보드 링크

[매주 일요일 오후 8:00 자동 실행]
  → 8단계(주간 브리핑 워크플로우) 실행
  → 주간 뷰 업데이트 + Slack 주간 요약 발송
```

---

## 6단계: 뉴스 데이터 저장 설계

> 매일 생성된 뉴스 다이제스트를 DB에 저장하여, 날짜별 조회 및 주간 분석이 가능하도록 합니다.

### 6-1. PostgreSQL 스키마 설계

```sql
-- ============================================
-- 일일 다이제스트 메타 테이블
-- ============================================
CREATE TABLE daily_digest (
    id              BIGSERIAL PRIMARY KEY,
    digest_date     DATE NOT NULL UNIQUE,          -- 다이제스트 날짜 (PK 역할)
    market_snapshot JSONB NOT NULL,                 -- 마켓 미니 대시보드 데이터
    top3_highlights JSONB NOT NULL,                 -- 오늘의 핵심 TOP 3
    context_map     JSONB,                          -- 맥락 연결 맵
    personalized_alerts JSONB,                      -- 개인화 알림 (4-2 결과)
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_daily_digest_date ON daily_digest(digest_date DESC);

-- ============================================
-- 카테고리 브리핑 테이블
-- ============================================
CREATE TABLE category_briefing (
    id              BIGSERIAL PRIMARY KEY,
    digest_date     DATE NOT NULL,
    category        VARCHAR(20) NOT NULL,           -- 글로벌, 증권, AI, 정부정책, 부동산
    summary         TEXT NOT NULL,                   -- 카테고리 총평 2~3문장
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uk_category_date UNIQUE (digest_date, category),
    CONSTRAINT fk_digest FOREIGN KEY (digest_date) REFERENCES daily_digest(digest_date)
);

-- ============================================
-- 개별 뉴스 테이블 (핵심 - 모든 뉴스가 여기 저장됨)
-- ============================================
CREATE TABLE news_item (
    id              BIGSERIAL PRIMARY KEY,
    digest_date     DATE NOT NULL,
    category        VARCHAR(20) NOT NULL,
    news_order      INT NOT NULL,                    -- 카테고리 내 순서 (1~10)
    title           TEXT NOT NULL,
    urgency         VARCHAR(10) NOT NULL,            -- breaking, watch, note
    fact            TEXT NOT NULL,                    -- 📌 팩트
    impact          TEXT NOT NULL,                    -- 💡 임팩트
    action          TEXT NOT NULL,                    -- 🎯 액션
    context_tags    TEXT[],                           -- 맥락 연결 태그 배열
    source          VARCHAR(100),                     -- 출처 매체명
    source_url      TEXT,                             -- 원문 URL
    is_top3         BOOLEAN DEFAULT FALSE,           -- TOP 3 선정 여부
    top3_rank       INT,                              -- TOP 3 순위 (1,2,3)
    related_data    TEXT[],                           -- TOP 3용: 관련 수치
    context_links   TEXT[],                           -- TOP 3용: 맥락 연결
    upcoming_events TEXT[],                           -- TOP 3용: 향후 일정
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uk_news_item UNIQUE (digest_date, category, news_order),
    CONSTRAINT fk_digest_news FOREIGN KEY (digest_date) REFERENCES daily_digest(digest_date)
);

-- 핵심 조회 인덱스
CREATE INDEX idx_news_date_cat ON news_item(digest_date DESC, category);
CREATE INDEX idx_news_urgency ON news_item(urgency, digest_date DESC);
CREATE INDEX idx_news_context_tags ON news_item USING GIN(context_tags);
CREATE INDEX idx_news_top3 ON news_item(is_top3, digest_date DESC) WHERE is_top3 = TRUE;

-- ============================================
-- 맥락 연결 이력 테이블 (context_tag 추적용)
-- ============================================
CREATE TABLE context_tag_history (
    id              BIGSERIAL PRIMARY KEY,
    tag_name        VARCHAR(100) NOT NULL,           -- 예: "이란_에너지_위기"
    first_appeared  DATE NOT NULL,                   -- 최초 등장일
    last_appeared   DATE NOT NULL,                   -- 최근 등장일
    appearance_count INT DEFAULT 1,                  -- 등장 횟수
    description     TEXT,                             -- 최신 설명
    investment_implication TEXT,                      -- 최신 투자 시사점
    status          VARCHAR(20) DEFAULT 'active',    -- active, resolved, dormant
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uk_tag_name UNIQUE (tag_name)
);

CREATE INDEX idx_context_tag_status ON context_tag_history(status, last_appeared DESC);

-- ============================================
-- 주간 다이제스트 테이블
-- ============================================
CREATE TABLE weekly_digest (
    id              BIGSERIAL PRIMARY KEY,
    week_start      DATE NOT NULL,                   -- 주간 시작일 (월요일)
    week_end        DATE NOT NULL,                   -- 주간 종료일 (일요일)
    week_label      VARCHAR(20) NOT NULL,            -- "2026-W16" (ISO week)
    executive_summary TEXT NOT NULL,                  -- 주간 총괄 요약
    category_summaries JSONB NOT NULL,               -- 카테고리별 주간 요약
    weekly_top5     JSONB NOT NULL,                   -- 주간 핵심 뉴스 TOP 5
    trend_analysis  JSONB,                            -- 트렌드 분석
    market_weekly   JSONB,                            -- 주간 마켓 데이터 (시가/종가/변동)
    context_evolution JSONB,                          -- 맥락 태그 진화 추적
    next_week_watchlist JSONB,                        -- 다음 주 관전 포인트
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uk_weekly UNIQUE (week_start)
);

CREATE INDEX idx_weekly_date ON weekly_digest(week_start DESC);

-- ============================================
-- 마켓 데이터 일별 이력 (차트/트렌드 분석용)
-- ============================================
CREATE TABLE market_daily (
    id              BIGSERIAL PRIMARY KEY,
    trade_date      DATE NOT NULL UNIQUE,
    kospi           DECIMAL(10,2),
    kospi_change    DECIMAL(5,2),                    -- 등락률 %
    kosdaq          DECIMAL(10,2),
    kosdaq_change   DECIMAL(5,2),
    usd_krw         DECIMAL(10,2),
    usd_krw_change  DECIMAL(10,2),
    wti             DECIMAL(10,2),
    wti_change      DECIMAL(5,2),
    us_10y          DECIMAL(5,2),
    us_10y_change   DECIMAL(5,3),
    btc_usd         DECIMAL(12,2),
    btc_change      DECIMAL(5,2),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_market_date ON market_daily(trade_date DESC);
```

### 6-2. 저장 파이프라인 (워크플로우 Step 6 상세)

```
[Step 6 상세: Claude API 응답 JSON → DB 저장]

6-1. JSON 스키마 검증
  → JSON Schema Validator로 출력 형식 검증
  → 실패 시 재시도 (최대 2회) 또는 fallback 저장

6-2. daily_digest 테이블 INSERT
  → digest_date, market_snapshot, top3_highlights, context_map

6-3. market_daily 테이블 INSERT
  → market_snapshot에서 개별 필드 추출하여 정규화 저장
  → 이 테이블은 주간/월간 차트 렌더링에 사용

6-4. category_briefing 테이블 INSERT (5건)
  → 카테고리별 summary 저장

6-5. news_item 테이블 INSERT (50건)
  → 카테고리별 뉴스 개별 저장
  → top3_highlights에 포함된 뉴스는 is_top3=TRUE, top3_rank 설정

6-6. context_tag_history 테이블 UPSERT
  → 새로운 태그: INSERT (first_appeared = today)
  → 기존 태그: UPDATE last_appeared, appearance_count++, description 갱신
  → 7일 이상 미등장 태그: status → 'dormant'
  → 30일 이상 미등장 태그: status → 'resolved'

6-7. 데이터 정합성 검증
  → 카테고리당 10건 저장 확인
  → TOP 3 뉴스 참조 무결성 확인
  → context_tags 역참조 확인
```

### 6-3. 핵심 조회 쿼리

```sql
-- ① 특정 날짜의 전체 다이제스트 조회
SELECT d.digest_date, d.market_snapshot, d.top3_highlights,
       cb.category, cb.summary,
       ni.news_order, ni.title, ni.urgency, ni.fact, ni.impact, ni.action,
       ni.context_tags, ni.source
FROM daily_digest d
JOIN category_briefing cb ON cb.digest_date = d.digest_date
JOIN news_item ni ON ni.digest_date = d.digest_date AND ni.category = cb.category
WHERE d.digest_date = '2026-04-14'
ORDER BY cb.category, ni.news_order;

-- ② 최근 7일간 🔴속보 뉴스만 조회 (날짜별 흐름 파악)
SELECT digest_date, category, title, fact, impact, action, context_tags
FROM news_item
WHERE urgency = 'breaking'
  AND digest_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY digest_date DESC, category;

-- ③ 특정 context_tag 관련 뉴스 추적 (이슈 타임라인)
SELECT digest_date, category, title, urgency, fact, impact, action
FROM news_item
WHERE '이란_에너지_위기' = ANY(context_tags)
ORDER BY digest_date ASC;

-- ④ 최근 7일 마켓 데이터 추이 (미니 차트용)
SELECT trade_date, kospi, kospi_change, usd_krw, wti, us_10y
FROM market_daily
WHERE trade_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY trade_date ASC;

-- ⑤ 주간 카테고리별 속보 건수 통계
SELECT category,
       COUNT(*) FILTER (WHERE urgency = 'breaking') AS breaking_count,
       COUNT(*) FILTER (WHERE urgency = 'watch') AS watch_count,
       COUNT(*) FILTER (WHERE urgency = 'note') AS note_count
FROM news_item
WHERE digest_date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY category
ORDER BY breaking_count DESC;

-- ⑥ 활성 맥락 태그 조회 (현재 진행 중인 이슈)
SELECT tag_name, first_appeared, last_appeared, appearance_count,
       description, investment_implication
FROM context_tag_history
WHERE status = 'active'
ORDER BY last_appeared DESC;

-- ⑦ 날짜 범위 다이제스트 조회 (주간 뷰용)
SELECT d.digest_date, d.top3_highlights, d.market_snapshot
FROM daily_digest d
WHERE d.digest_date BETWEEN '2026-04-08' AND '2026-04-14'
ORDER BY d.digest_date ASC;
```

---

## 7단계: 주간 브리핑 프롬프트

> 매주 일요일(또는 월요일 오전) 실행. 지난 7일간 축적된 뉴스를 종합 분석합니다.

```
# 역할 정의
당신은 수석 전략 애널리스트입니다.
지난 1주일간의 일일 뉴스 다이제스트를 종합 분석하여 주간 브리핑을 작성합니다.
독자는 IT업계 시니어 개발자이면서 적극적 투자자입니다.

# 기간
{{WEEK_START}} (월) ~ {{WEEK_END}} (일) / {{WEEK_LABEL}}

# 입력 데이터
## 7일간 일일 다이제스트 (날짜순)
{{DAILY_DIGESTS_ARRAY_JSON}}

## 7일간 마켓 데이터
{{MARKET_DAILY_ARRAY_JSON}}

## 활성 맥락 태그 목록
{{ACTIVE_CONTEXT_TAGS_JSON}}

# 작업 지시

## [STEP 1] 주간 총괄 요약 (Executive Summary)
이번 주 전체를 관통하는 핵심 흐름을 5~7문장으로 요약하세요.
- 가장 임팩트가 컸던 이벤트와 그 파급 효과
- 주간 마켓 방향성 변화 (시가 → 종가 비교)
- 다음 주로 이어지는 미결 이슈

## [STEP 2] 카테고리별 주간 요약
각 카테고리에 대해:
- 이번 주 핵심 흐름 3~4문장
- 주간 내 변화 추이 (월→금 어떻게 전개되었는지)
- 가장 임팩트 큰 뉴스 1건 하이라이트

## [STEP 3] 주간 핵심 뉴스 TOP 5
일일 TOP 3에서 선정된 뉴스들(총 ~21건) 중 주간 기준으로 가장 중요한 5건을 재선정하세요.
각 뉴스에 대해:
- 3줄 요약 (팩트/임팩트/액션)
- 주간 내 전개 과정 (어떻게 발전/변화했는지)
- 현재 상태 (진행중/해결/확대/소강)

## [STEP 4] 트렌드 분석
이번 주 데이터를 기반으로 아래 분석을 수행하세요.

### 4-1. 이슈 진화 추적
- 지난주에 시작된 이슈가 이번 주 어떻게 전개되었는가?
- 새로 등장한 이슈는 무엇인가?
- 소멸된(resolved) 이슈는 무엇인가?

### 4-2. 마켓 트렌드
- 주간 KOSPI/KOSDAQ 방향성과 원인
- 환율/유가/금리 변동 요인
- 섹터별 강약 (어떤 섹터가 강했고/약했는지)

### 4-3. 카테고리 간 연쇄 영향
- 글로벌 이슈가 국내 증권/정책에 미친 영향 체인
- AI 이슈가 증권/정책에 미친 영향 체인
- 정책 변화가 부동산/증권에 미친 영향 체인

## [STEP 5] 맥락 태그 진화 보고
활성 맥락 태그 각각에 대해:
- 이번 주 등장 횟수 및 관련 뉴스
- 상태 변화 (신규 등장 / 지속 / 확대 / 소강 / 해결)
- 다음 주 전망

## [STEP 6] 다음 주 관전 포인트
다음 주({{NEXT_WEEK_START}} ~ {{NEXT_WEEK_END}}) 주목해야 할 이벤트와 이슈를 정리하세요.
- 예정된 이벤트: 실적발표, 정책발표, 국제회의, 경제지표 등
- 진행 중인 이슈의 예상 전개 방향
- 투자 관점 체크리스트

# 출력 형식
순수 JSON으로 출력하세요.

{
  "week_label": "2026-W16",
  "week_start": "2026-04-08",
  "week_end": "2026-04-14",

  "executive_summary": "주간 총괄 요약 5~7문장",

  "market_weekly": {
    "kospi": { "open": 2620, "close": 2650, "high": 2680, "low": 2600, "weekly_change": "+1.1%" },
    "kosdaq": { "open": 880, "close": 870, "high": 890, "low": 860, "weekly_change": "-1.1%" },
    "usd_krw": { "open": 1375, "close": 1385, "weekly_change": "+0.7%" },
    "wti": { "open": 68.5, "close": 72.3, "weekly_change": "+5.5%" },
    "us_10y": { "open": 4.30, "close": 4.35, "weekly_change": "+0.05" },
    "summary": "마켓 주간 총평 2~3문장"
  },

  "category_summaries": {
    "글로벌": {
      "weekly_summary": "주간 흐름 3~4문장",
      "progression": "월요일에 A 발생 → 수요일에 B로 확대 → 금요일에 C로 전개",
      "highlight_news": {
        "date": "2026-04-13",
        "title": "이란 해상봉쇄",
        "fact": "...", "impact": "...", "action": "..."
      }
    },
    "증권": { ... },
    "AI": { ... },
    "정부정책": { ... },
    "부동산": { ... }
  },

  "weekly_top5": [
    {
      "rank": 1,
      "title": "뉴스 제목",
      "category": "글로벌",
      "first_date": "2026-04-10",
      "fact": "...",
      "impact": "...",
      "action": "...",
      "weekly_progression": "화요일 첫 보도 → 목요일 협상 결렬 → 금요일 봉쇄 시행",
      "current_status": "진행중",
      "related_context_tags": ["이란_에너지_위기"]
    }
  ],

  "trend_analysis": {
    "new_issues": ["이번 주 새로 등장한 이슈 목록"],
    "escalated_issues": ["확대/심화된 이슈 목록"],
    "resolved_issues": ["해결/소멸된 이슈 목록"],
    "sector_strength": {
      "strong": ["에너지", "방산"],
      "weak": ["항공", "운송"],
      "neutral": ["IT", "바이오"]
    },
    "cross_category_chains": [
      {
        "chain": "이란 봉쇄(글로벌) → 유가 급등(증권) → 인플레 우려(정책) → 금리 동결 가능성(부동산)",
        "impact_level": "high"
      }
    ]
  },

  "context_evolution": [
    {
      "tag": "이란_에너지_위기",
      "weekly_appearances": 12,
      "status_change": "신규 등장 → 급속 확대",
      "related_dates": ["2026-04-10", "2026-04-11", "2026-04-13", "2026-04-14"],
      "next_week_outlook": "OPEC 긴급회의(4/16) 결과에 따라 확대 또는 소강 갈림길"
    }
  ],

  "next_week_watchlist": {
    "scheduled_events": [
      { "date": "2026-04-16", "event": "OPEC 긴급회의", "impact": "유가 방향성 결정" },
      { "date": "2026-04-18", "event": "미-이란 2차 회담", "impact": "봉쇄 해제 여부" },
      { "date": "2026-04-20", "event": "삼성전자 잠정 실적", "impact": "반도체 섹터 방향" }
    ],
    "ongoing_monitors": [
      "이란 봉쇄 → 유가/환율 변동 지속 모니터링",
      "AI 규제 법안 국회 상정 여부"
    ],
    "investment_checklist": [
      "에너지주 포지션 유지/확대 여부 재검토",
      "DC연금 안전자산 비중 조정 필요성 점검",
      "반도체 섹터 실적 시즌 진입 대비"
    ]
  }
}

# 품질 체크리스트
□ 7일간 데이터가 모두 반영되었는가?
□ 주간 전개 과정(progression)이 시간 순서대로 기술되었는가?
□ 마켓 데이터 시가/종가가 실제 데이터와 일치하는가?
□ 맥락 태그의 상태 변화가 정확한가?
□ 다음 주 관전 포인트가 구체적 날짜와 함께 제시되었는가?
□ executive_summary가 5~7문장 이내인가?
```

---

## 8단계: 주간 브리핑 워크플로우

> 5단계(일일 워크플로우)에 추가되는 주간 파이프라인입니다.

```
[매주 일요일 오후 8:00 자동 실행 (또는 월요일 오전 6:00)]

Step W-1: 주간 데이터 수집
  → DB에서 최근 7일간 daily_digest, news_item, market_daily 조회
  → 활성 context_tag_history 조회
  → 다음 주 예정 이벤트 수집 (캘린더 API 또는 수동 등록)

Step W-2: 데이터 전처리
  → 7일간 daily_digest JSON 배열 구성
  → market_daily 7일 배열 구성
  → 활성 맥락 태그 배열 구성
  → 토큰 예산 계산 (7일 × 50건 = 350건 → 요약본 사용 시 ~15K 토큰)

Step W-3: Claude API 호출 - 주간 브리핑 생성
  → 7단계 프롬프트 실행
  → 입력: W-2에서 전처리된 데이터
  → 출력: 주간 브리핑 JSON

Step W-4: (선택) 주간 개인화 분석
  → 4-2 프롬프트를 주간 버전으로 변형 실행
  → "이번 주 내 포트폴리오에 영향을 준 이벤트" 분석

Step W-5: 저장
  → weekly_digest 테이블 INSERT
  → context_tag_history 상태 업데이트 (dormant/resolved 처리)

Step W-6: 알림
  → Slack/텔레그램: 주간 총괄 요약 + TOP 5 + 다음 주 관전 포인트
  → 웹 대시보드 주간 뷰 업데이트
```

### 토큰 최적화: 주간 브리핑 입력 데이터 경량화

```
7일 × 50건 뉴스 전체를 넣으면 토큰이 과도하므로,
아래 전략으로 입력을 경량화합니다.

경량화 전략 A: TOP 뉴스 중심
  → 일일 TOP 3 (7일 × 3건 = 21건) + 🔴속보 전체 + 카테고리별 summary
  → 예상 토큰: ~8K~12K (충분히 처리 가능)

경량화 전략 B: 카테고리별 요약 중심
  → 일일 카테고리 summary (7일 × 5개 = 35건) + TOP 3 (21건) + 마켓 데이터 (7건)
  → 예상 토큰: ~6K~10K

권장: 전략 A + B 혼합
  → TOP 3 전문 (21건)
  → 🔴속보 전문 (변동적, 약 10~20건)
  → 카테고리 summary (35건)
  → 마켓 데이터 (7건)
  → 활성 맥락 태그 (변동적)
  → 총 예상 토큰: ~10K~15K → Sonnet 한 번 호출로 충분
```

---

## 9단계: 프론트엔드 주간 뷰 가이드

> 기존 일일 뷰에 추가되는 주간 뷰 UI 구조입니다.

### 네비게이션 구조

```
┌─────────────────────────────────────────────────────────┐
│  📅 날짜 네비게이터                                        │
│  [◀ 이전주] [4/8 월] [4/9 화] [4/10 수] [4/11 목]         │
│            [4/12 금] [4/13 토] [4/14 일] [다음주 ▶]       │
│                                                           │
│  뷰 전환: [📋 일일 뷰] [📊 주간 뷰] [📈 월간 뷰]          │
└─────────────────────────────────────────────────────────┘
```

### 주간 뷰 페이지 구조

```
┌─────────────────────────────────────────────────────────┐
│  📊 2026년 16주차 주간 브리핑 (4/8 ~ 4/14)               │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  📈 주간 마켓 미니 차트                                    │
│  ┌─────────────────────────────────────────────┐         │
│  │ KOSPI  [━━━━━━━╱╲━━━━] 2620→2650 (+1.1%)   │         │
│  │ KOSDAQ [━━╲━━━━━━━━━━] 880→870 (-1.1%)     │         │
│  │ USD/KRW[━━━━━━━╱━━━━━] 1375→1385 (+0.7%)   │         │
│  │ WTI    [━━━━━━━━━╱━━━] $68.5→$72.3 (+5.5%) │         │
│  └─────────────────────────────────────────────┘         │
│                                                           │
├─────────────────────────────────────────────────────────┤
│  📝 주간 총괄 (Executive Summary)                         │
│  "이번 주는 이란 해상봉쇄 이슈가 글로벌/증권/정책을          │
│   관통하며 시장을 지배했습니다. 유가는 주간 5.5% 상승하며     │
│   인플레 재점화 우려가 부각되었고..."                        │
├─────────────────────────────────────────────────────────┤
│  🏆 주간 핵심 TOP 5                                       │
│  ┌──────────────────────────────────────────┐            │
│  │ #1 🔴 이란 해상봉쇄 시행 [글로벌] [진행중]    │            │
│  │ 📌 미국, 이란 해상교통 전면 봉쇄 발표          │            │
│  │ 📅 화 첫보도 → 목 협상결렬 → 금 봉쇄시행      │            │
│  │ 💡 유가 $4+ 급등, 인플레 재점화 우려           │            │
│  │ 🎯 에너지주 포지션 유지, OPEC회의(4/16) 주시  │            │
│  ├──────────────────────────────────────────┤            │
│  │ #2 ... #3 ... #4 ... #5 ...               │            │
│  └──────────────────────────────────────────┘            │
│                                                           │
├─────────────────────────────────────────────────────────┤
│  📂 카테고리별 주간 요약                                    │
│  탭: [🌍 글로벌] [📈 증권] [🤖 AI] [🏛️ 정책] [🏠 부동산] │
│                                                           │
│  🌍 글로벌 주간 요약                                       │
│  "이번 주 글로벌은 이란 봉쇄 이슈가 지배적..."              │
│  📅 전개: 월(이란 경고) → 수(협상 개시) → 금(봉쇄 발효)     │
│                                                           │
│  ★ 주간 하이라이트: 이란 해상봉쇄 발효                      │
│  날짜별 뉴스 타임라인:                                      │
│  4/8  🔵 이란, 핵 협상 재개 시사                           │
│  4/10 🟡 미-이란 협상 이슬라마바드에서 개시                  │
│  4/11 🟡 협상 결렬, 양측 입장차 좁히지 못해                  │
│  4/13 🔴 미국, 이란 해상교통 전면 봉쇄 발표                 │
│  4/14 🔴 호르무즈 봉쇄 역공, 유가 $4 급등 전망              │
│                                                           │
├─────────────────────────────────────────────────────────┤
│  🔗 이슈 진화 맵                                           │
│  ┌──────────────────────────────────────────┐            │
│  │ 🔴 이란_에너지_위기 [신규→급속확대] 12회 등장  │            │
│  │    → 다음 주: OPEC회의(4/16) 분기점            │            │
│  │ 🟡 AI_규제_파급 [지속] 8회 등장               │            │
│  │    → 다음 주: 국회 상정 여부 확인              │            │
│  │ 🔵 반도체_HBM4 [소강] 3회 등장               │            │
│  │    → 다음 주: 삼성전자 잠정실적(4/20)          │            │
│  └──────────────────────────────────────────┘            │
│                                                           │
├─────────────────────────────────────────────────────────┤
│  📅 다음 주 관전 포인트                                     │
│  4/16 (수) OPEC 긴급회의 → 유가 방향 결정                  │
│  4/18 (금) 미-이란 2차 회담 → 봉쇄 해제 여부                │
│  4/20 (일) 삼성전자 잠정 실적 → 반도체 섹터                  │
│                                                           │
│  ✅ 투자 체크리스트:                                        │
│  □ 에너지주 포지션 재검토                                   │
│  □ DC연금 안전자산 비중 점검                                │
│  □ 반도체 실적시즌 진입 대비                                │
└─────────────────────────────────────────────────────────┘
```

### 날짜별 타임라인 뷰 (일일 뷰 확장)

```
뉴스 상세 클릭 시 → 해당 이슈의 날짜별 타임라인 펼침

┌─────────────────────────────────────────────────────────┐
│  🔴 이란 해상봉쇄 [이란_에너지_위기]                        │
│                                                           │
│  현재 상태: 🔴 진행중 | 등장 12회 | 4/10 ~ 현재            │
│                                                           │
│  ● 4/10 (목) - 미-이란 협상 이슬라마바드에서 개시            │
│    📌 JD밴스 부통령, 20시간 마라톤 협상 주도                 │
│    💡 협상 성공 시 이란 제재 완화 기대                       │
│                                                           │
│  ● 4/11 (금) - 협상 결렬                                   │
│    📌 양측 입장차 좁히지 못한 채 종료                        │
│    💡 봉쇄 가능성 급상승, 유가 선반영 시작                   │
│                                                           │
│  ● 4/13 (일) - 미국, 해상교통 봉쇄 발표                    │
│    📌 동부시간 13일 오전 10시부터 이란 출입 봉쇄              │
│    💡 호르무즈 해협 수송량 20% 차질 전망                     │
│                                                           │
│  ● 4/14 (월) - 유가 급등, 이란 반발                        │
│    📌 호르무즈 봉쇄 역공 시 유가 $4+ 추가 상승               │
│    💡 이란, "극단적 요구 후 봉쇄" 비판                       │
│                                                           │
│  📅 다음 이벤트: 4/16 OPEC 긴급회의                        │
│  🔗 연결 뉴스: 증권#3(에너지주), 정책#7(에너지정책)          │
└─────────────────────────────────────────────────────────┘
```

---

## 10단계: 데이터 보존 및 정리 정책

```
보존 정책:
- news_item: 90일 보존 (이후 아카이브 테이블로 이동)
- daily_digest: 1년 보존
- weekly_digest: 영구 보존
- market_daily: 영구 보존
- context_tag_history: 영구 보존

아카이브 전략:
- 90일 경과 news_item → news_item_archive 테이블로 이동
- 아카이브 테이블은 파티셔닝 적용 (월별)
- 또는 ClickHouse로 이관하여 분석 쿼리 성능 확보

정리 배치 (매주 일요일 자정):
  → 90일 경과 news_item DELETE (아카이브 후)
  → context_tag_history에서 60일 이상 미등장 태그 status → 'archived'
  → VACUUM ANALYZE 실행
```

---

## 부록: 프롬프트 최적화 팁

### A. 토큰 절약 전략
- 뉴스 원문을 통째로 넣지 말고, 제목+본문 앞 200자만 입력
- 카테고리별로 프롬프트를 분리 호출하면 컨텍스트 윈도우 효율적 사용
- JSON 출력 강제를 위해 시스템 프롬프트에 "순수 JSON만 출력, 마크다운 금지" 명시

### B. 품질 향상 전략
- Few-shot 예시를 프롬프트에 포함 (좋은 요약 vs 나쁜 요약 대비)
- 나쁜 요약 예시: "해외주식 투자로 수익을 거둔 개인 투자자들은 지난해 발생한..." (원문 복사)
- 좋은 요약 예시: "📌 2026년 해외주식 RIA(복귀계좌) 제도 시행 → 💡 양도세 이연으로 해외주식 장기투자 유리해져 → 🎯 미국주식 보유자는 RIA 계좌 개설 즉시 검토"

### C. 일관성 확보
- temperature: 0.3 이하 권장 (팩트 기반이므로 창의성보다 정확성)
- 동일 프롬프트를 매일 사용하되, 날짜와 마켓 데이터만 교체
- JSON 스키마 검증을 파이프라인에 포함하여 출력 형식 깨짐 방지

### D. 비용 최적화
- 메인 다이제스트(Step 3): claude-sonnet-4-20250514 사용 (비용 대비 품질 최적)
- 맥락 분석(Step 4): claude-sonnet-4-20250514 사용
- 개인화 알림(Step 5): claude-haiku-4-5 사용 가능 (상대적으로 단순한 작업)
```
