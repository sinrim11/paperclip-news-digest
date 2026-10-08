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

# 프롬프트는 **quoted heredoc**으로 둔다. 2026-09-15: 종전 PROMPT='…' 형식에서 본문에
# 작은따옴표('[collector:rss] DEAD' 같은 로그 인용)를 넣자 문자열이 거기서 끊기고 나머지가
# 명령으로 해석돼 zsh가 "command too long"을 냈다. 그 결과 PROMPT가 비어 claude -p가
# exit=1("Input must be provided…")로 즉사했고, 아침 보고가 통째로 사라졌다.
# quoted heredoc은 따옴표·백틱·$를 모두 문자 그대로 담는다(백틱 사고 재발 방지도 겸함).
PROMPT=$(cat <<'PROMPT_EOF'
오늘 아침 사이클(~/news-digest)을 전수 점검하고 결과를 텔레그램으로 보고해줘. 사용자가 명시적으로 요청한 정기 보고이므로 반드시 텔레그램 전송까지 완료할 것. 전송은 `npx tsx`로 `@/lib/telegram`의 sendTelegram을 쓰면 된다(top-level await 불가 — void (async () => {...})() 형태로 감쌀 것).

점검 대상 — 각 단계의 로그와 산출물을 both 확인:
1. naver-sweep — 전날 21:00 시작(일·화·수·목·토). wed 그룹은 약 9시간, sun 약 7.5시간이 걸려 다음날 04~06시에 끝난다 — ComplexCandidate.sweptAt 갱신 여부, 동별 0건 스트릭. 2026-08-29에 반복 API 탐침으로 네이버가 IP를 일시 차단한 적이 있으니, 0건이면 차단인지 요일 문제인지 구분할 것.
2. collect 06:00 — AptTrade/AptRent 신규 건수
3. gosi 06:20 — 신규 고시 건수와 등급 분포. 사용자가 "🟡 등급이 필요한지 며칠 지켜보겠다"고 한 관찰 항목이니 🔴 일변도인지 기록
4. digest 06:30 / policy-refresh 06:45 — config/policy-params.json·policy-loans.json 변경 제안 여부.
   ★ 피드 생사: output/web.log 에서 (수집은 Next 서버 프로세스가 하므로 web.log에 찍힌다. daily_run.log는 HTTP 트리거 기록일 뿐이고 digest.log는 존재하지 않는다) '[collector:rss] DEAD' / 'EMPTY' 줄을 세어 보고할 것. 2026-09-14 점검 당시 소스 중 10개가 죽어 있었는데(부동산 5개 중 3개 포함) 조용히 0건을 반환해 아무도 몰랐다. DEAD가 뜨면 소스명·상태코드를 그대로 옮기고, 같은 소스가 3일 연속이면 교체 대상으로 제안할 것(무인 실행이므로 수정은 하지 말 것).
   ★ 정책값이 바뀌었거나(자동 적용·동결 스킵 모두) 변경 제안이 올라왔다면, 사용자 지침에 따라 **1차 출처를 직접 열어 확인**하고 보고할 것:
   - 순서: 금융위(fsc.go.kr) → 국토부(molit.go.kr) → 정책브리핑(korea.kr). 언론기사·블로그·은행 설명페이지는 근거로 삼지 말 것(2026-08~09에 기사가 원문 판단을 뒤집어 두 달간 5회 진동한 전례가 있다).
   - WebSearch로 보도자료를 찾고 WebFetch로 원문 문장을 그대로 인용해 올 것. "확인했다"가 아니라 인용문과 URL을 보고에 포함한다.
   - 원문과 시스템값이 다르면 값을 고치지 말고 인용문·URL·차이를 보고만 한다(무인 실행에서 예산을 바꾸지 않는다).
   - 원문을 못 찾으면 "미확인"으로 명시. 추측으로 메우지 말 것.
   - 참고: dsr 세 키(스트레스 가산 2개 + assumedBaseRatePct)는 config/policy-params.json의 _frozenPaths로 동결돼 있고 확정 근거는 _frozenSource에 있다(수도권 3.0%).
5. market-research 07:00
6. recommend 08:30 — 텔레그램 추천 목록, 중복 전송 방지(signalLowManwon·signalTag)가 작동했는지. 쿨다운은 트랙 무관 단지 단위(2026-10-08) — 오늘 발송분 중 14일 내 다른 트랙으로 이미 나간 단지가 signalTag 없이 있으면 이상이다
7. matching 08:45
8. cardnews 09:00 — 생성 장수·시리즈·픽 목록. 대표 PNG 1장을 Read로 직접 열어 자금계획 2경로와 입지도가 정상 렌더됐는지 눈으로 확인할 것
8-1. **코드 반영 확인** — 빌드만으로는 프로덕션에 반영되지 않는다. Next 프로덕션 서버는 기동 시점 빌드를 물고 있어 `launchctl kickstart -k gui/$(id -u)/com.news-digest.web` 재시작이 있어야 새 코드가 돈다. 2026-09-15에 전날 수집기 수정분이 이 이유로 하루치 누락됐다(로그에 옛 메시지가 그대로 찍혀 발각). web.log의 수집 로그 형식이 현재 코드와 맞는지 확인할 것.
9. 웹(localhost:3200) — /, /recommend, /gosi, /complex/<임의 단지> 응답 코드

★ 이슈 레지스트리 — output/open-issues.json (점검 시작 전에 반드시 읽을 것)
- 이미 등록된 이슈는 다시 서술하지 않는다. 오늘 상태만 갱신(lastSeen, 변화 있으면 note에 한 줄).
- 새로 발견한 이슈는 issues에 추가(id·title·firstSeen·status·note). 사용자 판단이 필요한 것은 status=needs-decision.
- status=resolved-pending-verify 는 verify 조건을 오늘 데이터로 확인해 통과하면 resolved(resolvedAt 유지), 실패하면 open으로 되돌리고 이유를 note에.
- verify 조건을 오늘 데이터로 판정할 수 없으면(시리즈 불일치·해당 이벤트 없음) 상태를 바꾸지 말고 note에 '미판정(사유)'만 적을 것. 추측으로 resolved/open을 정하지 않는다.
- resolved가 된 지 7일 지난 항목은 삭제. 파일은 Bash(node/python)로 갱신하고 JSON 유효성을 확인할 것.

보고 형식 — 텔레그램 **1통, 1,500자 이내** (2026-10-08 회고: 하루 2~3통 5,000~7,000자에 같은 3건이 25일간 반복돼, 정작 결정할 항목이 묻혔다):
  1행: "🔍 아침 점검 MM-DD — 9단계 중 정상 N · 이상 M"
  🆕 새 이슈 (있을 때만): 무엇이·몇 건·사용자 영향·제안. 근거 수치 포함.
  ❓ 결정 필요 (있을 때만): 질문 1줄 + 선택지. "Claude Code 세션에서 답해 주세요"로 끝낸다.
  ✅ 해결 확인 (있을 때만): 레지스트리에서 resolved로 바뀐 항목 한 줄씩.
  ⏳ 미해결 (변화 없음): "제목 D+N" 한 줄씩. 설명 반복 금지.
  이상 단계: 해당 단계만 한 줄씩. 정상 단계는 1행 숫자로 갈음 — 정상 증명 수치는 보고에 넣지 말고 로그(stdout)에만 남길 것.
- 정책값 1차 출처 확인 결과는 새로 확인했거나 값이 바뀐 경우에만 인용문+URL로. 변화 없으면 생략.
- 1,500자를 넘으면 미해결·이상 단계 줄부터 줄인다. 새 이슈와 결정 필요는 줄이지 않는다.

보고 원칙:
- 한국어로, 숫자 근거를 붙여서.
- 실패·이상이 있으면 원인까지 진단. 파이프라인 재실행으로 해결되는 것은 재실행해도 되지만, 코드 수정과 배포는 하지 말고 제안으로만 담을 것(승인 없이 프로덕션을 바꾸지 않는다).
- DB 값을 근거로 적을 때는 실제 쿼리 결과를 그대로 옮길 것(2026-10-06 직전 행만 출력한 쿼리로 signalTag를 null로 오기한 전례). RSS 소스 수는 config/news_sources.json에서 세어 쓸 것.
PROMPT_EOF
)

# 프롬프트가 비면 claude는 알 수 없는 에러로 죽는다 — 여기서 먼저 잡고 알린다.
if [ ${#PROMPT} -lt 200 ]; then
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') PROMPT 손상(${#PROMPT}자) — 중단 ===" >> "$LOG"
  notify "⚠️ 아침 점검 중단%0A프롬프트가 손상됐습니다(${#PROMPT}자). scripts/morning-review.sh 확인 필요."
  exit 1
fi

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
