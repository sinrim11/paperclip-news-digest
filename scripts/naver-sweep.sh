#!/bin/zsh
# 네이버 매물 전수 스윕 (수동/최초 1회). env 로드 후 실행.
set -uo pipefail
cd /Users/sklee01/news-digest
export PATH="/opt/homebrew/bin:$PATH"
LOG="output/naver_sweep.log"
# 로그 로테이션(2026-08-11) — 5MB 초과 시 최근 1MB만 유지(무한 누적 방지)
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG" | tr -d ' ')" -gt 5000000 ]; then
  tail -c 1000000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a
# 요일 분할 그룹(G2-4): sun=일·목, wed=수·토 — 각 그룹 주 2회 → 지역당 3~4일 간격 재수집.
# 화=gangnam1h(강남권 1시간 10곳, 2026-08-29 편입) — 기존 그룹에 얹으면 6.5→9시간대가 되어 전용 회차로 분리.
# 수동 실행 시 인자로 지정 가능: naver-sweep.sh wed | gangnam1h | gyeonggi-new | backfill
GROUP="${1:-}"
if [ -z "$GROUP" ]; then
  case "$(date +%u)" in
    2) GROUP="gangnam1h" ;;
    3|6) GROUP="wed" ;;
    *) GROUP="sun" ;;
  esac
fi
echo "=== $(date '+%Y-%m-%d %H:%M:%S') naver-sweep 시작 (그룹 $GROUP) ===" >> "$LOG" 2>&1
npx tsx scripts/naver-sweep.ts --group="$GROUP" >> "$LOG" 2>&1
echo "--- 신규 단지 좌표 백필(통근·상권 점수용) ---" >> "$LOG" 2>&1
npx tsx scripts/backfill-coords.ts >> "$LOG" 2>&1
echo "--- 신규 단지 용적률 백필(재건축 사업성 지표) ---" >> "$LOG" 2>&1
npx tsx scripts/backfill-far.ts >> "$LOG" 2>&1
echo "--- 카카오 실데이터 증분 수집(역·상권·자차경로) ---" >> "$LOG" 2>&1
npx tsx scripts/refresh-kakao-context.ts >> "$LOG" 2>&1
echo "--- 전체매물 분석 재생성(gen-listings — /listings 즉시 반영, G2-1) ---" >> "$LOG" 2>&1
npx tsx scripts/gen-listings.ts >> "$LOG" 2>&1
echo "--- 페르소나별 사전 추천 재생성(gen-persona-recos — /recommend, G3) ---" >> "$LOG" 2>&1
npx tsx scripts/gen-persona-recos.ts >> "$LOG" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') naver-sweep 종료 ===" >> "$LOG" 2>&1

# 창(window) 경고(2026-09-01) — 스윕이 recommend 08:30을 넘겨 끝나면 그날 추천·카드뉴스는
# 전날 호가로 만들어진다. 9/1에 실제로 그랬다(03:00 시작 → 09:12 종료). 시작을 01:00으로
# 옮겨 여유를 뒀지만 wed 그룹(361동)은 수리 후 소요시간 실측이 없으므로, 넘길 때마다
# 스스로 알리게 한다. 꼬리를 건너뛰지는 않는다 — 건너뛰면 /listings가 하루 종일 낡는다.
DONE_HM=$(date '+%H%M')
LATE_NOTE=""
if [ "$DONE_HM" -gt "0815" ]; then
  LATE_NOTE=" · ⚠️ 08:15 초과 종료($DONE_HM) — 오늘 추천·카드뉴스는 이전 회차 호가 기준"
fi

# 1줄 요약(2026-08-11 다이어트)
npx tsx scripts/notify-telegram.ts "🤖 매물 스윕 완료 (그룹 $GROUP)$LATE_NOTE" >> "$LOG" 2>&1 || true
