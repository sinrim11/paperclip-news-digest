'use client';

/** 인스타 캡션 복사 버튼 — 항상 보이는 독립형(공용 CopyButton은 호버 전용이라 별도) */
import { useState } from 'react';

export default function CopyCaptionButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const el = document.createElement('textarea');
          el.value = text; el.style.position = 'fixed'; el.style.opacity = '0';
          document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
        }
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
      className={`rounded-full px-4 py-1.5 text-xs font-semibold text-white transition ${done ? 'bg-emerald-600' : 'bg-gray-900 hover:bg-gray-700'}`}
    >
      {done ? '✓ 복사됨' : '📋 본문 복사'}
    </button>
  );
}
