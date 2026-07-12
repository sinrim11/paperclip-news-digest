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

echo "── [1/10] LM Studio 인증 (localhost:1234)"
MODEL=$(curl -s -m 5 -H "Authorization: Bearer ${LLM_API_KEY:-}" http://localhost:1234/v1/models \
  | grep -o '"id"[^,]*' | head -1)
[ -n "$MODEL" ] && ok "모델 응답: $MODEL" || bad "응답 없음/401 — .env의 LLM_API_KEY 확인"

echo "── [2/10] PostgreSQL (native @5432)"
CNT=$(psql -h localhost -p 5432 -d news_digest -Atc 'SELECT count(*) FROM "DailyDigest";' 2>/dev/null)
[ -n "$CNT" ] && ok "접속 OK — DailyDigest ${CNT}건" || bad "DB 접속 실패 (brew services list | grep postgres)"

echo "── [3/10] 웹 서버 (localhost:3200)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 8 http://localhost:3200/ 2>/dev/null)
[ "$CODE" = "200" ] && ok "HTTP 200" \
  || bad "HTTP ${CODE:-없음} — launchctl kickstart -k gui/$(id -u)/com.news-digest.web"

echo "── [4/10] 오늘(${TODAY}) 다이제스트 생성 트리거"
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

echo "── [5/10] DB 저장 결과 (${TODAY})"
psql -h localhost -p 5432 -d news_digest -Atc \
  "SELECT n.category || ': ' || count(*) || '건' FROM \"NewsItem\" n
   JOIN \"DailyDigest\" d ON d.id = n.\"digestId\"
   WHERE d.date = DATE '${TODAY}' GROUP BY n.category ORDER BY n.category;" 2>/dev/null \
  | sed 's/^/     /'
ITEMS=$(psql -h localhost -p 5432 -d news_digest -Atc \
  "SELECT count(*) FROM \"NewsItem\" n JOIN \"DailyDigest\" d ON d.id = n.\"digestId\"
   WHERE d.date = DATE '${TODAY}';" 2>/dev/null)
[ "${ITEMS:-0}" -gt 0 ] && ok "NewsItem ${ITEMS}건 저장됨" || bad "오늘 NewsItem 0건"

echo "── [6/10] 조회 API"
API=$(curl -s -m 8 "http://localhost:3200/api/digest/${TODAY}" | head -c 200)
echo "$API" | grep -q '"' && ok "GET /api/digest/${TODAY} 응답 OK" || bad "조회 API 무응답"

echo "── [7/10] 지역 규제 테이블 (region-regulation, 1-B-i)"
REG=$(npx tsx -e "
import { regulationOf, nonRegulatedGus } from './src/lib/region-regulation';
const a = regulationOf('관악구').status, b = regulationOf('안양 만안구').status, c = regulationOf('미등재구').status;
if (a === 'regulated' && b === 'non-regulated' && c === 'unverified') console.log('OK ' + [...nonRegulatedGus()].join(','));
" 2>/dev/null)
echo "$REG" | grep -q '^OK' && ok "규제 판정 정상 (비규제: ${REG#OK })" || bad "규제 테이블 로드/판정 실패"

echo "── [8/10] 네이버 스윕 요일 그룹 (1-B-ii/iii)"
SUN=$(npx tsx scripts/naver-sweep.ts --plan --group=sun 2>/dev/null | head -1 | grep -o '[0-9]*개 동' | head -1)
WED=$(npx tsx scripts/naver-sweep.ts --plan --group=wed 2>/dev/null | head -1 | grep -o '[0-9]*개 동' | head -1)
[ -n "$SUN" ] && [ -n "$WED" ] && ok "그룹 해석 OK — sun ${SUN} · wed ${WED}(남양주 포함)" || bad "스윕 그룹 해석 실패"
# DB 실커버리지 — 그룹에 등재된 구가 후보 테이블에 실제로 존재하는지 (gun 절단류 침묵 0-누락 감지)
COVER=$(python3 - <<'PY' 2>/dev/null
import json, subprocess
cfg = json.load(open('config/naver-sweep.json'))
expected = sorted({g for k in ('sun', 'wed') for g in cfg['groups'][k]})
out = subprocess.run(['psql', '-h', 'localhost', '-p', '5432', '-d', 'news_digest', '-Atc',
                      'SELECT DISTINCT gu FROM "ComplexCandidate";'], capture_output=True, text=True).stdout
have = set(out.split())
exempt = {'용산구', '성동구', '송파구'}  # 스윕 정상, 전량 예산 초과로 저장 0건 (2026-07-08 로그 검증)
missing = [g for g in expected if g not in have and g not in exempt]
print('OK ' + str(len(have)) + '개 구/시' if not missing else 'MISS ' + ','.join(missing))
PY
)
echo "$COVER" | grep -q '^OK' && ok "후보 커버리지 OK — ${COVER#OK }" || bad "후보 0건 구 발견(코드/수집 확인): ${COVER#MISS }"

echo "── [9/10] 일일 추천 엔진 (스트레치+·규제 라벨·호재, 1-A/2-A/2-B)"
RECO=$(npx tsx scripts/daily-recommend.ts --dry 2>/dev/null)
echo "$RECO" | grep -q '스트레치+' && echo "$RECO" | grep -q '🧾 규제:' \
  && ok "엔진 OK — $(echo "$RECO" | head -1 | sed 's/^\[daily-reco\] //')" \
  || bad "추천 엔진 출력에 스트레치+/규제 라벨 없음"

echo "── [10/10] 카드뉴스 인덱스 (3-A)"
CN=$(python3 -c "
import json
idx = json.load(open('output/cardnews/index.json'))
series = {s.get('series','price6') for s in idx[:5]}
print('OK' if idx else 'EMPTY', len(idx), '세트 ·', ','.join(sorted(series)))
" 2>/dev/null)
echo "$CN" | grep -q '^OK' && ok "인덱스 OK — ${CN#OK }" || bad "카드뉴스 인덱스 없음/파싱 실패"

echo ""
echo "결과: ✅ ${PASS}  ❌ ${FAIL}"
[ "$FAIL" -eq 0 ] && echo "→ 대시보드: http://localhost:3200"
exit $FAIL
