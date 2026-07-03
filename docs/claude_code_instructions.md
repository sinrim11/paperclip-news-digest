# 📰 뉴스 다이제스트 시스템 - Claude Code 실전 지시 가이드

> 이 문서는 Claude Code에서 뉴스 다이제스트 시스템을 단계별로 구축하기 위한
> **실제 지시 명령어**를 정리한 가이드입니다.
> 각 단계의 프롬프트를 Claude Code 터미널에 그대로 복사하여 사용하세요.

---

## 🔧 사전 준비: CLAUDE.md 설정

> 프로젝트 루트에 CLAUDE.md를 먼저 생성하여,
> Claude Code가 프로젝트 전체 맥락을 이해할 수 있도록 합니다.
> 아래 내용을 Claude Code에 지시하세요.

### 지시 명령어

```
프로젝트 루트에 CLAUDE.md 파일을 생성해줘. 아래 내용으로 작성해:

# 뉴스 다이제스트 시스템 (News Digest System)

## 프로젝트 개요
- 매일 5개 카테고리(글로벌, 증권, AI, 정부정책, 부동산)에서 각 10건, 총 50건의 뉴스를 수집
- Claude API 웹서치로 뉴스를 수집하고, 구조화된 3줄 요약(팩트/임팩트/액션)으로 변환
- 일일 브리핑 + 주간 브리핑을 생성하여 프론트엔드 대시보드로 제공

## 기술 스택
- Backend: Next.js API Routes (App Router)
- Frontend: React + Next.js 14+ (App Router, Server Components)
- Database: PostgreSQL (뉴스 저장, 주간 분석)
- AI: Anthropic Claude API (claude-sonnet-4-20250514, 웹서치 tool 사용)
- Styling: Tailwind CSS
- 배포: Docker + Kubernetes (기존 인프라 활용)

## 프로젝트 구조
```
news-digest/
├── CLAUDE.md
├── package.json
├── next.config.js
├── tailwind.config.js
├── docker-compose.yml              # PostgreSQL + App
├── Dockerfile
├── prisma/
│   └── schema.prisma               # DB 스키마
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                 # 메인 대시보드
│   │   ├── weekly/
│   │   │   └── page.tsx             # 주간 뷰
│   │   └── api/
│   │       ├── digest/
│   │       │   ├── generate/route.ts    # 일일 다이제스트 생성
│   │       │   ├── [date]/route.ts      # 날짜별 조회
│   │       │   └── range/route.ts       # 기간별 조회
│   │       ├── weekly/
│   │       │   ├── generate/route.ts    # 주간 브리핑 생성
│   │       │   └── [week]/route.ts      # 주간 조회
│   │       ├── market/
│   │       │   └── route.ts             # 마켓 데이터
│   │       └── cron/
│   │           ├── daily/route.ts       # 일일 크론
│   │           └── weekly/route.ts      # 주간 크론
│   ├── lib/
│   │   ├── claude.ts                # Claude API 클라이언트
│   │   ├── prompts/
│   │   │   ├── daily-digest.ts      # 일일 다이제스트 프롬프트
│   │   │   ├── weekly-digest.ts     # 주간 브리핑 프롬프트
│   │   │   └── personalized.ts      # 개인화 알림 프롬프트
│   │   ├── db.ts                    # Prisma 클라이언트
│   │   └── types.ts                 # 타입 정의
│   └── components/
│       ├── MarketDashboard.tsx       # 마켓 미니 대시보드
│       ├── TopHighlights.tsx         # TOP 3 하이라이트
│       ├── CategoryTabs.tsx          # 카테고리 탭
│       ├── NewsList.tsx              # 뉴스 리스트 뷰
│       ├── NewsCard.tsx              # 개별 뉴스 카드
│       ├── ContextMap.tsx            # 맥락 연결 맵
│       ├── DateNavigator.tsx         # 날짜 네비게이터
│       ├── WeeklyView.tsx            # 주간 뷰
│       ├── IssueTimeline.tsx         # 이슈 타임라인
│       └── UrgencyBadge.tsx          # 긴급도 뱃지
└── scripts/
    └── seed.ts                      # DB 초기 시드
