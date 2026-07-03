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

## MLX / Ollama 관련
- MLX는 영구 폐기됨 (board 결정). MLX 코드 경로 발견 시 삭제할 것.
- Ollama도 영구 폐기됨. Ollama 코드 경로 발견 시 삭제할 것.
- 모든 로컬 추론은 LM Studio at localhost:1234 (supergemma4-26b-uncensored-mlx-v2) 전용.
- `.env.local`은 read-only (444). 에이전트가 수정 금지.
