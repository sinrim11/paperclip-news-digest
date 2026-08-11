#!/bin/zsh
# 일일 시장 리서치 — 헤드리스 Claude(claude -p + 웹서치)로 시장 컨텍스트 갱신.
# (launchd: com.news-digest.market-research, 매일 07:00 · 08:30 추천 이전)
# 산출: config/market-context.json (recommend-engine이 예산상한·지역가중을 여기서 읽음)
# 방어: 유효 JSON일 때만 덮어씀. 실패 시 기존 컨텍스트 유지(엔진은 fallback으로 계속 동작).
set -uo pipefail
cd /Users/sklee01/news-digest
export PATH="/Users/sklee01/.local/bin:/opt/homebrew/bin:$PATH"
LOG="output/market_research.log"
ts() { date '+%Y-%m-%d %H:%M:%S'; }

set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a

if [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  export ANTHROPIC_AUTH_TOKEN="$(zsh -ic 'print -rn -- ${ANTHROPIC_AUTH_TOKEN:-}' 2>/dev/null)"
fi
if [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  echo "[$(ts)] ANTHROPIC_AUTH_TOKEN 없음 — 시장리서치 건너뜀(기존 컨텍스트 유지)" >> "$LOG"
  exit 0
fi

TODAY=$(TZ=Asia/Seoul date +%F)
TMP="output/market-context-${TODAY}.json"

read -r -d '' PROMPT <<EOF || true
너는 한국 부동산 시장 애널리스트다. 웹서치로 오늘(${TODAY}) 기준 서울 아파트 매수 여건의 최신 신호를 조사해라.
대상 독자: 무주택 1인가구 생애최초, 가용자본 3.75억, 매수예산 8억 안팎, 서남권(관악·동작·영등포·구로·금천·강서·양천)·동북권(노원·도봉·중랑·강북·성북·은평) 중저가 관심.

다음 JSON 스키마로만 응답하라(설명·마크다운·코드펜스 없이 순수 JSON 객체 하나만 출력):
{
  "asOf": "${TODAY}",
  "regime": "한줄 시장 국면 요약",
  "rate": {"base": 기준금리숫자, "direction": "up|down|flat", "note": "금리 시그널"},
  "policy": {"easedSignal": "none|weak|strong", "firstTimeAdvantage": "생애최초 관련 요지", "note": "정책 방향"},
  "budgetReality": {"comfortableCeilingManwon": 80000, "stretchCeilingManwon": 90000, "note": "대출·DSR 현실"},
  "regionHeat": {"성북구":1~4, "노원구":1~4, "강북구":1~4, "관악구":1~4, "영등포구":1~4, "중랑구":1~4, "도봉구":1~4, "동작구":1~4, "구로구":1~4, "금천구":1~4, "강서구":1~4, "양천구":1~4, "은평구":1~4},
  "cautions": ["매수자가 주의할 최신 리스크 3~5개"],
  "sources": [{"title": "매체명 '기사 제목' (날짜)", "url": "https://실제기사URL"}]
}
regionHeat는 최근 상승 모멘텀(1=약,4=강). 확인 안 되면 기존 값 유지 성격으로 3. 수치는 실제 최신 데이터에 근거하라.
sources는 3~6개, 반드시 각 항목에 실제 접속 가능한 기사 URL(url 필드)을 포함하라 — 웹서치 결과의 원문 링크를 그대로 쓰고, URL을 모르면 그 출처는 제외하라(제목만 있는 출처 금지). 이 출처는 web UI에 신뢰 근거 링크로 노출된다.
EOF

echo "[$(ts)] 시장리서치 시작" >> "$LOG"
# claude -p 일시 실패 재시도(2026-08-11) — 1회 재시도, 60초 간격
MC_OK=false
for attempt in 1 2; do
  if echo "$PROMPT" | claude -p --model sonnet --allowedTools "WebSearch WebFetch" > "$TMP" 2>>"$LOG" && [ -s "$TMP" ]; then
    MC_OK=true; break
  fi
  [ "$attempt" = "1" ] && { echo "[$(ts)] claude -p 1차 실패 — 60초 후 재시도" >> "$LOG"; sleep 60; }
done
if $MC_OK; then
  # 코드펜스 제거 후 JSON 추출·검증
  node -e '
    const fs=require("fs");
    let t=fs.readFileSync(process.argv[1],"utf8");
    const s=t.indexOf("{"), e=t.lastIndexOf("}");
    if(s<0||e<0){console.error("no json");process.exit(1)}
    const obj=JSON.parse(t.slice(s,e+1));
    if(!obj.asOf||!obj.budgetReality||!obj.regionHeat){console.error("schema incomplete");process.exit(1)}
    fs.writeFileSync("config/market-context.json", JSON.stringify(obj,null,2));
  ' "$TMP" 2>>"$LOG" && echo "[$(ts)] market-context.json 갱신 완료" >> "$LOG" || echo "[$(ts)] JSON 검증 실패 — 기존 컨텍스트 유지" >> "$LOG"
else
  echo "[$(ts)] claude -p 실패 — 기존 컨텍스트 유지" >> "$LOG"
fi
rm -f "$TMP"

# 자율 작업 보고(2026-08-05 지시) — 오늘의 시장 컨텍스트 갱신 결과를 텔레그램으로 보고
# 1~2줄 요약(2026-08-11 다이어트)
MSG=$(node -e '
  const c = JSON.parse(require("fs").readFileSync("config/market-context.json","utf8"));
  const fresh = c.asOf === process.argv[1];
  console.log(fresh
    ? `🤖 07:00 시장리서치 — 기준금리 ${c.rate?.base}%(${c.rate?.direction === "up" ? "인상" : c.rate?.direction === "down" ? "인하" : "동결"}) · 예산 ${(c.budgetReality?.comfortableCeilingManwon/10000).toFixed(1)}~${(c.budgetReality?.stretchCeilingManwon/10000).toFixed(1)}억 · 출처 ${c.sources?.length ?? 0}건\n${(c.regime ?? "").slice(0, 80)}`
    : "⚠️ 07:00 시장리서치 실패 — 기존(" + c.asOf + ") 유지");
' "$TODAY" 2>>"$LOG") && npx tsx scripts/notify-telegram.ts "$MSG" >> "$LOG" 2>&1 || true