```

## 핵심 데이터 구조

### 뉴스 아이템 (3줄 요약 구조)
```typescript
interface NewsItem {
  id: number;
  digestDate: string;        // "2026-04-14"
  category: Category;        // "글로벌" | "증권" | "AI" | "정부정책" | "부동산"
  newsOrder: number;         // 1~10
  title: string;
  urgency: Urgency;          // "breaking" | "watch" | "note"
  fact: string;              // 📌 무슨 일이 일어났는가
  impact: string;            // 💡 왜 중요한가
  action: string;            // 🎯 나에게 어떤 의미인가
  contextTags: string[];     // 맥락 연결 태그
  source: string;
  sourceUrl: string;
  isTop3: boolean;
  top3Rank?: number;
  relatedData?: string[];    // TOP3용 관련 수치
  contextLinks?: string[];   // TOP3용 맥락 연결
  upcomingEvents?: string[]; // TOP3용 향후 일정
}
```

### 긴급도 분류 기준
- 🔴 breaking: 오늘 당장 의사결정 필요 (카테고리당 최대 2건)
- 🟡 watch: 1~2주 내 모니터링 필요
- 🔵 note: 알아두면 좋은 배경지식

## 개발 컨벤션
- TypeScript strict 모드 사용
- Prisma ORM 사용 (PostgreSQL)
- API Route에서 에러 핸들링 필수
- 컴포넌트는 Server Component 우선, 인터랙션 필요시만 Client Component
- 환경변수: ANTHROPIC_API_KEY, DATABASE_URL

## 뉴스 수집 방식
- Claude API의 web_search tool을 사용하여 뉴스 수집
- 카테고리별로 Claude API 호출 (토큰 효율화)
- temperature: 0.3 (팩트 기반 정확성 우선)
```

---

## 📌 Phase 1: 프로젝트 초기 세팅

### 지시 1-1: 프로젝트 생성 및 의존성 설치

```
Next.js 14+ App Router 프로젝트를 생성해줘.
- TypeScript strict 모드
- Tailwind CSS
- Prisma ORM (PostgreSQL)
- @anthropic-ai/sdk 패키지

docker-compose.yml에 PostgreSQL 15 컨테이너를 포함해줘.
환경변수는 .env.example에 정리해줘:
- ANTHROPIC_API_KEY
- DATABASE_URL=postgresql://postgres:postgres@localhost:5432/news_digest
```

### 지시 1-2: DB 스키마 생성

```
Prisma 스키마를 생성해줘. 아래 테이블들이 필요해:

1. DailyDigest - 일일 다이제스트 메타
   - id (autoincrement)
   - digestDate (DateTime, unique) - 다이제스트 날짜
   - marketSnapshot (Json) - 마켓 데이터 (KOSPI, KOSDAQ, 환율, 유가, 금리, 비트코인)
   - top3Highlights (Json) - 오늘의 핵심 TOP 3
   - contextMap (Json, optional) - 맥락 연결 맵
   - personalizedAlerts (Json, optional) - 개인화 알림
   - createdAt, updatedAt

2. CategoryBriefing - 카테고리 브리핑
   - id (autoincrement)
   - digestDate (DateTime)
   - category (String) - 글로벌/증권/AI/정부정책/부동산
   - summary (String) - 카테고리 총평 2~3문장
   - digestDate + category로 unique constraint
   - DailyDigest와 relation

3. NewsItem - 개별 뉴스 (핵심 테이블)
   - id (autoincrement)
   - digestDate (DateTime)
   - category (String)
   - newsOrder (Int) - 카테고리 내 순서 1~10
   - title (String)
   - urgency (String) - breaking/watch/note
   - fact (String) - 📌 팩트
   - impact (String) - 💡 임팩트
   - action (String) - 🎯 액션
   - contextTags (String[]) - 맥락 태그 배열
   - source (String)
   - sourceUrl (String)
   - isTop3 (Boolean, default false)
   - top3Rank (Int, optional)
   - relatedData (String[], optional)
   - contextLinks (String[], optional)
   - upcomingEvents (String[], optional)
   - digestDate + category + newsOrder로 unique constraint
   - DailyDigest와 relation

4. ContextTagHistory - 맥락 태그 추적
   - id (autoincrement)
   - tagName (String, unique)
   - firstAppeared (DateTime)
   - lastAppeared (DateTime)
   - appearanceCount (Int, default 1)
   - description (String, optional)
   - investmentImplication (String, optional)
   - status (String, default "active") - active/dormant/resolved/archived
   - createdAt, updatedAt

5. WeeklyDigest - 주간 다이제스트
   - id (autoincrement)
   - weekStart (DateTime, unique)
   - weekEnd (DateTime)
   - weekLabel (String) - "2026-W16"
   - executiveSummary (String) - 주간 총괄 요약
   - categorySummaries (Json) - 카테고리별 주간 요약
   - weeklyTop5 (Json) - 주간 TOP 5
   - trendAnalysis (Json, optional)
   - marketWeekly (Json, optional) - 주간 마켓 데이터
   - contextEvolution (Json, optional) - 맥락 태그 진화
   - nextWeekWatchlist (Json, optional)
   - createdAt

6. MarketDaily - 마켓 일별 데이터
   - id (autoincrement)
   - tradeDate (DateTime, unique)
   - kospi, kospiChange (Float)
   - kosdaq, kosdaqChange (Float)
   - usdKrw, usdKrwChange (Float)
   - wti, wtiChange (Float)
   - us10y, us10yChange (Float)
   - btcUsd, btcChange (Float)
   - createdAt

인덱스도 적절히 추가해줘:
- NewsItem: digestDate DESC + category, urgency + digestDate DESC, contextTags (GIN)
- MarketDaily: tradeDate DESC
- ContextTagHistory: status + lastAppeared DESC

그리고 prisma migrate dev로 마이그레이션 실행해줘.
```

