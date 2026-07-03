# 운영 가이드 (맥미니 로컬)

기준일: 2026-07-03. Docker/K8s 기반 구가이드는 폐기됨 — 현재 운영은 **네이티브 스택**이다.

## 구성 요소

| 구성 | 내용 | 확인 |
|---|---|---|
| LLM | LM Studio headless(:1234), `qwen3.6-35b-a3b-mlx`, **Bearer 토큰 인증** | `make test-llm` |
| DB | 네이티브 PostgreSQL 16 (:5432), DB `news_digest` | `psql -d news_digest` |
| 웹 | `next start -p 3200` (launchd `com.news-digest.web`, KeepAlive) | `curl localhost:3200` |
| 데일리 | launchd `com.news-digest.daily` → 매일 06:30 `scripts/run-daily-digest.sh` | `output/daily_run.log` |
| 알림 | Telegram(`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`) + Slack(선택) | 아침 메시지 수신 |

포트 주의: 3000(kfestival)·3100(render-worker)·5433(tradingagents PG)은 타 프로젝트 점유. 이 앱은 **3200 고정**.

## 최초 설치 / 재설치

```bash
npm install
npx prisma generate
npm run build

# launchd 등록
cp config/launchd/com.news-digest.web.plist config/launchd/com.news-digest.daily.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.news-digest.web.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.news-digest.daily.plist
```

환경변수는 `.env`(비밀값, gitignored)와 `.env.local`(보드 관리, read-only 444)에 있다. `.env.example` 참고.

## 일상 운영

```bash
scripts/verify-e2e.sh                                  # 전 구간 검증 (idempotent)
launchctl kickstart -k gui/$(id -u)/com.news-digest.web  # 웹 강제 재시작
tail -f output/web.log output/daily_run.log            # 로그
launchctl bootout gui/$(id -u)/com.news-digest.daily   # 스케줄 해제
```

수동 생성(특정 날짜/강제):

```bash
curl -X POST localhost:3200/api/digest/generate \
  -H 'Content-Type: application/json' -d '{"date":"2026-07-03","force":true}'
```

## 코드 변경 배포

```bash
npm test && npm run build
launchctl kickstart -k gui/$(id -u)/com.news-digest.web
scripts/verify-e2e.sh
```

## 트러블슈팅

- **LLM 401**: LM Studio 토큰 재발급 → `.env`의 `LLM_API_KEY` 갱신. 확인: `make test-llm`
- **모델 없음**: `lms ps`로 로드 모델 확인. `.env.local`의 `LLM_MODEL`이 없는 모델이면 `llm.ts`가 로드된 첫 모델로 자동 폴백함
- **DB 접속 실패**: `brew services info postgresql@16`. 과거 Docker PG(5432 충돌)는 폐기 — 컨테이너를 되살리지 말 것
- **06:30 미실행**: `launchctl print gui/$(id -u)/com.news-digest.daily` 로 등록 확인; 맥 절전이면 미발화 → 시스템 설정에서 절전 예외 또는 `pmset repeat wakeorpoweron MTWRFSU 06:25:00`

## 데이터 이력

- 2026-04-13 ~ 04-25 운영 데이터는 폐기된 Docker 볼륨(`news-digest_postgres_data`)에서 2026-07-03 네이티브 PG로 복원 완료 (600 NewsItem). 전체 덤프: `backup/news_digest_full_rescue_20260703.sql`
- 볼륨은 아카이브로 보존 중 — 복원 검증이 끝난 뒤 `docker volume rm news-digest_postgres_data`로 정리 가능

## 보안 메모

- 구 Telegram 봇 토큰은 git 이력에 노출 → **BotFather에서 revoke 후 재발급**하고 `.env`만 갱신할 것 (코드/커밋에 토큰 금지)
- `CRON_SECRET`을 설정하면 크론 라우트가 Bearer 인증을 요구함 (`.env.local`)
