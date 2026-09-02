#!/bin/zsh
# 정책 레이더 — 헤드리스 Claude(claude -p + 웹서치)로 부동산 정책·대출 규제 파라미터를
# 정부 공식 소스와 매일 대조·검증하고, 변경 시 policy-params.json을 자동 갱신한다.
# (launchd: com.news-digest.policy-refresh, 매일 06:45 — 07:00 시장리서치·08:30 추천 이전)
#
# 산출: config/policy-params.json 갱신(검증 통과 시) + config/policy-check-log.json 이력
#       + 규제지역 변경은 config/proposals/ 제안 저장(자동 반영 금지 — 추천 합법성 게이트)
# 방어: apply-policy-patches.mjs 가 경로·현재값 일치·허용범위 3중 검증. 실패 시 기존 유지.
set -uo pipefail
cd /Users/sklee01/news-digest
export PATH="/Users/sklee01/.local/bin:/opt/homebrew/bin:$PATH"
LOG="output/policy_refresh.log"
ts() { date '+%Y-%m-%d %H:%M:%S'; }

set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a

if [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  export ANTHROPIC_AUTH_TOKEN="$(zsh -ic 'print -rn -- ${ANTHROPIC_AUTH_TOKEN:-}' 2>/dev/null)"
fi
if [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  echo "[$(ts)] ANTHROPIC_AUTH_TOKEN 없음 — 정책 레이더 건너뜀(기존 파라미터 유지)" >> "$LOG"
  npx tsx scripts/notify-telegram.ts "⚠️ 정책 레이더 — 인증 토큰 없음으로 오늘 점검을 건너뜀 (기존 정책 파라미터 유지)" >> "$LOG" 2>&1 || true
  exit 0
fi

TODAY=$(TZ=Asia/Seoul date +%F)
TMP="output/policy-radar-${TODAY}.json"
CURRENT_PARAMS=$(cat config/policy-params.json)
CURRENT_REGIONS=$(node -e '
  const r = JSON.parse(require("fs").readFileSync("config/region-regulation.json","utf8"));
  console.log(JSON.stringify(r.groups.map(g => ({name: g.name, regions: g.regions, status: g.regulation.status, landPermitUntil: g.regulation.landPermitUntil ?? null}))));
')

read -r -d '' PROMPT <<EOF || true
너는 한국 부동산 정책 검증 애널리스트다. 웹서치로 오늘(${TODAY}) 기준 아래 시스템이 사용 중인
부동산 대출·규제 파라미터가 여전히 유효한지 정부 공식 소스(국토교통부·금융위원회·한국은행·대한민국
정책브리핑 korea.kr·서울부동산정보광장) 위주로 검증하라. 언론 보도는 보조 근거로만 사용.

[현재 시스템 파라미터 — config/policy-params.json]
${CURRENT_PARAMS}

[현재 규제지역 테이블 요약 — config/region-regulation.json]
${CURRENT_REGIONS}

점검 필수 항목:
1. 규제지역 LTV(일반 무주택 40%·생애최초 70%·비규제 70%)가 유지되는가
2. 가격구간별 주담대 한도(15억↓ 6억 / 25억↓ 4억 / 초과 2억)가 유지되는가
3. 스트레스 DSR 단계·가산금리(규제 1.5%p·기타 0.75%p)와 DSR 40% 규칙이 유지되는가
4. 한은 기준금리 현재값 — dsr.assumedBaseRatePct(현재 ${TODAY} 기준 파일값)와 실제 시중 주담대 금리 괴리 여부
5. 토지거래허가구역: 전입의무 4개월·실거주 2년이 유지되는가, 지정 기한 연장·해제 발표 여부
6. 규제지역·토허구역 목록 변경(신규 지정/해제) — 특히 서울 25구, 경기(안양 동안/만안·의왕·남양주 등)
7. 생애최초·신생아특례 등 정책대출 조건 변경, 세제개편 등 새 대책 발표 여부
8. **정책대출 상세(카드뉴스가 소비 — 주택도시기금 공식 기준으로 확인)**:
   - 디딤돌: 금리 2.85~4.15% · 생애최초 한도 2.4억 · 대상 주택가 5억 이하 · 소득 7천만원 이하(생애최초)
   - 신생아 특례 디딤돌: 금리 1.8~4.5% · 한도 4억 · 대상 주택가 9억 이하 · 소득 1.3억(맞벌이 2억)
   위 값이 바뀌었으면 checks에 status=changed로 적고, 무엇이 얼마로 바뀌었는지 latest에 명시하라.
   (이 항목들은 config/policy-loans.json이 소비하며 자동 반영이 아니라 사람이 확인 후 갱신한다)

다음 JSON 스키마로만 응답하라(설명·마크다운·코드펜스 없이 순수 JSON 객체 하나만 출력):
{
  "asOf": "${TODAY}",
  "changed": true|false,
  "summary": "오늘 점검 결과 한 줄 요약",
  "checks": [{"item": "점검 항목명", "current": "시스템 현재값", "latest": "확인된 최신 사실", "status": "unchanged|changed|unverifiable", "sourceUrl": "근거 URL"}],
  "paramPatches": [{"path": "dsr.assumedBaseRatePct", "old": 4.5, "new": 4.75, "reason": "변경 사유", "sourceUrl": "근거 URL"}],
  "regionChanges": [{"region": "지역명", "from": "regulated|non-regulated", "to": "regulated|non-regulated", "reason": "사유", "sourceUrl": "근거 URL"}],
  "sources": [{"title": "매체/기관 '제목' (날짜)", "url": "실제 URL"}]
}
**출처 등급(2026-09-01 사용자 지침 — 위반 시 그 패치는 무효)**
paramPatches의 sourceUrl은 반드시 1차 출처여야 한다: 금융위(fsc.go.kr) · 국토부(molit.go.kr) · 주택도시기금(nhuf.molit.go.kr) · 정책브리핑(korea.kr)의 보도자료/공식 안내 원문.
언론기사·은행 설명페이지·블로그는 **찾는 단서로만** 쓰고 근거로 삼지 마라. 기사만 있고 원문을 못 찾았으면 paramPatches에 넣지 말고 checks에 status=unverifiable로 남겨라.
reason에는 원문 문장을 짧게 인용하라(예: "스트레스 금리 하한을 수도권·규제지역내 주담대에 한해 3%로 상향").
이 규칙이 생긴 이유: 2026-08~09에 기사 근거 패치가 원문 근거 값을 뒤집어 두 달간 5회 진동했고, 이력에 URL이 없어 사후에 무엇이 옳았는지 가릴 수 없었다.

config/policy-params.json의 _frozenPaths 에 있는 경로는 동결돼 자동 적용되지 않는다. 변경이 필요하다고 판단되면 paramPatches에 넣되(스킵되고 알림만 감) reason에 1차 출처 인용을 반드시 붙여라 — 사람이 그것만 보고 판단한다.

paramPatches는 공식 소스로 확정된 변경만 넣어라(추측·전망 금지 — 발표만 되고 시행 전이면 checks에만 기록).
old는 반드시 현재 파일의 값과 정확히 일치해야 한다. 변경이 없으면 paramPatches·regionChanges는 빈 배열.
EOF

echo "[$(ts)] 정책 레이더 시작" >> "$LOG"
# claude -p 일시 실패 재시도(2026-08-11 — 8/7·8/8 즉시 실패 이력) — 1회 재시도, 60초 간격
RADAR_OK=false
for attempt in 1 2; do
  if echo "$PROMPT" | claude -p --model sonnet --allowedTools "WebSearch WebFetch" > "$TMP" 2>>"$LOG" && [ -s "$TMP" ]; then
    RADAR_OK=true; break
  fi
  [ "$attempt" = "1" ] && { echo "[$(ts)] claude -p 1차 실패 — 60초 후 재시도" >> "$LOG"; sleep 60; }
done
if $RADAR_OK; then
  MSG=$(node scripts/apply-policy-patches.mjs "$TMP" 2>>"$LOG")
  echo "[$(ts)] 정책 레이더 완료" >> "$LOG"
  echo "$MSG" >> "$LOG"
  npx tsx scripts/notify-telegram.ts "$MSG" >> "$LOG" 2>&1 || true
else
  echo "[$(ts)] claude -p 실패 — 기존 파라미터 유지" >> "$LOG"
  npx tsx scripts/notify-telegram.ts "⚠️ 정책 레이더 (${TODAY}) — 리서치 실패, 기존 정책 파라미터 유지 (output/policy_refresh.log 확인)" >> "$LOG" 2>&1 || true
fi
rm -f "$TMP"