---

## 📌 Phase 2: Claude API 뉴스 수집 엔진

### 지시 2-1: Claude API 클라이언트 + 프롬프트 설정

```
src/lib/claude.ts에 Claude API 클라이언트를 만들어줘.
@anthropic-ai/sdk를 사용하고, web_search tool을 활용해서 뉴스를 수집하는 구조야.

그리고 src/lib/prompts/daily-digest.ts에 일일 다이제스트 생성 프롬프트를 만들어줘.
이 프롬프트가 시스템의 핵심이야. 아래 사항을 반드시 포함해야 해:

[시스템 프롬프트]
"당신은 시니어 뉴스 에디터 겸 투자 애널리스트입니다.
매일 아침 의사결정자를 위한 뉴스 브리핑을 작성합니다.
독자는 IT업계 시니어 개발자이면서 적극적 투자자이며, 정책과 부동산에도 관심이 많은 사람입니다.
반드시 순수 JSON으로만 응답하세요. 마크다운이나 추가 설명 없이 JSON만 출력하세요."

[유저 프롬프트 - 카테고리별로 분리 호출]
하나의 카테고리에 대해 10건의 뉴스를 웹서치로 수집하고 아래 구조로 요약:

각 뉴스는 반드시 3줄 구조:
- 📌 fact (What): 무슨 일이 일어났는가. 수치/날짜/주체 포함 객관적 사실 1문장. 기사 원문 복사 금지.
- 💡 impact (Why): 왜 중요한가. 시장/산업/사회 영향 1문장
- 🎯 action (So What): 독자에게 어떤 의미인가. 구체적 행동 지침 1문장 ("~검토", "~주시", "~대비" 등)

긴급도 분류:
- "breaking": 오늘 당장 포트폴리오/의사결정에 영향 (카테고리당 최대 2건)
- "watch": 1~2주 내 모니터링 필요
- "note": 배경지식

맥락 연결:
- 다른 카테고리 뉴스와 인과관계가 있으면 context_tags 배열에 태그명 추가
- 예: ["이란_에너지_위기", "AI_규제_파급"]

출력 JSON 스키마:
{
  "category": "글로벌",
  "summary": "카테고리 총평 2~3문장",
  "news": [
    {
      "order": 1,
      "title": "뉴스 제목",
      "urgency": "breaking",
      "fact": "...",
      "impact": "...",
      "action": "...",
      "context_tags": ["태그1"],
      "source": "매체명",
      "source_url": "URL"
    }
  ]
}

Claude API 호출 시 설정:
- model: "claude-sonnet-4-20250514"
- max_tokens: 4096
- temperature: 0.3
- tools: [{ type: "web_search_20250305", name: "web_search" }]

카테고리별로 5번 분리 호출하고 결과를 합치는 구조로 만들어줘.
각 호출의 유저 메시지에는 날짜와 카테고리를 동적으로 넣어야 해.

예시 유저 메시지:
"오늘은 2026년 4월 14일입니다.
'글로벌' 카테고리의 오늘자 주요 뉴스 10건을 웹에서 검색하여 수집하고,
위에서 지시한 JSON 형식으로 요약해주세요.
글로벌 카테고리 범위: 국제정세, 지정학, 주요국 경제, 글로벌 이벤트, 전쟁/분쟁, 무역"
```

