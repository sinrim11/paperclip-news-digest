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
- 결정적 수집기(`src/lib/collectors/`)로 RSS·HackerNews·Reddit·arXiv·HF Daily Papers·GitHub Trending·뉴스레터 수집
- dedup + 3-신호 클러스터링 후 카테고리별로 로컬 LLM 호출 (json_schema 구조화 출력)
- temperature: 0.3 (팩트 기반 정확성 우선)
- 원칙: LLM은 수집된 기사만 요약한다. 기사에 없는 뉴스 생성(학습 데이터 보충) 절대 금지.

### 피드는 조용히 죽는다 — 2026-09-14 전수 점검 결과

당시(9/14) RSS 26개 중 **10개가 죽어 있었고**(교체 후 현재 수는 `config/news_sources.json`에서 셀 것 — 이 26을 현재값으로 옮기지 말 것) 1개는 파서가 못 읽었다. 부동산은 5개 중 3개가 죽어 있었다.
근본 원인은 `fetchFeed`의 `if (!res.ok) return []` — HTTP 403/404가 로그 한 줄 없이 빈 배열이
됐다. 다른 소스가 기사를 채우니 총량이 줄지 않아 몇 달을 갔다. 같은 성격의 조용한 실패가
`collectPwC`(PapersWithCode가 HF로 흡수돼 JSON 자리에 HTML이 왔고 `res.json()` 예외를 catch가 삼킴)
에도 있었다. 확정된 규칙:

- **소스를 추가·교체할 때는 실제 파서로 건수를 확인한다.** HTTP 200은 근거가 아니다 —
  이데일리·KBS·MBC는 200을 주면서 0건이었고, The Verge는 Atom(`<entry>`)으로 바꿔 0건이었다.
- **수집기는 실패를 반드시 로그로 남긴다.** `DEAD`(HTTP 오류·예외) / `EMPTY`(200인데 0건).
  조용한 0건이 가장 오래 산다. morning-review 4번 항목이 이 로그를 센다.
- **mock은 실제 엔드포인트가 주는 형태여야 한다.** pwc 테스트는 옛 `{results:[…]}`를 흉내 내
  통과하면서 프로덕션이 매일 0건인 걸 잡지 못했다. 계약이 아니라 자기 확인이었다.
- **파서는 RSS·Atom 양쪽을 읽는다**(`parseRssItems`). 매체가 형식을 바꾸는 건 흔한 일이다.
- 전수 점검은 `config/news_sources.json`을 돌며 `<item>`/`<entry>` 수를 세면 된다(수동, 수십 초).
- 구글뉴스 검색 피드(`news.google.com/rss/search?q=…`)는 죽지 않지만 링크가 리다이렉트라
  원문 URL이 안 남는다. 2026-09-15 사용자 승인으로 **Reuters·AP 자리에만 도입**했다(둘 다 공식
  RSS가 폐지·차단돼 무료 경로가 없다). 제약은 그대로이므로 `<source url="…">`에서 원 매체명을
  뽑아 출처로 쓰고(안 그러면 전부 "Google News"가 된다), 제목 끝 " - 매체명"은 그 값과 정확히
  일치할 때만 뗀다. 살아 있는 전용 소스가 있는 카테고리(부동산 등)에는 넣지 않는다 —
  같은 기사가 다른 URL로 들어와 dedup을 시험하게 된다.

AI는 1차 출처(자사 발표)를 언론과 분리해 `AI_BLOG_SOURCES`로 둔다 — 언론 RSS는 받아쓰기라
한 단계 늦고, 안 다루면 아예 놓친다. Anthropic·Meta는 RSS 미제공, xAI는 403 차단이라
무료 경로가 없다(발표가 X 게시물이고 X API는 유료).

**동시 호출에 민감한 곳**: Reddit 비인증 `.rss`는 짧은 창에 IP당 1회만 통과한다 — 순차 1.5초 간격으로도
둘째 서브레딧이 23일 연속 429였다. 2026-10-08부터 `fetchRedditAll`은 멀티레딧(`/r/A+B/.rss`) **1회 요청**이다.
arXiv도 같은 성격이라 3초 뒤 1회 재시도한다. 점검하겠다고 반복 프로브하면 IP가 몇십 분 차단되니
(2026-09-14에 실제로 그랬다) 하루 1회 실행 로그로 확인할 것.
**arXiv 쿼리는 공백으로**: `cat:a+OR+cat:b`를 encodeURIComponent하면 `+`가 %2B가 되어 totalResults=0이다
(HTTP 200이라 9/16~10/08 23일간 EMPTY로만 보였다).

**카테고리에 소스를 더할 땐 뒤에 append하지 말 것.** 클러스터 상한(limit)에서 통째로 잘린다 —
investing 8건을 STOCKS 뒤에 붙였더니 상위 20개 안에 하나도 못 들어갔다. `interleaveInto`로 섞는다.

