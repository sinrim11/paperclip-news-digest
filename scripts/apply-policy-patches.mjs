/**
 * scripts/apply-policy-patches.mjs — 정책 레이더 결과 검증·적용기.
 * policy-refresh.sh가 claude -p 리서치 결과(JSON)를 넘기면:
 *   1. 스키마·값 범위 검증 (미통과 패치는 전부 거부 — 부분 적용 없음)
 *   2. paramPatches → config/policy-params.json 에 경로 단위 적용 (백업 후)
 *   3. regionChanges → 자동 적용 금지(추천 합법성 게이트) — config/proposals/ 에 제안 저장
 *   4. config/policy-check-log.json 에 점검 이력 기록
 *   5. stdout 으로 텔레그램 보고 본문 출력
 *
 * 사용: node scripts/apply-policy-patches.mjs <radar-result.json>
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PARAMS_PATH = 'config/policy-params.json';
const CHECK_LOG_PATH = 'config/policy-check-log.json';

// 알려진 파라미터의 허용 범위 — LLM 환각으로 인한 파괴적 값 방지
const RANGES = {
  'ltv.regulatedBase': [0.1, 1],
  'ltv.firstTimeBonus': [0, 0.6],
  'ltv.nonRegulated': [0.1, 1],
  'dsr.ratio': [0.1, 1],
  'dsr.stressAddPctRegulated': [0, 5],
  'dsr.stressAddPctOther': [0, 5],
  'dsr.assumedBaseRatePct': [0, 15],
  'dsr.termYears': [10, 50],
  'creditLine.dsrTermYears': [1, 30],
  'creditLine.dsrRatePct': [0, 20],
  'landPermitZone.moveInMonths': [1, 24],
  'landPermitZone.residenceYears': [0, 10],
};

// 1차 출처 화이트리스트(2026-09-01 사용자 지침) — 파라미터 자동 반영은 정부 원문 근거만 허용.
// 프롬프트로만 요구하면 지켜진다는 보장이 없어 검증기에서 강제한다. 기사 근거 패치가 원문
// 근거 값을 뒤집어 두 달간 5회 진동한 전례가 있다(config/policy-params.json _correction20260901).
const PRIMARY_HOSTS = ['fsc.go.kr', 'molit.go.kr', 'korea.kr', 'nhuf.molit.go.kr', 'fss.or.kr', 'bok.or.kr'];
function isPrimarySource(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return PRIMARY_HOSTS.some((d) => h === d || h.endsWith('.' + d));
  } catch {
    return false;
  }
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys[keys.length - 1]] = value;
}

const resultFile = process.argv[2];
if (!resultFile) {
  console.error('usage: node scripts/apply-policy-patches.mjs <radar-result.json>');
  process.exit(1);
}

let radar;
try {
  const raw = readFileSync(resultFile, 'utf8');
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  radar = JSON.parse(raw.slice(s, e + 1));
} catch (err) {
  console.log(`⚠️ 정책 레이더 — 리서치 결과 파싱 실패(${String(err).slice(0, 80)}). 기존 정책 파라미터 유지.`);
  process.exit(0);
}

const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const lines = [];
const params = JSON.parse(readFileSync(PARAMS_PATH, 'utf8'));

// ── 1. 파라미터 패치 검증 ──────────────────────────────────────────────────
const patches = Array.isArray(radar.paramPatches) ? radar.paramPatches : [];
const valid = [];
const rejected = [];
const skippedFrozen = [];
// 동결 경로(2026-09-01) — 1차 출처로 확정한 값은 자동 갱신에서 제외한다.
// 두 DSR 키는 두 달간 5번 뒤집혔다(7/4 1.5 · 8/6 3 · 8/26 3 · 8/29 1.5 · 8/31 3).
// 금융위 원문으로 확인한 결과 3.0이 맞다("스트레스 금리 하한을 수도권·규제지역내 주담대에
// 한해 3%로 상향", 10·15 대책·10.16 행정지도) — 7/4·8/29의 1.5가 오류였다.
// 문제는 어느 쪽이 옳았느냐가 아니라, 이력에 근거 URL이 없어 다섯 번의 변경 중 무엇이
// 맞는지 사후에 가릴 수 없었다는 것이다. 그래서 값을 원문에 고정하고 근거를 남긴다.
// 동결 위반은 rejected가 아니라 skipped로 분류한다 — 적용 게이트가 all-or-nothing이라
// rejected에 넣으면 같은 회차의 무관한 정상 패치까지 영구히 막힌다.
const frozenPaths = new Set(Array.isArray(params._frozenPaths) ? params._frozenPaths : []);
for (const p of patches) {
  if (p && typeof p.path === 'string' && frozenPaths.has(p.path)) {
    skippedFrozen.push(`${p.path} (${p.old ?? '?'}→${p.new ?? '?'}) — 동결됨, 사람 확인 필요`);
    continue;
  }
  if (!p || typeof p.path !== 'string' || typeof p.new !== 'number' || !p.sourceUrl) {
    rejected.push(`${p?.path ?? '?'} — 형식 불량`);
    continue;
  }
  const cur = getPath(params, p.path);
  if (typeof cur !== 'number') {
    rejected.push(`${p.path} — 현재 파일에 없는 경로`);
    continue;
  }
  if (typeof p.old === 'number' && Math.abs(cur - p.old) > 1e-9) {
    rejected.push(`${p.path} — old(${p.old})가 현재값(${cur})과 불일치(드리프트 가드)`);
    continue;
  }
  if (!isPrimarySource(p.sourceUrl)) {
    rejected.push(`${p.path} — 1차 출처 아님(${p.sourceUrl}) · 허용: ${PRIMARY_HOSTS.join(', ')}`);
    continue;
  }
  const range = RANGES[p.path];
  if (range && (p.new < range[0] || p.new > range[1])) {
    rejected.push(`${p.path} — 신규값 ${p.new} 허용범위(${range[0]}~${range[1]}) 밖`);
    continue;
  }
  if (!range && !p.path.startsWith('loanCapByPrice')) {
    rejected.push(`${p.path} — 미등록 경로(허용 목록 밖, 수동 확인 필요)`);
    continue;
  }
  valid.push(p);
}

// ── 2. 적용 (전부 유효할 때만 — 부분 적용은 정합성 위험) ────────────────────
if (valid.length > 0 && rejected.length === 0) {
  mkdirSync('config/backup', { recursive: true });
  writeFileSync(join('config/backup', `policy-params-${today}.json`), JSON.stringify(params, null, 2));
  for (const p of valid) setPath(params, p.path, p.new);
  params.asOf = today;
  params['_autoUpdate' + today.replace(/-/g, '')] =
    `정책 레이더 자동 갱신: ${valid.map((p) => `${p.path} ${p.old}→${p.new}`).join(', ')}`;
  writeFileSync(PARAMS_PATH, JSON.stringify(params, null, 2) + '\n');
  lines.push(`✅ 정책 파라미터 ${valid.length}건 자동 갱신 (백업: config/backup/policy-params-${today}.json)`);
  for (const p of valid) lines.push(`   · ${p.path}: ${p.old} → ${p.new}\n     └ ${p.reason ?? ''} ${p.sourceUrl}`);
} else if (valid.length > 0 && rejected.length > 0) {
  lines.push(`⚠️ 패치 ${valid.length}건 유효하나 ${rejected.length}건 검증 실패 → 전체 보류(부분 적용 금지)`);
  for (const r of rejected) lines.push(`   · ✗ ${r}`);
} else if (rejected.length > 0) {
  // patches.length가 아니라 rejected.length로 판정한다 — 동결 스킵만 있는 회차에
  // "검증 실패"로 잘못 표시되던 문제(2026-09-01).
  lines.push(`⚠️ 제안된 패치 ${rejected.length}건 검증 실패 — 적용 안 함`);
  for (const r of rejected) lines.push(`   · ✗ ${r}`);
}

if (skippedFrozen.length > 0) {
  lines.push(`🔒 동결 경로 패치 ${skippedFrozen.length}건 건너뜀 — 1차 출처 확인 후 사람이 갱신:`);
  for (const f of skippedFrozen) lines.push(`   · ${f}`);
}

// ── 3. 규제지역 변경 — 자동 적용 금지, 제안 파일 + 알림 ─────────────────────
const regionChanges = Array.isArray(radar.regionChanges) ? radar.regionChanges : [];
if (regionChanges.length > 0) {
  mkdirSync('config/proposals', { recursive: true });
  const proposalPath = join('config/proposals', `region-regulation-${today}.json`);
  writeFileSync(proposalPath, JSON.stringify({ date: today, changes: regionChanges, sources: radar.sources ?? [] }, null, 2));
  lines.push(`🚨 규제지역 변경 감지 ${regionChanges.length}건 — 추천 합법성에 직결되어 자동 반영하지 않음. 확인 후 config/region-regulation.json 갱신 필요:`);
  for (const c of regionChanges) lines.push(`   · ${c.region}: ${c.from} → ${c.to} (${c.reason ?? ''})\n     └ ${c.sourceUrl ?? ''}`);
  lines.push(`   제안 저장: ${proposalPath}`);
}

// ── 3b. 정책대출(카드뉴스 소비) 변경 알림 — 자동 반영 없이 사람에게 갱신 요청 ──
// policy-loans.json은 주택도시기금 공식 페이지 원문만 담는 파일이라, LLM 판단으로 덮어쓰지 않는다.
const loanKeywords = /디딤돌|신생아|정책대출|버팀목/;
const loanChanges = (radar.checks ?? []).filter((c) => c.status === 'changed' && loanKeywords.test(String(c.item ?? '') + String(c.latest ?? '')));
if (loanChanges.length > 0) {
  lines.push(`💳 정책대출 조건 변경 감지 ${loanChanges.length}건 — config/policy-loans.json 갱신 필요(카드뉴스 자금계획이 이 값을 씁니다):`);
  for (const c of loanChanges) lines.push(`   · ${c.item}: ${c.current ?? '?'} → ${c.latest ?? '?'}\n     └ ${c.sourceUrl ?? ''}`);
}

// ── 4. 점검 이력 기록 ───────────────────────────────────────────────────────
let checkLog = [];
if (existsSync(CHECK_LOG_PATH)) {
  try { checkLog = JSON.parse(readFileSync(CHECK_LOG_PATH, 'utf8')); } catch { checkLog = []; }
}
checkLog.unshift({
  date: today,
  changed: valid.length > 0 || regionChanges.length > 0,
  applied: valid.length > 0 && rejected.length === 0 ? valid.length : 0,
  regionAlerts: regionChanges.length,
  // 근거를 남긴다(2026-09-01) — 종전엔 URL을 저장하지 않아 "원문 확인했다"는 주장을
  // 나중에 검증할 수 없었고, 그래서 어느 회차가 옳았는지 가릴 수 없었다.
  patches: patches.map((p) => ({ path: p?.path, old: p?.old, new: p?.new, sourceUrl: p?.sourceUrl ?? null })),
  skippedFrozen,
  sources: radar.sources ?? [],
  summary: radar.summary ?? '',
  checks: (radar.checks ?? []).map((c) => `${c.item}: ${c.status}`),
});
writeFileSync(CHECK_LOG_PATH, JSON.stringify(checkLog.slice(0, 60), null, 2) + '\n');

// ── 5. 텔레그램 보고 본문 — 변경 없음이면 1줄(2026-08-11 다이어트), 변경 시에만 상세 ──
const checks = Array.isArray(radar.checks) ? radar.checks : [];
const unchanged = checks.filter((c) => c.status === 'unchanged').length;
// 거부·동결 스킵도 반드시 알린다(2026-09-01). 종전엔 조건이 valid/region/loan뿐이라
// 패치가 전부 거부되거나 동결로 스킵되면 "변경 없음" 한 줄만 나가고 사유가 사라졌다 —
// 레이더가 무언가를 바꾸려 했다는 사실 자체가 사람이 알아야 할 신호다.
if (valid.length > 0 || regionChanges.length > 0 || loanChanges.length > 0 || rejected.length > 0 || skippedFrozen.length > 0) {
  const header =
    valid.length > 0 || regionChanges.length > 0 || loanChanges.length > 0
      ? `🏛️ 정책 레이더 (${today}) — 변경 감지`
      : `🏛️ 정책 레이더 (${today}) — 시도된 변경을 막았습니다(적용 0건)`;
  console.log(
    [
      header,
      ...(radar.summary ? [`· ${radar.summary}`] : []),
      ...lines,
    ].join('\n'),
  );
} else {
  console.log(`🏛️ 06:45 정책 점검 — 변경 없음 (${checks.length}항목·출처 ${radar.sources?.length ?? 0}건)`);
}
