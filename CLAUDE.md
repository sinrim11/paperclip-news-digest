# 뉴스 다이제스트 시스템 (News Digest System)

## 프로젝트 개요
- 매일 5개 카테고리(글로벌, 증권, AI, 정부정책, 부동산)에서 최대 10건씩 뉴스를 수집
- RSS·HN·arXiv·GitHub 등 결정적 수집기로 뉴스를 모으고, 로컬 LLM이 구조화된 3줄 요약(팩트/임팩트/액션)으로 변환
- 수집 기사가 부족하면 있는 만큼만 출력 — LLM이 뉴스를 지어내는 보충 생성은 금지됨
- 일일 브리핑 + 주간 브리핑을 생성하여 프론트엔드 대시보드(:3200)와 Telegram으로 제공

## 기술 스택
- Backend: Next.js API Routes (App Router)
- Frontend: React + Next.js 14+ (App Router, Server Components)
- Database: PostgreSQL (뉴스 저장, 주간 분석)
- AI: 로컬 LM Studio (`qwen3.6-35b-a3b-mlx`, OpenAI 호환 API + Bearer 토큰 인증) — `src/lib/llm.ts`가 유일한 live 클라이언트. `src/lib/claude.ts`(Anthropic SDK)는 주간 딥다이브용 예비로만 보존(현재 미사용)
- Styling: Tailwind CSS
- 배포: 맥미니 로컬 (launchd 상주 + 네이티브 PostgreSQL 16 @5432) — Docker/K8s 미사용

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
- 환경변수: DATABASE_URL, LLM_API_KEY(LM Studio 토큰), LLM_MODEL, TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID, CRON_SECRET — 비밀값은 `.env`(gitignored)에만

## 뉴스 수집 방식
- 결정적 수집기(`src/lib/collectors/`)로 RSS·HackerNews·Reddit·arXiv·PapersWithCode·GitHub Trending·뉴스레터 수집
- dedup + 3-신호 클러스터링 후 카테고리별로 로컬 LLM 호출 (json_schema 구조화 출력)
- temperature: 0.3 (팩트 기반 정확성 우선)
- 원칙: LLM은 수집된 기사만 요약한다. 기사에 없는 뉴스 생성(학습 데이터 보충) 절대 금지.

## MLX / Ollama 관련
- MLX는 영구 폐기됨 (board 결정). MLX 코드 경로 발견 시 삭제할 것.
- Ollama도 영구 폐기됨. Ollama 코드 경로 발견 시 삭제할 것.
- 모든 로컬 추론은 LM Studio at localhost:1234 전용. 서버에 토큰 인증이 켜져 있으므로 `LLM_API_KEY` 필수.
- 로드 모델: `qwen3.6-35b-a3b-mlx` (구 supergemma4-26b는 디스크에서 제거됨 — 참조 발견 시 갱신할 것)
- `.env.local`은 read-only (444). 에이전트가 수정 금지. (모델명·신규 키는 `.env`에서 관리)

## 운영
- 웹: launchd `com.news-digest.web` → `next start -p 3200` (3000/3100은 타 프로젝트 점유)
- 데일리: launchd `com.news-digest.daily` → 매일 06:30 `scripts/run-daily-digest.sh`
- 매물 스윕: launchd `com.news-digest.naver-sweep` → **21:00(전날 저녁)**.
  03:00 → 01:00(9/1) → 21:00(9/2)로 두 번 옮겼다. 실측 소요시간이 gangnam1h 1,014단지
  6h12m · wed 1,584단지 **10h04m**이라 새벽 시작으로는 recommend 08:30을 맞출 수 없다.
  21:00 시작이면 wed도 07:00경 끝난다. 반영일은 하루 밀리지만 주 2회 주기는 그대로.
  08:15~20:00 사이에 끝나면 창을 놓친 것이므로 스크립트가 텔레그램에 스스로 알린다.
- 아침 점검: launchd `com.news-digest.morning-review` → 매일 09:17 `scripts/morning-review.sh`
  사이클 마지막 작업(cardnews 09:00) 직후에 전 단계를 점검해 텔레그램으로 보고한다.
  `claude -p`를 쓰므로 **`.env`의 `CLAUDE_CODE_OAUTH_TOKEN`이 필수** — launchd 프로세스는
  대화형 세션의 OAuth를 물려받지 못해 없으면 "session expired"로 즉사한다.
  권한은 Bash·Read·Grep·Glob만. 무인 실행에서 코드 수정·배포는 하지 않고 제안만 보고한다.
- 외부 API 캐시: `config/kapt-cache.json`(관리비·주차·지하철) · `config/public-price-cache.json`
  (공시가격). 스윕 꼬리에서 증분 수집하며 gitignore 대상이다. 재생성은 `scripts/collect-kapt.ts`·
  `scripts/collect-public-price.ts`.
  · K-apt kaptCode는 **시군구 단위**로 받는다(법정동 단위는 읍·면이 0건).
  · 이름 매칭 후 **세대수 15% 대조**로 오매칭을 거른다.
  · 이 API들은 금액을 문자열로 준다 — 숫자 변환 필수.
  · vworld(공시가격)는 **Referer 헤더 필수**, 조회 단위는 PNU(법정동코드10+1+본번4+부번4).
    지번은 K-apt 주소에서 뽑는 게 가장 정확하다.
- **프롬프트 수정도 빌드가 필요하다**(2026-09-13 교훈). `src/lib/prompts/*.ts`는 API route를
  통해 실행되므로 `npm run build` + 웹서버 재기동을 해야 반영된다. TSC만 통과시키고 두면
  다음날 파이프라인이 **옛 프롬프트로 돈다** — 뉴스 긴급도 수정이 그렇게 하루 헛돌았다.
- 로그: 스크립트는 `>> $LOG` 로 직접 쓴다. **`| tee -a $LOG` 금지** — plist의
  StandardOutPath가 같은 파일이라 전 라인이 2회 기록된다(2026-09-01 sweep·matching·cardnews에서 제거).
- 정책 파라미터 — **1차 출처 원칙**(2026-09-01 사용자 지침):
  · 자동 반영은 정부 원문 근거만 허용. `apply-policy-patches.mjs`의 `PRIMARY_HOSTS`
    (fsc·molit·korea·nhuf·fss·bok .go.kr/.or.kr) 밖 URL은 검증기가 거부한다.
    언론기사·은행 설명페이지는 단서로만 쓰고 근거로 삼지 않는다.
  · `_frozenPaths` 등록 키는 자동 갱신에서 제외(스킵). 거부·스킵도 반드시 텔레그램에 알린다
    — 레이더가 무언가를 바꾸려 했다는 사실 자체가 신호다.
  · 값이 바뀌거나 변경 제안이 오면 아침 점검이 WebSearch/WebFetch로 **원문을 직접 열어**
    인용문과 URL을 보고한다. 무인 실행에서 값을 고치지는 않는다.
  · 배경: 2026-08~09에 두 DSR 키가 5회 진동했는데 이력에 근거 URL이 없어 사후 판별이
    불가능했다. 원문 확인 결과 수도권 3.0%가 맞았고 근거는 `_frozenSource`에 있다.
- 검증: `scripts/verify-e2e.sh` (LM Studio 인증→DB→웹→생성→알림 전 구간)
- Gen1 Python 파이프라인은 `_legacy/`에 아카이브됨 — 수정·실행 비대상