### investing.com — 남의 캐시를 읽는다 (2026-09-14)

`~/TradingAgents-ClaudeCLI`가 매일 17:00에 `~/.tradingagents/investing-cache/`에 남기는 결과를
읽기만 한다(`collectors/investing.ts`). **직접 긁지 않는 이유**: investing.com은 Cloudflare
Turnstile이 헤드리스·자동 로그인을 막아 실제 Chrome(remote-debugging 9222) + 사람이 1회 로그인한
세션이 필요하다. 그 의존성을 news-digest가 지면 launchd 무인 실행에서 깨진다.

- 채택: `market-news.json`(시장 헤드라인 8건 → 증권). 본문은 없고 제목·시각·링크만이라
  content에 "본문 미수집"을 명시한다 — LLM이 살을 붙이지 않게.
- 채택: `economic-calendar.json` → 홈 위젯 + 텔레그램 브리핑 (2026-09-15, 아래).
- 미채택: `fed-monitor.json`(FOMC 금리 확률 — 노출 위치는 policy-params 동결 체계와 얽혀 사용자 결정 필요).
- 신선도는 남의 잡과 남의 로그인 세션에 달려 있다. `collected_at` 26h 초과 시 경고, 50h 초과 시
  DEAD(세션 만료 추정 — CDP Chrome에서 수동 재로그인 필요).

**경제 캘린더 수리(2026-09-15, TradingAgents 쪽)**: `econ_calendar.py`가 표를 6열로 가정했는데
실제는 `시간|외화|이벤트|중요성|실제|예측|이전` **7열**이라 값이 한 칸씩 밀려 있었다. 결과로
(1) 발표된 '실제'값이 '예상'으로 들어가고 (2) actual 자리에 텍스트 없는 중요성 칸이 잡혀 늘
빈값 → `upcoming_only` 필터가 무력화돼 이미 발표된 지표까지 '발표 예정'으로 올라왔다.
열 위치를 헤더에서 읽도록 고치고(`_header_index`), 7열 실측 fixture로 회귀 테스트를 추가했다
(기존 테스트는 6열 fixture라 내내 통과했다 — pwc mock과 같은 함정).
캐시에 `parsed_rows`를 추가해 **파싱 실패(parsed_rows=0)와 이벤트 없음(parsed_rows>0, count=0)**을
구분한다 — 주말엔 US/KR 발표가 없어 0건이 정상이다.

**연동(2026-09-15, 사용자 승인)** — `src/lib/econ-calendar.ts` → 홈 위젯 `EconCalendar` + 텔레그램 브리핑.

- **아침 재수집이 필수다.** 캘린더는 '오늘 발표 예정'이라 TradingAgents의 17:00 수집분은 다음날
  아침이면 이미 지난 일정이다. `run-daily-digest.sh`(06:30) 서두에서 `investing_pro.py --econ`을
  호출한다 — 실측 6초, 워치독 90초 상한, 실패해도 다이제스트는 진행(`|| true`).
  CDP Chrome이 꺼져 있으면 `ensure_chrome()`이 창을 띄운다(무인 시간대라 용인, 사용자 동의함).
- **날짜가 오늘이 아니면 표시하지 않는다.** 시간 기반 신선도보다 강한 조건 — 재수집이 실패한 날
  전날 일정을 '오늘 예정'으로 내보내는 것이 이 연동의 유일한 거짓말 경로다. 캐시 없음·날짜 불일치·
  parsed_rows=0·0건 네 경우 모두 위젯 자체를 렌더하지 않는다(4종 전부 실측 확인).
- **수집 파이프라인에 넣지 않았다.** 캘린더는 기사가 아니라 일정이라 `collectByCategory`에 넣으면
  LLM 요약 대상이 되고 일정이 뉴스 문장으로 각색될 여지가 생긴다. MarketDaily와 같은 결정론 렌더.
- 텔레그램은 `parse_mode` 미지정이라 **plain text**다(HTML 태그를 쓰면 그대로 보인다).

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
- ⚡ **코드를 고쳤으면 `./scripts/deploy.sh`** — 타입검사 → 빌드 → 웹서버 재기동 → 확인을 한 번에 한다.
  이 규칙은 원래 아래 문장으로 적혀 있었는데도 이틀 연속 반쪽만 실행됐다(9/13 빌드 누락, 9/15 재기동
  누락 → 수집기 수정분이 하루치 통째로 미반영). 다단계 절차를 기억에 맡기면 한쪽이 빠진다.
  **빌드만으로는 반영되지 않는다**: Next 프로덕션 서버는 기동 시점 빌드를 메모리에 물고 있다.
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