### 지시 2-2: TOP 3 선정 + 맥락 연결 프롬프트

```
src/lib/prompts/daily-digest.ts에 추가로 2개 프롬프트를 만들어줘:

[프롬프트 2: TOP 3 선정 + 맥락 연결]
5개 카테고리 50건 뉴스가 수집된 후, 전체를 입력으로 받아서:

1. 크로스 카테고리 TOP 3 선정
   선정 기준 (가중치 순):
   - 내 자산(주식/부동산/연금)에 직접 영향 → 최우선
   - 시장 전체 방향성에 영향 → 우선
   - 1개월 내 중대 변화 예고 → 높음
   - 산업/기술 패러다임 변화 → 보통

   각 TOP 뉴스에 추가 필드:
   - related_data: 핵심 데이터 포인트 2~3개
   - context_links: 다른 카테고리 뉴스 연관
   - upcoming_events: 후속 이벤트/발표 일정

2. 맥락 연결 맵 생성
   뉴스 간 인과관계를 분석하여 context_map 생성:
   {
     "태그명": {
       "description": "원인 → 경로 → 결과 체인",
       "related_news": ["카테고리#순서", ...],
       "investment_implication": "투자 시사점"
     }
   }

출력 JSON:
{
  "top3_highlights": [...],
  "context_map": {...}
}

이것도 temperature: 0.3, 순수 JSON 응답으로 설정해줘.
```

### 지시 2-3: 마켓 데이터 수집

```
src/lib/prompts/daily-digest.ts에 마켓 데이터 수집 프롬프트도 추가해줘.

Claude API 웹서치로 아래 데이터를 수집:
- KOSPI (지수, 전일대비 등락률)
- KOSDAQ (지수, 전일대비 등락률)
- 원/달러 환율 (현재가, 전일대비)
- WTI 유가 (현재가, 전일대비 등락률)
- 미국채 10년물 금리 (현재, 전일대비)
- 비트코인 (현재가 USD, 전일대비 등락률)

출력 JSON:
{
  "date": "2026-04-14",
  "kospi": { "value": 2650.32, "change": 1.2, "direction": "up" },
  "kosdaq": { "value": 870.15, "change": -0.3, "direction": "down" },
  "usd_krw": { "value": 1385.50, "change": 5.20, "direction": "up" },
  "wti": { "value": 72.30, "change": 3.5, "direction": "up" },
  "us_10y": { "value": 4.35, "change": 0.05, "direction": "up" },
  "btc_usd": { "value": 67500, "change": -2.1, "direction": "down" }
}
```

---

## 📌 Phase 3: 일일 다이제스트 API

### 지시 3-1: 일일 다이제스트 생성 API

```
src/app/api/digest/generate/route.ts를 만들어줘. POST 엔드포인트야.

실행 흐름:
1. 마켓 데이터 수집 (Claude API 웹서치)
2. 5개 카테고리 뉴스 수집 (카테고리별 분리 호출, 병렬 실행 - Promise.allSettled)
3. TOP 3 선정 + 맥락 연결 (수집된 50건 전체 입력)
4. DB 저장:
   - DailyDigest 생성
   - MarketDaily 저장
   - CategoryBriefing 5건 저장
   - NewsItem 50건 저장 (TOP3 뉴스는 isTop3=true, top3Rank 설정)
   - ContextTagHistory upsert:
     - 새 태그: firstAppeared=today, status=active
     - 기존 태그: lastAppeared 갱신, appearanceCount++
     - 7일 미등장: status→dormant
     - 30일 미등장: status→resolved
5. 응답: 생성된 다이제스트 전체 반환

에러 핸들링:
- Claude API 호출 실패 시 해당 카테고리 재시도 (최대 2회)
- JSON 파싱 실패 시 재시도
- 부분 실패 시에도 성공한 카테고리는 저장

타임아웃: 각 카테고리 호출 60초, 전체 5분
```

