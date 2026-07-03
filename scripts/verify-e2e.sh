#!/bin/zsh
# 전 구간 동작 검증: LM Studio 인증 → DB → 웹 → 다이제스트 생성 → 조회 API
# 사용: scripts/verify-e2e.sh          (오늘 다이제스트가 이미 있으면 생성은 즉시 반환)
#       scripts/verify-e2e.sh --force  (오늘 다이제스트 강제 재생성 — 수 분 소요)
set -uo pipefail
cd "$(dirname "$0")/.."

set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a

PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TODAY=$(TZ=Asia/Seoul date +%F)

echo "── [1/6] LM Studio 인증 (localhost:1234)"
MODEL=$(curl -s -m 5 -H "Authorization: Bearer ${LLM_API_KEY:-}" http://localhost:1234/v1/models \
  | grep -o '"id"[^,]*' | head -1)
[ -n "$MODEL" ] && ok "모델 응답: $MODEL" || bad "응답 없음/401 — .env의 LLM_API_KEY 확인"

echo "── [2/6] PostgreSQL (native @5432)"
CNT=$(psql -h localhost -p 5432 -d news_digest -Atc 'SELECT count(*) FROM "DailyDigest";' 2>/dev/null)
[ -n "$CNT" ] && ok "접속 OK — DailyDigest ${CNT}건" || bad "DB 접속 실패 (brew services list | grep postgres)"

echo "── [3/6] 웹 서버 (localhost:3200)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 8 http://localhost:3200/ 2>/dev/null)
[ "$CODE" = "200" ] && ok "HTTP 200" \
  || bad "HTTP ${CODE:-없음} — launchctl kickstart -k gui/$(id -u)/com.news-digest.web"

echo "── [4/6] 오늘(${TODAY}) 다이제스트 생성 트리거"
AUTH=()
[ -n "${CRON_SECRET:-}" ] && AUTH=(-H "Authorization: Bearer ${CRON_SECRET}")
if [ "${1:-}" = "--force" ]; then
  RESP=$(curl -s -m 2700 -X POST http://localhost:3200/api/digest/generate \
    -H 'Content-Type: application/json' -d "{\"date\":\"${TODAY}\",\"force\":true}")
else
  RESP=$(curl -s -m 2700 -X POST "${AUTH[@]}" http://localhost:3200/api/cron/daily)
fi
echo "$RESP" | grep -q digestId && ok "응답: $(echo "$RESP" | head -c 150)" \
  || bad "생성 실패: $(echo "$RESP" | head -c 250)"

echo "── [5/6] DB 저장 결과 (${TODAY})"
psql -h localhost -p 5432 -d news_digest -Atc \
  "SELECT n.category || ': ' || count(*) || '건' FROM \"NewsItem\" n
   JOIN \"DailyDigest\" d ON d.id = n.\"digestId\"
   WHERE d.date = DATE '${TODAY}' GROUP BY n.category ORDER BY n.category;" 2>/dev/null \
  | sed 's/^/     /'
ITEMS=$(psql -h localhost -p 5432 -d news_digest -Atc \
  "SELECT count(*) FROM \"NewsItem\" n JOIN \"DailyDigest\" d ON d.id = n.\"digestId\"
   WHERE d.date = DATE '${TODAY}';" 2>/dev/null)
[ "${ITEMS:-0}" -gt 0 ] && ok "NewsItem ${ITEMS}건 저장됨" || bad "오늘 NewsItem 0건"

echo "── [6/6] 조회 API"
API=$(curl -s -m 8 "http://localhost:3200/api/digest/${TODAY}" | head -c 200)
echo "$API" | grep -q '"' && ok "GET /api/digest/${TODAY} 응답 OK" || bad "조회 API 무응답"

echo ""
echo "결과: ✅ ${PASS}  ❌ ${FAIL}"
[ "$FAIL" -eq 0 ] && echo "→ 대시보드: http://localhost:3200"
exit $FAIL
