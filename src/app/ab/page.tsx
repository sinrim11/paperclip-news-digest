'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface NewsItem {
  id: string;
  category: string;
  newsOrder: number;
  title: string;
  urgency: string;
  fact: string;
  impact: string;
  action: string;
  contextTags: string[];
  source: string;
  sourceUrl: string;
  isTop3: boolean;
}

interface Candidates {
  digestDate: string;
  personaName: string;
  snapshotA: NewsItem[];
  snapshotB: NewsItem[];
  scoresB: Record<string, number>;
}

interface HistoryEntry {
  id: string;
  evalDate: string;
  personaName: string;
  choice: string;
  rationale: string;
  createdAt: string;
}

interface Stats {
  total: number;
  aCount: number;
  bCount: number;
  consecutiveB: boolean;
}

const URGENCY_COLOR: Record<string, string> = {
  breaking: 'bg-red-100 text-red-700 border-red-200',
  watch: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  note: 'bg-blue-100 text-blue-700 border-blue-200',
};

const URGENCY_LABEL: Record<string, string> = {
  breaking: '🔴 속보',
  watch: '🟡 모니터',
  note: '🔵 참고',
};

const CAT_LABEL: Record<string, string> = {
  GLOBAL: '글로벌', STOCKS: '증권', AI: 'AI', POLICY: '정치', REALESTATE: '부동산',
};