### 지시 3-2: 날짜별 조회 API

```
src/app/api/digest/[date]/route.ts를 만들어줘. GET 엔드포인트야.
파라미터: date (예: 2026-04-14)

DailyDigest + CategoryBriefing + NewsItem을 JOIN해서 반환.
마켓 데이터(MarketDaily)도 함께 반환.

그리고 src/app/api/digest/range/route.ts도 만들어줘.
쿼리 파라미터: start, end (예: ?start=2026-04-08&end=2026-04-14)
기간 내 모든 다이제스트를 날짜 ASC 순으로 반환.
이건 주간 뷰에서 사용할 거야.
```

---

## 📌 Phase 4: 주간 브리핑 시스템

### 지시 4-1: 주간 브리핑 프롬프트

```
src/lib/prompts/weekly-digest.ts를 만들어줘.

주간 브리핑은 7일치 데이터를 종합 분석하는 프롬프트야.

[입력 데이터 - 토큰 최적화를 위해 경량화]
- 7일간 일일 TOP 3 (최대 21건) 전문
- 7일간 🔴 breaking 뉴스 전문
- 7일간 카테고리별 summary (35건)
- 7일간 마켓 데이터 (7건)
- 활성 맥락 태그 목록

[시스템 프롬프트]
"당신은 수석 전략 애널리스트입니다. 1주일간의 뉴스를 종합 분석하여 주간 브리핑을 작성합니다.
반드시 순수 JSON으로만 응답하세요."

[분석 항목]
1. executive_summary: 주간 총괄 5~7문장 (가장 임팩트 큰 이벤트, 마켓 방향성, 미결 이슈)

2. market_weekly: 주간 마켓 시가/종가/고저/변동률 + 총평

3. category_summaries: 카테고리별 주간 흐름 3~4문장 + 전개과정(progression) + 하이라이트 1건

4. weekly_top5: 주간 기준 재선정 TOP 5
   - 3줄 요약 + weekly_progression(날짜별 전개) + current_status(진행중/해결/확대/소강)

5. trend_analysis:
   - new_issues: 이번 주 새로 등장한 이슈
   - escalated_issues: 확대된 이슈
   - resolved_issues: 해결된 이슈
   - sector_strength: 섹터별 강약
   - cross_category_chains: 카테고리 간 연쇄 영향 체인

6. context_evolution: 맥락 태그별 주간 등장횟수, 상태변화, 다음 주 전망

7. next_week_watchlist:
   - scheduled_events: 다음 주 예정 이벤트 (날짜/이벤트/임팩트)
   - ongoing_monitors: 지속 모니터링 항목
   - investment_checklist: 투자 체크리스트

temperature: 0.3, max_tokens: 8192
```

### 지시 4-2: 주간 브리핑 생성/조회 API

```
src/app/api/weekly/generate/route.ts를 만들어줘. POST 엔드포인트야.

실행 흐름:
1. 최근 7일간 데이터 DB 조회:
   - DailyDigest (top3Highlights)
   - NewsItem (urgency=breaking인 것들)
   - CategoryBriefing (summary)
   - MarketDaily (7일)
   - ContextTagHistory (status=active)
2. 데이터 전처리 (토큰 최적화용 경량화)
3. Claude API 호출 (주간 브리핑 프롬프트)
4. WeeklyDigest 테이블 저장
5. ContextTagHistory 상태 업데이트

src/app/api/weekly/[week]/route.ts도 만들어줘. GET 엔드포인트.
파라미터: week (예: 2026-W16)
해당 주간 브리핑 + 그 주의 일일 다이제스트 목록도 함께 반환.
```

---

## 📌 Phase 5: 프론트엔드 대시보드

### 지시 5-1: 메인 레이아웃 + 날짜 네비게이터

```
프론트엔드를 만들어줘. 전체적인 디자인 컨셉은:
- 다크 테마 기반 (현재 디자인 유지)
- 정보 밀도 최대화 (리스트 뷰 기본)
- 긴급도 색상: 🔴 breaking=#EF4444, 🟡 watch=#EAB308, 🔵 note=#3B82F6

src/app/layout.tsx:
- 다크 테마 글로벌 레이아웃
- 상단 헤더: "📰 뉴스 다이제스트" + 날짜 + 뷰 전환 버튼

src/components/DateNavigator.tsx:
- 날짜별 네비게이션 (◀ 이전일 [날짜 목록] 다음일 ▶)
- 주간 범위 표시 (월~일)
- 뷰 전환 탭: [📋 일일 뷰] [📊 주간 뷰]
- 날짜 클릭 시 해당 날짜 다이제스트 로드
- 해당 날짜에 데이터가 있는 날만 활성화 (없는 날은 비활성)
```

