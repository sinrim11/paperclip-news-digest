# 뉴스 다이제스트 프로젝트 종합 분석 및 고도화 제안

작성일: 2026-07-03 · 분석 대상: `/Users/sklee01/news-digest` (main, 마지막 커밋 2026-04-18)

## TL;DR

- 프로젝트는 "죽은" 것이 아니라 **운영만 멈춘 상태**다. TypeScript 코어는 건강하다 (vitest 102개 전부 통과, 362ms).
- 부활을 막는 blocker는 3개뿐: ① LM Studio에 API 토큰 인증이 켜졌는데 `llm.ts`가 Authorization 헤더를 안 보냄(401) ② 코드/환경변수가 참조하는 모델 `supergemma4-26b-uncensored-mlx-v2`가 디스크에 없음(현재 로드: `qwen3.6-35b-a3b-mlx`) ③ 스케줄러(LaunchAgent)가 제거됨.
- 로컬 모델 전환은 이미 80% 완성돼 있다. 결정적 파이프라인(수집→중복제거→클러스터링→랭킹)과 LLM 스텝이 잘 분리된 설계라, "프롬프트 한 방"이 아닌 하네스 방식으로 갈 토대가 이미 있다.
- 권장 전략: **데일리는 100% 로컬(Qwen 3.6, 비용 0) + 주간 브리핑/딥다이브만 Claude API**(이미 구현된 `claude.ts` 재활성) 하이브리드.
- 긴급: **Telegram 봇 토큰이 소스에 하드코딩되어 git에 커밋됨** — 토큰 회전 필요. 미커밋 2,572줄도 유실 위험.

---

## 1. 맥미니 서버 현재 사용 현황

이 분석을 실행한 머신이 바로 그 맥미니다: **Mac mini M4 Pro, RAM 64GB, macOS 26.4.1** (hostname `sklee01ui-Macmini.local`). 사실상 멀티 프로젝트 홈서버로 운영 중이며 부하가 상당하다 (load average ~6.5).

### 상주 중인 서비스

| 분류 | 내용 |
|---|---|
| Docker | kfestival 스택(frontend :3000, backend :8080, render-worker :3100, postgres :55432, rabbitmq, redis, minio), tradingagents 스택(web :8765, postgres :5433, redis :6380) |
| launchd | LM Studio headless(`ai.lmstudio.headless`), tradingagents telegram-bot/frontend(:3001), cardnews harness, hermes gateway, dartlab 3종(**status 78 — 실행 실패 반복 중**), homebrew postgresql@16(:5432), redis |
| 네트워크 | Tailscale, Cloudflare tunnel(`makeagent-tunnel`) — 외부 접근 경로 존재 |

### LM Studio 상태 (news-digest에 중요)

- 로드된 모델: **`qwen3.6-35b-a3b-mlx`** (35B MoE, 20.43GB, 컨텍스트 262,144, parallel 4) — 확인 시점에 다른 프로젝트 요청을 처리(GENERATING) 중이었음. 임베딩 모델 `text-embedding-nomic-embed-text-v1.5`도 있음.
- `*:1234`로 전체 인터페이스에 바인딩되어 있고, **API 토큰 인증(Bearer)이 활성화**되어 있다. 토큰 없는 요청은 401 → 현재 news-digest 코드는 전부 실패한다.
- 코드·env가 참조하는 `supergemma4-26b-uncensored-mlx-v2`는 더 이상 디스크에 없다.

### news-digest 관련은 전부 정지 상태

- LaunchAgent 없음(주석에 언급된 `com.news-digest.nextjs` 등은 제거됨), crontab 비어 있음.
- `news-digest-postgres` 컨테이너: 5주 전 Exited(255). 포트 5432를 네이티브 postgresql@16이 차지해 재기동도 불가.
- **4월 운영 데이터(4/13~4/25 다이제스트)는 죽은 컨테이너의 볼륨 `news-digest_postgres_data`에 고립돼 있으나 볼륨은 살아있음 → 복구 가능.**
- 네이티브 PG의 `news_digest` DB에는 5/15·5/16 다이제스트 2건이 있는데 **NewsItem 0건**(빈 껍데기, 마지막 재기동 시도 흔적).

