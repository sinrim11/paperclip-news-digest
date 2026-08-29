/**
 * trade-key.ts — 실거래를 단지에 붙일 때 쓰는 조인 키 (2026-08-29).
 *
 * 이름만으로 묶으면 '현대'·'삼성' 같은 흔한 단지명이 여러 지역의 거래를 한 표본에 섞는다.
 * 지역(구·법정동)까지 좁히고, 표기 흔들림('평내호평역 대명루첸' vs '평내호평역대명루첸아파트')은
 * 정규화로 흡수한다. 정규화를 넣으면 매칭이 536→626건으로 는다.
 */

export const normName = (s: string) => s.replace(/\s|아파트/g, '');

export const tradeKey = (gu: string, dong: string, name: string) => `${gu}|${dong}|${normName(name)}`;
