#!/bin/zsh
# 공급 리스크 레이더 — 미분양·입주물량 월간 점검 (launchd: com.news-digest.supply-risk, 매월 1일 07:20)
# 하방 플래그의 외부 지표 확장(2026-08-11): 커버 경기 권역(남양주·안양·의왕)의
# 미분양 추이·향후 12개월 입주물량을 공식 통계 보도 기준으로 수집 → config/supply-risk.json.
# riskLevel=high 지역은 추천 엔진 하방 플래그 1개로 계상(2개 이상이면 제외 — 기존 임계 유지).
set -uo pipefail
cd /Users/sklee01/news-digest
export PATH="/Users/sklee01/.local/bin:/opt/homebrew/bin:$PATH"
LOG="output/supply_risk.log"
ts() { date '+%Y-%m-%d %H:%M:%S'; }

set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a

if [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  export ANTHROPIC_AUTH_TOKEN="$(zsh -ic 'print -rn -- ${ANTHROPIC_AUTH_TOKEN:-}' 2>/dev/null)"
fi
if [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  echo "[$(ts)] ANTHROPIC_AUTH_TOKEN 없음 — 건너뜀(기존 데이터 유지)" >> "$LOG"
  exit 0
fi

TODAY=$(TZ=Asia/Seoul date +%F)
TMP="output/supply-risk-${TODAY}.json"

read -r -d '' PROMPT <<EOF || true
너는 한국 부동산 공급 분석가다. 웹서치로 오늘(${TODAY}) 기준 아래 지역의
① 최신 미분양 주택 수와 전월 대비 추이 ② 향후 12개월 아파트 입주(예정) 물량을 조사하라.
대상 지역: 남양주시, 안양시, 의왕시. (서울 자치구는 미분양이 미미해 제외)

시군별 수치가 공개되는 곳(우선 확인): 경기부동산포털(gris.gg.go.kr)의 미분양주택 현황,
국토교통 통계누리(stat.molit.go.kr), 경기도청 보도자료, "경기 시군별 미분양"·"남양주 미분양"·
"남양주 입주물량 2026 2027" 류의 지역 언론 보도. 아파트투유·부동산R114·직방 입주물량 집계 보도도 허용.

다음 JSON 스키마로만 응답하라(설명·마크다운·코드펜스 없이 순수 JSON 하나만):
{
  "asOf": "${TODAY}",
  "regions": [
    {
      "region": "남양주시",
      "unsold": {"count": 숫자|null, "trend": "증가|감소|보합|미상", "asOfMonth": "YYYY-MM"|null},
      "supply12m": {"units": 숫자|null, "note": "주요 입주 단지·시기 요약(확인된 것만)"},
      "riskLevel": "low|mid|high",
      "note": "판정 근거 한 줄 — 미확인 항목은 '미확인'으로 명시",
      "sourceUrls": ["실제 기사/통계 URL"]
    }
  ],
  "sources": [{"title": "출처 '제목' (날짜)", "url": "URL"}]
}
규칙: 세 지역 모두 결과에 포함하라. 미분양·입주물량 중 하나라도 수치로 확인되면 그 수치를 쓰고,
확인 안 된 항목만 null로 두라(수치 지어내기 절대 금지 — null이 낫다). 둘 다 null이면 riskLevel은 "low"가
아니라 확인된 정성 근거(미분양관리지역 지정 여부 등)로 보수적으로 판정하고 note에 한계를 명시하라.
riskLevel 판정: 미분양 증가 추세 + 입주물량 부담이면 high, 둘 중 하나면 mid, 둘 다 아니면 low.
각 지역 sourceUrls는 실제 접속 가능한 URL 1개 이상 필수.
EOF

echo "[$(ts)] 공급 리스크 점검 시작" >> "$LOG"
SR_OK=false
for attempt in 1 2; do
  if echo "$PROMPT" | claude -p --model sonnet --allowedTools "WebSearch WebFetch" > "$TMP" 2>>"$LOG" && [ -s "$TMP" ]; then
    SR_OK=true; break
  fi
  [ "$attempt" = "1" ] && { echo "[$(ts)] claude -p 1차 실패 — 60초 후 재시도" >> "$LOG"; sleep 60; }
done

if $SR_OK; then
  MSG=$(node -e '
    const fs = require("fs");
    let t = fs.readFileSync(process.argv[1], "utf8");
    const s = t.indexOf("{"), e = t.lastIndexOf("}");
    if (s < 0 || e < 0) { console.error("no json"); process.exit(1); }
    const obj = JSON.parse(t.slice(s, e + 1));
    const valid = (obj.regions ?? []).filter((r) => r.region && ["low","mid","high"].includes(r.riskLevel) && Array.isArray(r.sourceUrls) && r.sourceUrls.length > 0);
    if (!valid.length) { console.error("no valid regions"); process.exit(1); }
    fs.writeFileSync("config/supply-risk.json", JSON.stringify({ ...obj, regions: valid }, null, 2) + "\n");
    const lines = valid.map((r) => {
      const lv = r.riskLevel === "high" ? "🔴 high" : r.riskLevel === "mid" ? "🟡 mid" : "🟢 low";
      return `· ${r.region}: ${lv} — 미분양 ${r.unsold?.count ?? "?"}세대(${r.unsold?.trend ?? "?"}, ${r.unsold?.asOfMonth ?? ""}) · 12개월 입주 ${r.supply12m?.units?.toLocaleString?.() ?? "?"}세대\n  ${r.note ?? ""}`;
    });
    console.log(["🏗️ 공급 리스크 월간 점검 (" + obj.asOf + ")", ...lines, "", "high 지역은 추천 하방 플래그에 자동 반영됩니다 (출처 " + (obj.sources?.length ?? 0) + "건)"].join("\n"));
  ' "$TMP" 2>>"$LOG") && {
    echo "[$(ts)] supply-risk.json 갱신 완료" >> "$LOG"
    npx tsx scripts/notify-telegram.ts "$MSG" >> "$LOG" 2>&1 || true
    rm -f "$TMP"
  } || {
    # 원본 보존 — 스키마 불일치 원인 추적용(2026-08-11)
    mv "$TMP" "output/supply-risk-failed-${TODAY}.json" 2>/dev/null || true
    echo "[$(ts)] JSON 검증 실패 — 기존 데이터 유지 (원본: output/supply-risk-failed-${TODAY}.json)" >> "$LOG"
    npx tsx scripts/notify-telegram.ts "⚠️ 공급 리스크 점검(${TODAY}) — 결과 검증 실패, 기존 데이터 유지" >> "$LOG" 2>&1 || true
  }
else
  echo "[$(ts)] claude -p 실패 — 기존 데이터 유지" >> "$LOG"
  npx tsx scripts/notify-telegram.ts "⚠️ 공급 리스크 점검(${TODAY}) — 리서치 실패, 기존 데이터 유지" >> "$LOG" 2>&1 || true
  rm -f "$TMP"
fi