---

## 2. 프로젝트 전체 분석

### 2.1 3세대 구조

한 저장소에 세 세대가 공존한다.

**Gen 1 — Python 파이프라인 (4/12~, "예전 프롬프트 시절")**
`main.py`: collector(RSS 25+개, feedparser + trafilatura/newspaper3k 본문 추출) → summarizer(Ollama→LM Studio로 요약/번역) → generator(markdown) 순차 실행. `run_daily.sh`가 07:00에 돌리고 FastAPI(`web_app`, :3201)가 렌더링. 산출물은 `output/raw_YYYYMMDD.json` + `daily_digest_YYYYMMDD.md`. **마지막 실행 4/25** (로그는 4/29까지).

**Gen 2 — Next.js 시스템 (4/13~4/18, 6일간 60+ 커밋)**
Next.js 16 + Prisma/PostgreSQL + Tailwind 풀스택. 수집→클러스터→LLM 큐레이션→TOP3→위키 동기화까지 API Route로 오케스트레이션. CMP-* 티켓 단위로 고속 개발됨.

**Gen 2.5 — 미커밋 작업 (4/18~5/16)**
v4 로드맵(Persona, ABEvaluation, PersonaRankResult, Article 모델 / deterministic ranker / divergence gate / persona-reranker / A/B API·UI / rerank cron / wiki 3-way split / EntityStat)이 **워킹트리에만 존재: 총 84개 변경 항목 = 33개 파일 수정(+2,572/-1,462) + 신규 파일 51개**. 커밋되지 않아 유실 위험이 크다.

### 2.2 현재 코드 기준 파이프라인 아키텍처

```
[수집] config/news_sources.json RSS(글로벌/증권/AI/정치/부동산 소스 분리)
       + HackerNews + Reddit(r/ML, r/LocalLLaMA) + arXiv(cs.AI/CL/LG, 48h)
       + Papers with Code + GitHub Trending + AI 기업 블로그 + 뉴스레터
  ↓
[중복제거] dedup.ts — URL 정규화 + 문자 bigram Jaccard(0.80), 7일 롤링 중복률 지표
  ↓
[클러스터링] news-collector.ts — 3-신호 합성 유사도
             (titleJaccard×0.40 + entityOverlap×0.35 + bigramSim×0.25 ≥ 0.15)
             다중 소스 합의(consensusFacts)/충돌(conflictingFacts) 추출
  ↓
[LLM 큐레이션] llm.ts(LM Studio) — 카테고리별 10건, 3줄 요약(팩트/임팩트/액션),
               긴급도(breaking/watch/note), contextTags → 재시도 3회
  ↓
[TOP3 선정] 2차 LLM 패스 → [마켓] Yahoo Finance 실시간(market-fetcher.ts)
  ↓
[저장] Prisma → PostgreSQL (DailyDigest/CategoryBriefing/NewsItem/MarketDaily…)
  ↓
[후처리] wiki 원장/내러티브(wiki-db.ts), EntityStat 집계, Slack 알림
  ↓
[프론트] 대시보드(page.tsx), 주간뷰, 컨텍스트맵, 검색, A/B 평가 UI
```

LLM이 필요 없는 단계(수집·정규화·중복제거·랭킹·시세)는 전부 결정적 코드로, LLM은 요약·큐레이션에만 쓰는 분리가 잘 되어 있다. **이 뼈대는 그대로 살릴 가치가 있다.**

### 2.3 당시 운영 체계 (에이전트 오케스트레이션의 원형)

- 로컬 이슈 트래커 **Paperclip**(127.0.0.1:3100)의 CMP-* 이슈로 에이전트에게 작업 위임
- Telegram(@paperclip_news_bot)이 CEO 채널: `notify.py`(이슈 상태 전이 알림), `ceo_forward.py`(CMP-78 코멘트→Telegram 포워딩), `telegram_bot.py`(질의/위임)
- `scripts/watchdog-next.sh`(60초 헬스체크→자동 재시작), `monitor.py`(LM Studio 프로브)
- 현재는 전부 정지. :3100은 kfestival-render-worker가, :3000은 kfestival-frontend가 점유 중 → news-digest 웹은 :3200 유지가 맞다(.env.local도 3200).

