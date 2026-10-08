#!/bin/zsh
# news-digest 배포 — 타입검사 → 빌드 → 웹서버 재기동 → 반영 확인.
#
# 왜 있는가: CLAUDE.md에 "빌드 + 웹서버 재기동"이 규칙으로 적혀 있었는데도 이틀 연속 반쪽만
# 실행됐다. 2026-09-13은 빌드 자체를 빠뜨렸고(옛 프롬프트로 다이제스트 발행), 2026-09-15는
# 빌드는 했으나 재기동을 빠뜨려 **수집기 수정분 전체가 하루치 누락**됐다(web.log에 옛 로그
# 메시지가 그대로 찍혀 발각). 사람 기억에 의존하는 다단계 절차는 반드시 한쪽이 빠진다 →
# 한 명령으로 묶는다.
#
# Next 프로덕션 서버는 **기동 시점의 빌드를 메모리에 물고 있다.** `npm run build`는 .next를
# 갱신할 뿐 돌고 있는 프로세스를 바꾸지 않는다. 그래서 재기동이 선택이 아니라 필수다.
#
# 사용: ./scripts/deploy.sh
set -euo pipefail
cd /Users/sklee01/news-digest
export PATH="/opt/homebrew/bin:$PATH"

echo "[1/4] 타입 검사"
npx tsc --noEmit

echo "[2/4] 빌드"
npm run build

echo "[3/4] 웹서버 재기동"
BEFORE=$(wc -c < output/web.log 2>/dev/null || echo 0)
launchctl kickstart -k "gui/$(id -u)/com.news-digest.web"

echo "[4/4] 기동 확인"
for i in {1..30}; do
  if curl -sf -m 3 -o /dev/null http://localhost:3200/; then
    echo "  ✅ localhost:3200 응답 (${i}초)"
    break
  fi
  [ "$i" -eq 30 ] && { echo "  ❌ 30초 내 응답 없음 — output/web.log 확인"; exit 1; }
  sleep 1
done

# 새 프로세스가 붙었는지: 재기동 이후 로그가 실제로 쌓였는지로 본다.
AFTER=$(wc -c < output/web.log 2>/dev/null || echo 0)
echo "  web.log ${BEFORE} → ${AFTER}바이트"
echo
echo "완료. 수집 코드를 고쳤다면 다음 실행(daily 06:30) 로그에서 새 메시지 형식을 확인할 것:"
echo "  grep -E '\\[collector[^]]*\\] (DEAD|EMPTY)' output/web.log | tail"
echo "  (옛 형식 '[collector:pwc] fetch failed' 가 다시 보이면 이 스크립트가 안 돈 것이다)"
