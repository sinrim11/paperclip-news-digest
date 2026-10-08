import { describe, it, expect } from 'vitest';
import { volReentryFloor } from '@/lib/recommend-engine';

describe('volReentryFloor — 거래량 신호 재발동 하한', () => {
  it('처음 알리는 단지는 하한 없음', () => {
    expect(volReentryFloor(0)).toBe(0);
  });
  it('+1건으로는 재발동하지 않는다 (진접 vol:4 → vol:5 사례)', () => {
    expect(5 >= volReentryFloor(4)).toBe(false);
    expect(6 >= volReentryFloor(4)).toBe(true);
  });
  it('큰 건수는 +50%를 요구한다', () => {
    expect(volReentryFloor(10)).toBe(15);
  });
});