### 2.4 왜 멈췄나 — LLM 백엔드 잔혹사

커밋 이력이 말해준다: Ollama gemma4:26b → (CMP-104) Anthropic claude.ts + web_search → (CMP-102) API 키 부재로 다시 Ollama → JSON 파싱/타임아웃/크래시와의 전쟁(수십 커밋) → 4/18 LM Studio로 최종 전환 + Ollama 금지 4중 가드(`llm.ts` 가드, `check-env.ts` predev 훅, `check_env_config.sh`, CLAUDE.md 지침, `.env.local` 444 잠금). 이후 4/25까지 데일리 운영 → 5/15~16 재기동 시도(빈 다이제스트 2건) → 정지.

**교훈**: 26B급 dense 모델의 느린 응답 + JSON 비준수 + 백엔드 스위칭 혼란이 운영 피로의 근원이었다. 지금은 조건이 다르다 — Qwen 3.6 35B-A3B는 MoE(활성 ~3B)라 훨씬 빠르고 JSON 준수율이 높으며, LM Studio가 structured output을 지원한다.

### 2.5 발견된 문제 (심각도순)

1. **[보안] Telegram 봇 토큰+챗ID 하드코딩** — `run_daily.sh`, `notify.py`, `telegram_bot.py`, `ceo_forward.py`에 평문으로 존재하며 git 이력에 커밋됨. **토큰 즉시 회전(BotFather /revoke) 후 env로 이동** 필요. LM Studio도 `*:1234` 전체 바인딩 + Cloudflare tunnel이 있는 환경이므로 토큰 인증이 켜진 건 오히려 잘된 일.
2. **[blocker] LM Studio 401** — `llm.ts`/`run-pipeline.ts`가 Authorization 헤더 미지원.
3. **[blocker] 모델명 부패** — 기본값·.env.local·run_daily.sh가 없는 모델(supergemma4)을 가리킴. `llm.ts`의 "첫 로드된 모델" 폴백으로 우연히 동작하는 구조.
4. **[유실 위험] 미커밋 +2,572줄, 총 84개 변경 항목(수정 33 + 신규 51)** — v4 기능 전체가 워킹트리에만 존재.
5. **[데이터] 4월 데이터 고립** — `news-digest_postgres_data` 볼륨에서 pg_dump로 구출 가능. 네이티브 PG(5432)와 컨테이너 PG의 이중화가 혼란의 근원이므로 네이티브로 일원화 권장.
6. **[품질/신뢰성] 환각 유도 설계** — `digest/generate`의 supplement 패스가 "기사가 10건 미만이면 **학습 데이터에서 뉴스를 생성**하라"고 지시(sourceUrl은 example.com). 뉴스 브리핑에서 가짜 뉴스를 만들어 채우는 것 — 반드시 제거하고 '수집량 부족 시 있는 만큼만 + 부족 알림'으로 바꿔야 함. `run-pipeline.ts`의 LLM 추정 시세도 같은 문제(라이브 Yahoo로 대체된 route.ts와 drift).
7. **[일관성] Ollama/MLX 잔재** — `summarizer.py`(11434 + `ollama serve` 재시작 로직), `wait-and-inject.sh`, README, DEPLOYMENT.md가 CLAUDE.md의 "폐기" 방침과 충돌. CLAUDE.md 자체도 낡음(supergemma 모델명, 실존하지 않는 k8s 배포 언급).
8. **[운영] dev 서버 + watchdog 조합** — `next dev`를 상시 운영하고 죽으면 재시작하는 구조였음. `next build` + `next start`(또는 standalone)로 전환해야 함.

---

## 3. 로컬 모델 효율적 활용 — 종합 분석

### 3.1 하드웨어 적합성

M4 Pro 64GB에서 `qwen3.6-35b-a3b-mlx`(20.4GB)는 여유 있게 상주 가능하고, MoE 특성상 뉴스 요약 같은 배치 작업에 충분히 빠르다. 262K 컨텍스트는 카테고리별 기사 전문을 통째로 넣는 설계를 가능케 한다. 단, 이 서버의 LM Studio는 tradingagents 등 다른 프로젝트와 공유되므로 뉴스 파이프라인은 기존처럼 **이른 아침(06:30~07:00) 배치**로 돌려 경합을 피하는 게 맞다 (`run_daily.sh`의 사전 워밍업 패턴 재사용).

