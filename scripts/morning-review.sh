#!/bin/zsh
# 아침 사이클 전수 점검 + 텔레그램 보고 (launchd: com.news-digest.morning-review, 매일 09:17)
#
# 왜 09:17인가: 사이클의 마지막 작업이 cardnews 09:00이라 그 전에 점검하면 카드뉴스 결과를 못 본다.
# 왜 claude -p인가: 로그를 읽고 이상을 진단하는 일은 고정 스크립트로 표현되지 않는다.
#   "스윕이 0건인데 이게 차단 때문인지 일요일이라 그런지"를 판단하려면 맥락이 필요하다.
#
# 권한: Bash·Read·Grep·Glob만 허용한다. 무인 실행에서 코드를 고치고 배포까지 하는 건
#   승인 없이 프로덕션을 바꾸는 것이라, 수정이 필요한 이슈는 보고에 제안으로만 담게 한다.
#
# 불사 원칙: claude -p가 죽어도 사용자는 조용히 기다리게 된다 → 실패 자체를 텔레그램으로 알린다.
set -uo pipefail
cd /Users/sklee01/news-digest
export PATH="/Users/sklee01/.local/bin:/opt/homebrew/bin:$PATH"
export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=3000"

LOG="output/morning-review.log"
set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a

notify() {  # 스크립트 자체가 실패했을 때의 최소 보고 경로
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || return 0
  curl -s -m 20 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" -d "parse_mode=HTML" --data-urlencode "text=$1" >/dev/null
}

PROMPT='오늘 아침 사이클(~/news-digest)을 전수 점검하고 결과를 텔레그램으로 보고해줘. 사용자가 명시적으로 요청한 정기 보고이므로 반드시 텔레그램 전송까지 완료할 것. 전송은 `npx tsx`로 `@/lib/telegram`의 sendTelegram을 쓰면 된다(top-level await 불가 — void (async () => {...})() 형태로 감쌀 것).

점검 대상 — 각 단계의 로그와 산출물을 both 확인:
1. naver-sweep 01:00 (일·화·수·목·토만 실행) — ComplexCandidate.sweptAt 갱신 여부, 동별 0건 스트릭. 2026-08-29에 반복 API 탐침으로 네이버가 IP를 일시 차단한 적이 있으니, 0건이면 차단인지 요일 문제인지 구분할 것.
2. collect 06:00 — AptTrade/AptRent 신규 건수
3. gosi 06:20 — 신규 고시 건수와 등급 분포. 사용자가 "🟡 등급이 필요한지 며칠 지켜보겠다"고 한 관찰 항목이니 🔴 일변도인지 기록
4. digest 06:30 / policy-refresh 06:45 — config/policy-params.json·policy-loans.json 변경 제안 여부.
   ★ 정책값이 바뀌었거나(자동 적용·동결 스킵 모두) 변경 제안이 올라왔다면, 사용자 지침에 따라 **1차 출처를 직접 열어 확인**하고 보고할 것:
   - 순서: 금융위(fsc.go.kr) → 국토부(molit.go.kr) → 정책브리핑(korea.kr). 언론기사·블로그·은행 설명페이지는 근거로 삼지 말 것(2026-08~09에 기사가 원문 판단을 뒤집어 두 달간 5회 진동한 전례가 있다).
   - WebSearch로 보도자료를 찾고 WebFetch로 원문 문장을 그대로 인용해 올 것. "확인했다"가 아니라 인용문과 URL을 보고에 포함한다.
   - 원문과 시스템값이 다르면 값을 고치지 말고 인용문·URL·차이를 보고만 한다(무인 실행에서 예산을 바꾸지 않는다).
   - 원문을 못 찾으면 "미확인"으로 명시. 추측으로 메우지 말 것.
   - 참고: dsr 두 키는 config/policy-params.json의 _frozenPaths로 동결돼 있고 확정 근거는 _frozenSource에 있다(수도권 3.0%).
5. market-research 07:00
6. recommend 08:30 — 텔레그램 추천 목록, 중복 전송 방지(signalLowManwon·signalTag)가 작동했는지
7. matching 08:45
8. cardnews 09:00 — 생성 장수·시리즈·픽 목록. 대표 PNG 1장을 Read로 직접 열어 자금계획 2경로와 입지도가 정상 렌더됐는지 눈으로 확인할 것
9. 웹(localhost:3200) — /, /recommend, /gosi, /complex/<임의 단지> 응답 코드

보고 원칙:
- 한국어로, 숫자 근거를 붙여서. "정상"만 쓰지 말고 무엇이 몇 건인지 적을 것.
- 실패·이상이 있으면 원인까지 진단해서 보고. 파이프라인 재실행으로 해결되는 것은 재실행해도 되지만, 코드 수정과 배포는 하지 말고 제안으로만 담을 것(승인 없이 프로덕션을 바꾸지 않는다).
- 이상이 없으면 짧게. 길이로 성실함을 표현하지 말 것.'

echo "=== $(date '+%Y-%m-%d %H:%M:%S') morning-review 시작 ===" >> "$LOG"

# macOS엔 coreutils의 timeout이 없다 → 워치독 프로세스로 30분 상한을 건다.
claude -p \
  --allowedTools Bash Read Grep Glob WebSearch WebFetch \
  --permission-mode acceptEdits \
  "$PROMPT" >> "$LOG" 2>&1 &
CLAUDE_PID=$!
( sleep 1800; kill -TERM "$CLAUDE_PID" 2>/dev/null ) &
WATCHDOG_PID=$!
wait "$CLAUDE_PID"
CODE=$?
kill "$WATCHDOG_PID" 2>/dev/null

if [ "$CODE" -ne 0 ]; then
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') claude 실패 exit=$CODE ===" >> "$LOG"
  notify "⚠️ <b>아침 점검 자동 보고 실패</b>
claude -p 가 exit=${CODE}로 종료됐습니다(워치독 강제 종료는 143).
사이클 자체는 별개로 돌았을 수 있습니다 — 로그: output/morning-review.log
직접 확인이 필요합니다."
  exit "$CODE"
fi

echo "=== $(date '+%Y-%m-%d %H:%M:%S') morning-review 완료 ===" >> "$LOG"
