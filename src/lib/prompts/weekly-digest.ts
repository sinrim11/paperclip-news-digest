/**
 * Weekly digest prompt templates.
 * Synthesises 7 days of DailyDigests into a weekly briefing (Phase 4 full spec).
 */

import type { Category } from '../types';

export interface WeeklyInputDay {
  date: string;
  top3Titles: string[];
  categoryBriefings: Array<{ category: Category; summary: string }>;
  breakingTitles?: string[];
}

export interface WeeklyInputMarket {
  date: string;
  kospi?: string;
  kosdaq?: string;
  usdKrw?: string;
  wti?: string;
  us10y?: string;
  btcUsd?: string;
}

export function buildWeeklyPrompt(
  weekStart: string,
  weekEnd: string,
  days: WeeklyInputDay[],
  marketData?: WeeklyInputMarket[],
  activeTags?: string[],
): Array<{ role: 'system' | 'user'; content: string }> {
  const daysText = days
    .map((d) => {
      const breaking =
        d.breakingTitles?.length ? `🔴 속보: ${d.breakingTitles.join(' / ')}\n` : '';
      return (
        `### ${d.date}\n` +
        `TOP3: ${d.top3Titles.join(' / ')}\n` +
        breaking +
        d.categoryBriefings.map((cb) => `[${cb.category}] ${cb.summary}`).join('\n')
      );
    })
    .join('\n\n');

  const marketText = marketData?.length
    ? '\n## 7일간 마켓 데이터\n' +
      marketData
        .map(
          (m) =>
            `${m.date}: KOSPI ${m.kospi ?? '-'}  KOSDAQ ${m.kosdaq ?? '-'}  USD/KRW ${m.usdKrw ?? '-'}  WTI ${m.wti ?? '-'}  US10Y ${m.us10y ?? '-'}  BTC ${m.btcUsd ?? '-'}`,
        )
        .join('\n')
    : '';

  const tagsText = activeTags?.length
    ? `\n## 활성 맥락 태그\n${activeTags.join(', ')}`
    : '';

  return [
    {
      role: 'system',
      content: `당신은 수석 전략 애널리스트입니다.
1주일간의 뉴스를 종합 분석하여 주간 브리핑을 작성합니다.
독자는 IT업계 시니어 개발자이면서 적극적 투자자입니다.
반드시 순수 JSON으로만 응답하세요. 마크다운이나 추가 설명 없이 JSON만 출력하세요.`,
    },
    {
      role: 'user',
      content: `주간 브리핑 기간: ${weekStart} ~ ${weekEnd}

## 7일간 일일 브리핑 요약

${daysText}
${marketText}
${tagsText}

## 작업 지시

위 데이터를 분석하여 주간 리포트를 작성하세요.

출력 JSON 스키마 (순수 JSON, 마크다운 없이):
{
  "weekStart": "${weekStart}",
  "weekEnd": "${weekEnd}",
  "executive_summary": "주간 총괄 5~7문장 (핵심 이벤트, 마켓 방향성, 미결 이슈)",
  "market_weekly": {
    "summary": "주간 마켓 총평 2~3문장",
    "kospi": { "trend": "상승|하락|횡보", "comment": "한 줄 코멘트" },
    "usdKrw": { "trend": "강세|약세|횡보", "comment": "한 줄 코멘트" }
  },
  "category_summaries": [
    {
      "category": "카테고리명",
      "summary": "이번 주 해당 카테고리 3~4문장 총평",
      "progression": "주간 전개 과정 1~2문장",
      "highlight": "가장 임팩트 큰 뉴스 제목"
    }
  ],
  "weekly_top5": [
    {
      "rank": 1,
      "title": "뉴스 제목",
      "category": "카테고리",
      "fact": "팩트 1문장",
      "impact": "임팩트 1문장",
      "action": "액션 1문장",
      "weekly_progression": "이 이슈가 한 주간 어떻게 전개됐는지 1~2문장",
      "current_status": "진행중|해결|확대|소강"
    }
  ],
  "trend_analysis": {
    "new_issues": ["이번 주 새로 등장한 이슈들"],
    "escalated_issues": ["확대된 이슈들"],
    "resolved_issues": ["해결된 이슈들"],
    "sector_strength": { "섹터명": "강|중립|약" },
    "cross_category_chains": [
      { "chain": "카테고리A → 카테고리B", "description": "연쇄 영향 설명" }
    ]
  },
  "context_evolution": [
    {
      "tag": "맥락태그명",
      "weeklyCount": 0,
      "statusChange": "신규|지속|확대|소강|해결",
      "nextWeekOutlook": "다음 주 전망 1문장"
    }
  ],
  "next_week_watchlist": {
    "scheduled_events": [
      { "date": "YYYY-MM-DD", "event": "이벤트명", "impact": "예상 임팩트" }
    ],
    "ongoing_monitors": ["지속 모니터링 항목들"],
    "investment_checklist": ["투자 체크리스트 항목들"]
  },
  "headline": "이번 주 핵심 흐름을 한 문장으로",
  "categoryRecaps": [
    { "category": "카테고리명", "summary": "총평", "keyItems": ["핵심 뉴스1", "핵심 뉴스2"] }
  ],
  "topTrends": [
    { "tag": "트렌드태그", "count": 0, "description": "트렌드 설명" }
  ],
  "outlook": "다음 주 주목할 포인트 2~3문장"
}`,
    },
  ];
}
