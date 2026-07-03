# 일일 뉴스 다이제스트 시스템

매일 아침 5개 카테고리(글로벌·증권·AI·정치/정책·부동산) 뉴스를 수집해 로컬 LLM으로 3줄 요약(팩트/임팩트/액션)하고, TOP3 선정 + 마켓 스냅샷과 함께 대시보드·Telegram으로 제공하는 개인 브리핑 시스템.

**전량 로컬 실행**: LLM은 LM Studio(`localhost:1234`)의 `qwen3.6-35b-a3b-mlx`, DB는 네이티브 PostgreSQL 16. 외부 API 비용 없음.

## 아키텍처

```
RSS(25+) · HN · Reddit · arXiv · PwC · GitHub Trending · 뉴스레터   ← 결정적 수집기
  → dedup (URL 정규화 + bigram Jaccard)                             ← src/lib/dedup.ts
  → 3-신호 클러스터링 (제목/엔티티/본문, 다중 출처 합의·이견 추출)      ← src/lib/news-collector.ts
  → 카테고리별 LLM 큐레이션 (json_schema 구조화 출력, 최대 10건)      ← src/lib/llm.ts (LM Studio)
  → TOP3 선정 → Yahoo Finance 마켓 스냅샷
  → PostgreSQL (Prisma) → 대시보드(:3200) · Telegram/Slack 알림 · wiki 원장
```

## 실행

```bash
npm install && npx prisma generate
npm run build
npx next start -p 3200          # 또는 launchd: config/launchd/ 참고
```

- 공개 접속: **https://makeagent.dev** (Cloudflare tunnel → :3200, 모바일에서도 접근 가능)
- 상시 운영: `config/launchd/com.news-digest.web.plist` (웹, KeepAlive) + `com.news-digest.daily.plist` (매일 06:30 생성 트리거) + `com.news-digest.weekly-deepdive.plist` (일요일 19:00) → `~/Library/LaunchAgents`에 복사 후 `launchctl bootstrap gui/$(id -u) <plist>`
- 수동 생성: `curl -X POST localhost:3200/api/cron/daily -H "Authorization: Bearer $CRON_SECRET"`

## 환경변수

| 파일 | 내용 |
|---|---|
| `.env` (gitignored) | `LLM_API_KEY`(LM Studio 토큰), `LLM_MODEL`, `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| `.env.local` (read-only, 보드 관리) | `DATABASE_URL`, `LLM_BASE_URL`, `CRON_SECRET`, `NEXTAUTH_URL`(:3200) |

전체 목록과 예시는 `.env.example` 참고.

## 검증

```bash
scripts/verify-e2e.sh    # LM Studio 인증 → DB → 웹 → 다이제스트 생성 → 알림까지 전 구간 점검
npm test                 # 단위 테스트 (vitest)
```

## 디렉토리

- `src/` — Next.js 앱 (API Routes + 대시보드)
- `config/` — 뉴스 소스, 랭커 가중치, launchd plist
- `docs/` — 설계 문서·분석 보고서 (`PROJECT-ANALYSIS-2026-07-03.md` 참고)
- `_legacy/` — 폐기된 Gen1 Python 파이프라인 아카이브 (실행 비대상)
- `backup/` — DB 구출 덤프 (gitignored)
