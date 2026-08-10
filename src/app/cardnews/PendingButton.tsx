'use client';

/**
 * PendingButton (2026-08-10) — 서버 액션 진행 중 피드백.
 * "버튼을 눌러도 어떻게 처리되는지 안 보인다" 문제의 해결: 제출 중엔 스피너+진행 문구로
 * 바뀌고 비활성화(중복 제출 방지). 완료·실패 결과는 상단 배너(?ok/?error)로 표시된다.
 */

import { useFormStatus } from 'react-dom';

export default function PendingButton({
  pendingLabel,
  className,
  children,
}: {
  pendingLabel: string;
  className: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}>
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {pendingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