### 지시 5-2: 일일 뷰 페이지

```
src/app/page.tsx (메인 일일 뷰)를 만들어줘. 위에서 아래로 아래 구조:

1. MarketDashboard 컴포넌트:
   - 가로 1줄에 6개 지표: KOSPI, KOSDAQ, USD/KRW, WTI, US10Y, BTC
   - 각 지표: 이름 + 현재값 + 등락률 (상승=초록, 하락=빨강)
   - 컴팩트하게 (높이 최소화)

2. TopHighlights 컴포넌트:
   - "🔥 오늘의 핵심 TOP 3" 제목
   - 3장의 하이라이트 카드 (가로 배열, 모바일은 세로)
   - 각 카드: 긴급도 뱃지 + 카테고리 태그 + 제목 + 3줄 요약
   - TOP 1은 확장형 (관련수치, 맥락연결, 향후일정 표시)
   - TOP 2, 3은 축소형 (클릭 시 확장)

3. CategoryTabs 컴포넌트:
   - 5개 카테고리 탭: [🌍 글로벌] [📈 증권] [🤖 AI] [🏛️ 정책] [🏠 부동산]
   - 각 탭에 해당 카테고리 뉴스 건수 뱃지
   - 탭 전환 시 아래 뉴스 리스트 변경

4. 카테고리 콘텐츠 영역:
   - 상단: 카테고리 브리핑 요약 (summary 2~3문장, 약간 하이라이트 배경)
   - 하단: NewsList 컴포넌트

5. NewsList 컴포넌트 (리스트 뷰 - 기본):
   - 정보밀도 최대화. 썸네일 없음.
   - 각 행: [긴급도뱃지] [제목] 아래에 3줄 요약
   - 📌 fact는 일반 텍스트
   - 💡 impact는 약간 밝은 색
   - 🎯 action은 강조색 (액션 유도)
   - 맥락 태그가 있으면 작은 태그 칩으로 표시
   - 한 화면에 최소 5~6건은 보여야 함

6. ContextMap 컴포넌트 (하단):
   - 현재 활성 맥락 태그 목록
   - 각 태그: 이름 + 설명 + 관련 뉴스 링크 + 투자 시사점
   - 태그 클릭 시 관련 뉴스만 필터링
```

### 지시 5-3: 주간 뷰 페이지

```
src/app/weekly/page.tsx를 만들어줘.

1. 주간 마켓 미니 차트:
   - 7일간 KOSPI/KOSDAQ/환율/유가 추이를 간단한 sparkline으로
   - 시가 → 종가 + 주간 변동률 표시
   - recharts 라이브러리 사용

2. Executive Summary:
   - 주간 총괄 요약 5~7문장
   - 눈에 띄는 카드 형태로 표시

3. 주간 핵심 TOP 5:
   - 각 뉴스: 3줄 요약 + 날짜별 전개 과정(progression) + 현재 상태 뱃지
   - 전개 과정은 타임라인 형태:
     "화 첫보도 → 목 협상결렬 → 금 봉쇄시행"
   - 상태: [진행중] [해결] [확대] [소강] 뱃지

4. 카테고리별 주간 요약 (탭):
   - 주간 흐름 + 전개 과정 + 하이라이트 1건
   - 하이라이트 뉴스 클릭 시 IssueTimeline 컴포넌트 펼침

5. IssueTimeline 컴포넌트:
   - 특정 이슈의 날짜별 뉴스 타임라인
   - 세로 타임라인: 날짜 + 긴급도 + 제목 + fact 1줄
   - 이슈의 시작부터 현재까지 전개 과정을 한눈에 파악

6. 이슈 진화 맵:
   - context_evolution 데이터 기반
   - 각 맥락 태그: 상태 뱃지(신규/지속/확대/소강/해결) + 등장 횟수 + 다음 주 전망

7. 다음 주 관전 포인트:
   - 예정 이벤트 리스트 (날짜/이벤트/임팩트)
   - 투자 체크리스트 (체크박스 형태)
```