function NewsCard({ item }: { item: NewsItem }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-2 bg-white hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
          {CAT_LABEL[item.category] ?? item.category}
        </span>
        <span className={`text-xs border rounded px-2 py-0.5 ${URGENCY_COLOR[item.urgency] ?? ''}`}>
          {URGENCY_LABEL[item.urgency] ?? item.urgency}
        </span>
      </div>
      <p className="font-semibold text-sm leading-snug">{item.title}</p>
      <p className="text-xs text-gray-600"><span className="font-medium text-gray-800">📌 팩트:</span> {item.fact}</p>
      <p className="text-xs text-gray-600"><span className="font-medium text-gray-800">💡 임팩트:</span> {item.impact}</p>
      <p className="text-xs text-gray-600"><span className="font-medium text-gray-800">🎯 액션:</span> {item.action}</p>
      {item.contextTags.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {item.contextTags.map((t) => (
            <span key={t} className="text-xs bg-gray-50 border border-gray-200 text-gray-500 rounded px-1.5">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

type Tab = 'eval' | 'history';

export default function ABPage() {
  const [tab, setTab] = useState<Tab>('eval');
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Evaluation state
  const [chosen, setChosen] = useState<'A' | 'B' | null>(null);
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [consecutiveB, setConsecutiveB] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // History state
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [histLoading, setHistLoading] = useState(false);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ab/candidates');
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? '데이터를 불러올 수 없습니다');
      }
      setCandidates(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류 발생');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const res = await fetch('/api/ab/history');
      const j = await res.json();
      setHistory(j.evals ?? []);
      setStats(j.stats ?? null);
    } finally {
      setHistLoading(false);
    }
  }, []);

  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, loadHistory]);

  const handleSubmit = async () => {
    if (!chosen) return;
    if (rationale.trim().length < 10) {
      setSubmitError('이유를 최소 10자 이상 입력해주세요');
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/ab/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          choice: chosen,
          rationale,
          personaName: candidates?.personaName,
          evalDate: candidates?.digestDate,
          snapshotA: candidates?.snapshotA,
          snapshotB: candidates?.snapshotB,
          scoresB: candidates?.scoresB,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? '제출 실패');
      setConsecutiveB(j.consecutiveB ?? false);
      setSubmitted(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : '오류 발생');
    } finally {
      setSubmitting(false);
    }
  };

  const resetEval = () => {
    setChosen(null);
    setRationale('');
    setSubmitted(false);
    setSubmitError(null);
    setConsecutiveB(false);
    loadCandidates();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">← 홈</Link>
            <h1 className="text-lg font-bold">A/B 평가</h1>
          </div>
          <div className="flex gap-2 text-sm">
            <button
              onClick={() => setTab('eval')}
              className={tab === 'eval' ? 'font-semibold text-blue-600 border-b-2 border-blue-600 pb-0.5' : 'text-gray-500 hover:text-gray-900'}
            >
              평가하기
            </button>
            <button
              onClick={() => setTab('history')}
              className={tab === 'history' ? 'font-semibold text-blue-600 border-b-2 border-blue-600 pb-0.5' : 'text-gray-500 hover:text-gray-900'}
            >
              평가 이력
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {tab === 'eval' && (
          <>
            {loading && <p className="text-center text-gray-500 py-20">데이터 로딩 중…</p>}
            {error && <p className="text-center text-red-600 py-20">{error}</p>}

            {!loading && !error && candidates && !submitted && (
              <>
                <p className="text-sm text-gray-500 mb-6 text-center">
                  두 큐레이션 결과를 비교하고 더 유용한 쪽을 선택하세요. 라벨(A/B)은 선택 후 공개됩니다.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {(['A', 'B'] as const).map((side) => {
                    const items = side === 'A' ? candidates.snapshotA : candidates.snapshotB;
                    const isChosen = chosen === side;
                    return (
                      <div
                        key={side}
                        className={`rounded-xl border-2 cursor-pointer transition-all ${isChosen ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-gray-300'}`}
                        onClick={() => !submitted && setChosen(side)}
                      >
                        <div className={`p-3 text-center font-semibold rounded-t-xl text-sm ${isChosen ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-600'}`}>
                          큐레이션 {side === 'A' ? '1' : '2'}
                          {isChosen && <span className="ml-2">✓ 선택됨</span>}
                        </div>
                        <div className="p-4 space-y-3">
                          {items.map((item) => <NewsCard key={item.id} item={item} />)}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {chosen && (
                  <div className="mt-6 max-w-2xl mx-auto bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                    <h3 className="font-semibold text-sm">
                      큐레이션 {chosen === 'A' ? '1' : '2'}을 선택하신 이유를 입력해주세요 (최소 10자)
                    </h3>
                    <textarea
                      className="w-full border border-gray-300 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                      rows={3}
                      placeholder="어떤 점이 더 유용했나요?"
                      value={rationale}
                      onChange={(e) => setRationale(e.target.value)}
                    />
                    <div className="flex items-center justify-between">
                      <span className={`text-xs ${rationale.trim().length < 10 ? 'text-red-500' : 'text-green-600'}`}>
                        {rationale.trim().length}/10자 이상
                      </span>
                      <button
                        onClick={handleSubmit}
                        disabled={submitting || rationale.trim().length < 10}
                        className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {submitting ? '제출 중…' : '평가 제출'}
                      </button>
                    </div>
                    {submitError && <p className="text-xs text-red-600">{submitError}</p>}
                  </div>
                )}
              </>
            )}

            {submitted && (
              <div className="text-center py-16 space-y-4">
                <div className="text-5xl">✅</div>
                <h2 className="text-xl font-bold">평가 완료</h2>
                <p className="text-gray-600 text-sm">
                  선택: <strong>큐레이션 {chosen === 'A' ? '1 (기존)' : '2 (페르소나)'}</strong>
                </p>
                {consecutiveB && (
                  <div className="inline-block mt-4 bg-yellow-50 border border-yellow-300 rounded-xl p-4 text-sm text-yellow-800 max-w-md">
                    <p className="font-semibold">💡 전환 제안</p>
                    <p className="mt-1">페르소나 큐레이션(큐레이션 2)을 3회 연속 선호하셨습니다. 기본 큐레이션을 페르소나 기반으로 전환하는 것을 고려해보세요.</p>
                  </div>
                )}
                {chosen === 'A' && (
                  <div className="inline-block mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 max-w-md">
                    <p className="font-semibold">📊 랭커 피드백</p>
                    <p className="mt-1">기존 큐레이션을 선호하셨습니다. 페르소나 가중치 조정이 필요할 수 있습니다.</p>
                  </div>
                )}
                <button
                  onClick={resetEval}
                  className="mt-6 px-6 py-2 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-900 transition-colors"
                >
                  다음 평가
                </button>
              </div>
            )}
          </>
        )}

        {tab === 'history' && (
          <>
            {histLoading && <p className="text-center text-gray-500 py-20">이력 로딩 중…</p>}
            {!histLoading && stats && (
              <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: '총 평가', value: stats.total },
                  { label: '큐레이션 1 선택', value: stats.aCount },
                  { label: '큐레이션 2 선택', value: stats.bCount },
                  { label: '큐레이션 2 비율', value: stats.total ? `${Math.round((stats.bCount / stats.total) * 100)}%` : '-' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-white border border-gray-200 rounded-xl p-4 text-center">
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className="text-2xl font-bold mt-1">{value}</p>
                  </div>
                ))}
              </div>
            )}
            {!histLoading && stats?.consecutiveB && (
              <div className="mb-4 bg-yellow-50 border border-yellow-300 rounded-xl p-4 text-sm text-yellow-800">
                💡 최근 3회 연속 큐레이션 2(페르소나)를 선호하셨습니다. 전환을 고려해보세요.
              </div>
            )}
            {!histLoading && (
              <div className="space-y-3">
                {history.length === 0 && (
                  <p className="text-center text-gray-500 py-10">평가 이력이 없습니다.</p>
                )}
                {history.map((e) => (
                  <div key={e.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-4">
                    <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${e.choice === 'B' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                      {e.choice === 'B' ? '2' : '1'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-500">{e.evalDate} · {new Date(e.createdAt).toLocaleTimeString('ko-KR')}</p>
                      <p className="text-sm mt-0.5">{e.rationale}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
