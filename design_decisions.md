# News Digest v3 — Design Decision Document

## Research Sources
Analysis of 7 products: Apple News, NYT Daily Briefing, Google News, Feedly, Flipboard, News Minimalist, Readwise Reader.

---

## 1. Category Navigation — Horizontal Chip Scroll (Google News model)

**Decision**: Replace sidebar with sticky horizontal chip navigation at top.

**Why**: Google News chips are the most mobile-friendly, scannable pattern. Sidebar wastes horizontal space on desktop and breaks entirely on mobile. Chips work at all breakpoints and support our fixed 5-category structure perfectly. Flipboard's tab model confirms this — magazine-style apps use horizontal nav.

**Implementation**: Sticky bar below header with 5 color-coded category chips + "전체" (all) default. Active chip gets filled background. Smooth scroll-to-section on click.

---

## 2. Card Layout — Vertical Stack with Top Image

**Decision**: Full-width cards, image on top (not side), stacked vertically.

**Why**: Apple News full-bleed images create visual impact. Side-by-side image+text (current design) makes images too small to be useful at 160x120. Top image at 100% width + 200px height gives articles visual presence. Flipboard confirms: image-first creates desire to read.

**Card structure** (top to bottom):
1. Hero image (full-width, 200px, rounded top)
2. Category badge (color-coded pill, top-left overlay on image)
3. Headline (20px bold serif)
4. 핵심 요약 — key summary (bold, 15px, 2-3 lines)
5. 주요 내용 — detail bullets (14px, muted, expandable)
6. Meta footer: source + date + "원문 보기" link

---

## 3. Typography Scale

**Decision**: Keep existing font stack, adjust scale.

| Role | Font | Size | Weight |
|------|------|------|--------|
| Page title | Newsreader | 36px | 700 |
| Card headline | Newsreader | 20px | 700 |
| Key summary (핵심 요약) | Manrope | 15px | 600 |
| Body / bullets | Manrope | 14px | 400 |
| Meta / labels | Inter | 11px | 500 |
| Category chip | Inter | 12px | 600 |

**Line height**: 1.6 for body, 1.3 for headlines (Readwise Reader research: optimal ~1.4-1.6).

---

## 4. Spacing System — 8px Grid

| Token | Value | Use |
|-------|-------|-----|
| xs | 4px | Inline gaps |
| sm | 8px | Tight spacing |
| md | 16px | Card padding |
| lg | 24px | Section gaps |
| xl | 32px | Between category sections |
| 2xl | 48px | Page margins |

---

## 5. Color Palette — Dark Mode Default

**Decision**: Dark mode by default (issue requirement). Inspired by NYT dark + Apple News dark.

### Dark Theme (default)
| Token | Value | Use |
|-------|-------|-----|
| Background | #0f1419 | Page bg (not pure black — less eye strain) |
| Surface | #1a1f26 | Card bg |
| Surface elevated | #242b35 | Hover state, nav bg |
| Text primary | #e7e9ea | Headlines, body |
| Text secondary | #8b98a5 | Meta, captions |
| Text muted | #5b6b7d | Timestamps |
| Border | #2f3840 | Card borders, dividers |
| Accent | #1d9bf0 | Links, active states |

### Category Accent Colors
| Category | Color | Rationale |
|----------|-------|-----------|
| 글로벌 뉴스 | #3b82f6 (blue) | International = blue (globe) |
| 증권 관련 뉴스 | #10b981 (green) | Finance = green (money) |
| AI 관련 뉴스 | #a78bfa (violet) | Tech/AI = purple (innovation) |
| 정부 정책 뉴스 | #f59e0b (amber) | Government = amber (authority) |
| 부동산 뉴스 | #06b6d4 (cyan) | Real estate = cyan (architecture) |

---

## 6. Information Hierarchy

**Research insight** (News Minimalist + NYT): Ranked importance and editorial curation matter more than raw density.

**Card reading flow** (F-pattern scan):
1. **Image** catches eye (Flipboard)
2. **Category badge** on image provides instant context (Google News chips)
3. **Headline** — serif font creates editorial authority (NYT)
4. **핵심 요약** (bold) — 2-3 sentence key takeaway, always visible
5. **주요 내용** (bullets) — expandable detail section
6. **Meta** — date + source, lowest priority (Feedly pattern)

---

## 7. Responsive Approach — Mobile First

| Breakpoint | Layout |
|-----------|--------|
| < 640px (mobile) | Single column, full-width cards, chips horizontally scrollable |
| 640-1024px (tablet) | Single column, max-w-2xl centered |
| > 1024px (desktop) | max-w-4xl centered, larger card padding |

**No sidebar at any breakpoint** — chips handle navigation at all sizes.

---

## 8. Interaction Patterns

- **Category chips**: Click to smooth-scroll to section
- **Card hover**: Subtle lift + border glow (current hover is good, keep)
- **Expand/collapse**: "주요 내용" section toggleable per card
- **Image error**: Gradient placeholder with category icon (keep current pattern)

---

## Products That Most Influenced This Design
1. **Google News** — chip navigation, clean card layout
2. **Apple News** — image-first cards, editorial typography
3. **NYT Daily Briefing** — section hierarchy, serif headlines
4. **News Minimalist** — importance ranking, clean density
5. **Readwise Reader** — typography scale, reading comfort
