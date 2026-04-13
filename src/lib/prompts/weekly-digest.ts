/**
 * Weekly digest prompt templates.
 * Synthesises 7 days of DailyDigests into a single weekly briefing.
 */

import type { Category } from '../types';

export interface WeeklyInputDay {
  date: string;
  top3Titles: string[];
  categoryBriefings: Array<{ category: Category; summary: string }>;
}

export function buildWeeklyPrompt(
  weekStart: string,
  weekEnd: string,
  days: WeeklyInputDay[],
): Array<{ role: 'system' | 'user'; content: string }> {
  const daysText = days
    .map(
      (d) =>
        `### ${d.date}\nTOP3: ${d.top3Titles.join(' / ')}\n${d.categoryBriefings.map((cb) => `[${cb.category}] ${cb.summary}`).join('\n')}`,
    )
    .join('\n\n');

  return [
    {
      role: 'system',
      content: `당신은 시니어 뉴스 에디터 겸 투자 애널리스트입니다.
한 주간의 뉴스 브리핑을 종합하여 주간 리포트를 작성합니다.
순수 JSON만 출력하세요.`,
    },
    {
      role: 'user',
      content: `주간 브리핑 기간: ${weekStart} ~ ${weekEnd}

## 7일간 일일 브리핑 요약

${daysText}

## 작업 지시

위 7일간 브리핑을 종합하여 주간 리포트를 작성하세요.

출력 형식 (순수 JSON):
{
  "weekStart": "${weekStart}",
  "weekEnd": "${weekEnd}",
  "headline": "이번 주 핵심 흐름을 한 문장으로",
  "categoryRecaps": [
    {
      "category": "카테고리명",
      "summary": "이번 주 해당 카테고리 3~4문장 총평",
      "keyItems": ["핵심 뉴스 제목 1", "핵심 뉴스 제목 2", "핵심 뉴스 제목 3"]
    }
  ],
  "topTrends": [
    {
      "tag": "트렌드 태그",
      "count": 0,
      "description": "이 트렌드가 왜 반복됐는지 1~2문장"
    }
  ],
  "outlook": "다음 주 주목할 포인트 2~3문장"
}`,
    },
  ];
}