---

## 📌 Phase 6: 자동화 (크론 잡)

### 지시 6-1: 크론 엔드포인트

```
src/app/api/cron/daily/route.ts를 만들어줘.
- 매일 오전 7시에 호출되는 엔드포인트
- GET 요청으로 일일 다이제스트 생성 트리거
- Vercel Cron 또는 외부 스케줄러(n8n, GitHub Actions)에서 호출
- Authorization 헤더로 CRON_SECRET 검증

src/app/api/cron/weekly/route.ts도 만들어줘.
- 매주 일요일 오후 8시에 호출
- 주간 브리핑 생성 트리거
- 동일한 인증 방식

실행 후 Slack 웹훅으로 알림 전송:
- 일일: "🔥 오늘의 핵심 3선" + 마켓 스냅샷 요약
- 주간: "📊 주간 브리핑" + Executive Summary + TOP 5 제목
- 환경변수: SLACK_WEBHOOK_URL
```

### 지시 6-2: 데이터 정리 배치

```
src/app/api/cron/cleanup/route.ts를 만들어줘.
매주 일요일 자정에 실행:

1. 90일 경과한 NewsItem 삭제 (또는 별도 아카이브 테이블 이동)
2. ContextTagHistory에서:
   - 60일 이상 미등장(lastAppeared 기준) → status를 "archived"로 변경
3. 정리 결과 로그 출력
```

---

## 📌 Phase 7: Docker + 배포

### 지시 7-1: Docker 설정

```
Dockerfile과 docker-compose.yml을 만들어줘.

docker-compose.yml:
- postgres: PostgreSQL 15, 볼륨 마운트
- app: Next.js 앱, 환경변수 주입
- 네트워크 설정

Dockerfile:
- Node.js 20 alpine
- multi-stage build (builder → runner)
- prisma generate 포함
- standalone output 모드

.env.example에 모든 환경변수 정리:
- ANTHROPIC_API_KEY
- DATABASE_URL
- CRON_SECRET
- SLACK_WEBHOOK_URL
- NEXT_PUBLIC_BASE_URL
```

---

## 🔄 일상 운영 명령어

### 수동 다이제스트 생성 (테스트용)

```
curl -X POST http://localhost:3000/api/digest/generate \
  -H "Content-Type: application/json"
```

### 수동 주간 브리핑 생성

```
curl -X POST http://localhost:3000/api/weekly/generate \
  -H "Content-Type: application/json"
```

### 특정 날짜 다이제스트 조회

```
curl http://localhost:3000/api/digest/2026-04-14
```

### 기간별 조회 (주간 뷰용)

```
curl "http://localhost:3000/api/digest/range?start=2026-04-08&end=2026-04-14"
```

---

## ⚠️ Claude Code 지시 시 주의사항

1. **Phase 순서를 지켜서 진행하세요.**
   Phase 1(세팅) → Phase 2(엔진) → Phase 3(API) → Phase 4(주간) → Phase 5(프론트) → Phase 6(크론) → Phase 7(배포)

2. **각 Phase 완료 후 테스트를 먼저 하세요.**
   다음 Phase로 넘어가기 전에 현재 Phase가 정상 동작하는지 확인.

3. **프롬프트 튜닝은 별도로 하세요.**
   Phase 2에서 만든 프롬프트를 실제 실행해보고, 출력 품질이 부족하면 프롬프트를 수정하세요.
   특히 "기사 원문 복사" 문제가 자주 발생하므로, 프롬프트에 "절대로 기사 원문을 그대로 복사하지 마세요"를 반복 강조하세요.

4. **토큰 비용 모니터링**
   - 일일: 5카테고리 × ~4K 토큰 + TOP3 ~4K + 마켓 ~2K ≈ 약 26K input 토큰
   - 주간: ~15K input 토큰
   - Sonnet 기준 일일 약 $0.08~0.12, 월간 약 $2.5~3.5 수준

5. **Claude Code에서 각 Phase를 시작할 때**
   해당 Phase의 지시 명령어 블록을 그대로 복사해서 Claude Code에 붙여넣으세요.
   필요하면 여러 지시를 한번에 주지 말고 하나씩 진행하세요.