### 3.2 역할 분담 원칙

| 작업 | 담당 | 근거 |
|---|---|---|
| 수집·정규화·중복제거·랭킹·시세 | 결정적 코드 | 이미 구현됨. LLM 쓰면 오히려 손해 |
| 기사 요약·3줄 구조화·번역·분류·태깅 | **로컬 Qwen 3.6** | 대량·반복·구조화 출력 — 로컬의 최적 지점, 비용 0 |
| 임베딩(중복제거·클러스터링·유사기사 검색) | **로컬 임베딩 모델** | LM Studio `/v1/embeddings` 활용 |
| 페르소나 리랭크·A/B 평가 | 로컬 | persona-reranker.ts 이미 존재 |
| 주간 인사이트·딥다이브·웹서치 보강 | Claude API (선택) | `claude.ts`에 web_search 포함 완성돼 있음. 주 1~2회면 비용 미미 |
| 품질 채점(LLM-as-judge) | Claude API (선택) | 로컬 결과물의 개선 루프용 |

### 3.3 즉시 적용 가능한 기술 개선

1. **인증 대응**: `llm.ts`에 `LLM_API_KEY` env + `Authorization: Bearer` 헤더 추가 (몇 줄이면 됨). 기본 모델명을 `qwen3.6-35b-a3b-mlx`로 갱신.
2. **Structured output**: `llm.ts` 주석의 "LM Studio는 response_format 미지원"은 낡은 정보 — 현행 LM Studio는 `response_format: {type: "json_schema", …}`를 지원한다. 현재의 repairJson/extractJson 응급 처치 계층을 스키마 강제로 대체하면 JSON 파싱 실패 재시도가 사실상 사라진다 (당시 운영 장애의 주범이었음).
3. **임베딩 기반 클러스터링 업그레이드**: 현재 문자 bigram Jaccard는 한↔영 동일 사건을 못 묶고, 이를 보상하려 임계값을 0.15까지 내려 오클러스터 위험이 있다. `bge-m3`나 `Qwen3-Embedding-0.6B`(둘 다 한/영 교차 강함, LM Studio에서 구동 가능)로 코사인 유사도 클러스터링을 하고, homebrew PG에 `pgvector`를 붙이면 "과거 유사 보도 이력"(seenPenalty 정확화, 이슈 타임라인)까지 열린다. 기존 `dedupArticles`/`clusterArticles` 인터페이스에 drop-in 가능.
4. **262K 컨텍스트 활용**: 기사당 2,500자 절단을 풀고 카테고리 전체 기사 전문을 단일 패스로 큐레이션 → 다단계 호출 감소, 합의/충돌 판단 품질 상승.
5. **reasoning 토글 분리**: Qwen 3.6의 thinking 모드를 요약(off, 속도)과 TOP3 선정·주간 인사이트(on, 품질)에 다르게 적용.

### 3.4 권장 하이브리드 구조

- **평일 데일리: 100% 로컬** — 수집은 코드, 요약·큐레이션은 Qwen 3.6. 완전 무료, 외부 의존 없음.
- **주간 브리핑·월간 회고·특집 딥다이브: Claude** — `claude.ts` 재활성(모델은 claude-sonnet-5 등 현행으로 갱신). web_search로 로컬이 못 하는 "실시간 맥락 보강" 담당.
- **평가 루프**: 이미 만들어 둔 ABEvaluation/divergence-gate 인프라를 "로컬 산출 vs Claude 산출" 블라인드 비교에 재활용 → 로컬 프롬프트를 데이터 기반으로 개선. 이 인프라를 만든 건 탁월한 선견이었고, 이제야 제 용도를 찾는 셈.

---

## 4. 고도화 로드맵

