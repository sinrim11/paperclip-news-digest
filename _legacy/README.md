# _legacy — Gen1 Python 파이프라인 아카이브 (2026-07-03)

Next.js/TypeScript 시스템(`src/`)으로 대체된 1세대 코드 보관소. 실행을 전제로 하지 않는다.

## 내용물
- `collector.py` / `generator.py` / `main.py` — RSS 수집 → 요약 → 마크다운 다이제스트 (Gen1 파이프라인). `summarizer.py`는 Ollama 전용 코드라 보드 방침(MLX/Ollama 영구 폐기)에 따라 **삭제**됨 → `main.py`는 이제 단독 실행 불가.
- `web_app/` — Gen1 FastAPI 뷰어 (:3201)
- `telegram_*.py`, `notify.py`, `ceo_forward.py` — Paperclip(CMP-*) 연동 Telegram 리에종. Paperclip 서버(:3100)는 현재 다른 프로젝트가 포트 점유 중이라 동작 불가.
- `run_daily.sh`, `run_nextjs.sh`, `scripts/watchdog-next.sh` 등 — dev 서버 시절 운영 스크립트. launchd(`config/launchd/`) + `next start`로 대체됨.
- `scripts/` — CMP 개발 당시 일회성 디버그/검증 스크립트.

## 보안 주의
이 디렉토리의 Telegram 봇 토큰은 `REDACTED-ROTATE-ME`로 소독되었으나 **원본 토큰은 git 이력에 남아 있다**. BotFather에서 토큰을 revoke/재발급하기 전까지는 노출 상태로 간주할 것. 새 토큰은 `.env`(gitignored)의 `TELEGRAM_BOT_TOKEN`에만 둔다.
