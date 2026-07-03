#!/bin/zsh
# 주간 딥다이브 — 지난 7일 다이제스트를 헤드리스 Claude(claude -p)로 심층 분석
# (launchd: com.news-digest.weekly-deepdive, 일요일 19:00)
#
# 데일리 파이프라인은 100% 로컬 LLM. 이 스크립트만 Claude API를 사용한다(주 1회).
# 인증: ANTHROPIC_AUTH_TOKEN — .env 또는 ~/.zshrc(인터랙티브 셸)에서 로드.
set -uo pipefail
cd /Users/sklee01/news-digest
LOG="output/weekly_deepdive.log"
ts() { date '+%Y-%m-%d %H:%M:%S'; }

set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a

# launchd 컨텍스트에는 ~/.zshrc가 로드되지 않으므로 인터랙티브 셸에서 토큰 추출
if [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  export ANTHROPIC_AUTH_TOKEN="$(zsh -ic 'print -rn -- ${ANTHROPIC_AUTH_TOKEN:-}' 2>/dev/null)"
fi
if [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  echo "[$(ts)] ANTHROPIC_AUTH_TOKEN 없음 — 딥다이브 건너뜀" >> "$LOG"
  exit 0
fi

TODAY=$(TZ=Asia/Seoul date +%F)
OUT="output/weekly-deepdive-${TODAY}.md"

# 지난 7일 뉴스 데이터 수집 (제목/팩트/긴급도/TOP3)
DATA=$(psql -h localhost -p 5432 -d news_digest -At -F'|' -c "
  SELECT d.date::date, n.category, n.urgency,
         CASE WHEN n.\"isTop3\" THEN 'TOP'||n.\"top3Rank\" ELSE '' END,
         left(n.title, 120), left(n.fact, 200)
  FROM \"NewsItem\" n JOIN \"DailyDigest\" d ON d.id = n.\"digestId\"
  WHERE d.date >= CURRENT_DATE - INTERVAL '6 days'
  ORDER BY d.date, n.category, n.\"newsOrder\";" 2>>"$LOG")

if [ -z "$DATA" ]; then
  echo "[$(ts)] 지난 7일 데이터 없음 — 딥다이브 건너뜀" >> "$LOG"
  exit 0
fi

COUNT=$(echo "$DATA" | wc -l | tr -d ' ')
echo "[$(ts)] deep-dive 시작 — ${COUNT}건 입력" >> "$LOG"

PROMPT="당신은 시니어 투자 전략가입니다. 아래는 지난 7일간 수집된 뉴스 다이제스트입니다 (형식: 날짜|카테고리|긴급도|TOP3여부|제목|팩트).

${DATA}

이 데이터를 기반으로 '주간 딥다이브 리포트'를 한국어 마크다운으로 작성하세요:
1. **이번 주 핵심 내러티브 3가지** — 개별 뉴스가 아니라 흐름(연결된 사건들)으로
2. **자산별 시사점** — 주식(한국/미국), 부동산, 환율/금리 관점
3. **다음 주 체크포인트** — 예정 이벤트와 주시할 신호
4. **놓치기 쉬운 신호 1가지** — 작게 보도됐지만 중요할 수 있는 것
데이터에 없는 사실을 만들지 말고, 근거 뉴스의 날짜·카테고리를 함께 표기하세요."

if echo "$PROMPT" | claude -p --model sonnet > "$OUT" 2>>"$LOG" && [ -s "$OUT" ]; then
  echo "[$(ts)] deep-dive 완료 → $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)" >> "$LOG"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    HEAD=$(head -c 3000 "$OUT")
    python3 - "$HEAD" "$OUT" <<'PYEOF' 2>>"$LOG"
import json, os, sys, urllib.request
text = f"📚 주간 딥다이브 리포트\n\n{sys.argv[1]}\n\n(전문: {sys.argv[2]})"
req = urllib.request.Request(
    f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN']}/sendMessage",
    data=json.dumps({"chat_id": os.environ["TELEGRAM_CHAT_ID"], "text": text[:4000]}).encode(),
    headers={"Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=10)
PYEOF
  fi
else
  echo "[$(ts)] deep-dive 실패 — claude -p 로그 확인" >> "$LOG"
  exit 1
fi