### Phase 0 — 정리 (반나절)
1. 미커밋 작업 커밋(기능 단위 분할 권장) + untracked 정리(스크린샷·디버그 스크립트 → 삭제 or `_archive/`)
2. Telegram 토큰 회전 + 하드코딩 제거(env화)
3. 4월 데이터 구출: 볼륨을 임시 컨테이너로 붙여 pg_dump → 네이티브 PG로 복원, docker-compose에서 postgres 서비스 제거(네이티브 일원화)
4. CLAUDE.md/README/DEPLOYMENT.md 현행화, Python Gen1 아카이브 결정(수집기는 TS로 대체 완료 — `_legacy/`로 이동 권장), Ollama 잔재(`summarizer.py`, `wait-and-inject.sh`) 제거
5. `.env.local` 갱신(사용자 직접: 444 잠금 해제 → 모델명·LLM_API_KEY 반영 → 재잠금)

### Phase 1 — 부활 (1일)
1. `llm.ts` 토큰 지원 + 모델명 갱신 + json_schema 적용
2. supplement 환각 패스 제거 → 부족 시 그대로 + Telegram 경고
3. `next build` 프로덕션 모드 + LaunchAgent 2개 등록: `com.news-digest.web`(:3200), `com.news-digest.daily`(06:30 `/api/cron/daily` 호출, CRON_SECRET 설정)
4. 아침 브리핑 Telegram push(기존 봇 재사용: TOP3 + 대시보드 링크) — Tailscale이 이미 있으니 폰에서 `http://맥미니:3200` 접근 가능

### Phase 2 — 로컬 모델 고도화 (1주)
임베딩 클러스터링 + pgvector, 전문 단일 패스 큐레이션, thinking 토글 분리, 7일 롤링 중복률<2% 목표(CMP-143) 실측 대시보드화

### Phase 3 — 에이전트(하네스)화 (선택)
- **노선 A (기본)**: 결정적 파이프라인 유지 + LLM 스텝만 고도화 — 안정·저비용. 데일리는 이 노선.
- **노선 B**: "아침 에디터 에이전트" — cron이 `claude -p`(headless) 또는 Agent SDK를 호출, 에이전트가 수집 결과를 읽고 도구(DB 질의, 웹서치, 재수집)를 스스로 써서 브리핑 작성 + 실패 시 자가 복구. 파이프라인이 뼈대, 에이전트는 예외 처리와 품질 마감. 주간 딥다이브부터 적용해 보는 것을 권장.
- **노선 C (개인화 루프)**: Telegram 브리핑에 👍/👎 인라인 버튼 → 반응을 Persona.interests/sourceWeights와 ranker의 seenPenalty에 반영 → "볼수록 내 취향이 되는" 브리핑. 스키마(Persona, PersonaRankResult)가 이미 준비돼 있어 남은 건 피드백 수집 경로뿐.

### 아이템 백로그 (고도화 아이디어)
- **부동산 정형 데이터 수집기**: 국토부 실거래가 공공 API, 한국은행 ECOS(기준금리·가계대출), KB시세 → 관심 지역(동 단위) 워치리스트 알림. RSS 뉴스와 정형 데이터가 결합되면 "우리 동네 실거래 + 관련 정책 뉴스" 묶음 브리핑 가능
- **종목 워치리스트**: 보유/관심 종목 티커 등록 → 해당 기업 뉴스 우선 랭킹 + Yahoo 시세 연동 (market-fetcher 확장)
- **이슈 타임라인**: wiki ledger + ContextTagHistory로 "이 이슈가 지난 3주간 어떻게 전개됐나" 자동 생성 (IssueTimeline 컴포넌트 이미 존재)
- **LLM-as-judge 야간 채점**: 매일 다이제스트를 Claude 저가 모델이 채점(팩트 근거·요약 충실도) → 주간 품질 리포트
- **오디오 브리핑**: TOP3를 TTS로 아침 오디오 파일 생성 → Telegram 음성 메시지

---

## 5. 지금 바로 할 일 3가지

1. **Telegram 봇 토큰 회전** (git 이력에 노출됨)
2. **미커밋 2,572줄 커밋** (유실 방지)
3. **`news-digest_postgres_data` 볼륨에서 4월 데이터 pg_dump** (컨테이너 정리 전에)

이 3개는 파괴적 변경이 아니고 데이터를 지키는 일이라 가장 먼저다. 이후 Phase 1(부활)은 하루면 끝난다.
