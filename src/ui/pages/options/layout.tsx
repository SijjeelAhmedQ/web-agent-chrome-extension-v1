import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';

/**
 * Fit-to-screen building blocks for the configuration page. On tablets and larger screens the
 * page never scrolls: long lists are split into pages that fit the space they get, and long
 * pages are organised into sections that expand and collapse. On phones everything flows and
 * the page scrolls as usual. Nothing is hidden for good — every item stays one click away.
 */

/** True on tablets and larger screens, where the page fits the window (not on a phone held sideways). */
export function useFitMode(): boolean {
  return useMediaQuery('(min-width: 768px) and (min-height: 600px)');
}

const PAGER_HEIGHT = 46;

/**
 * Shows as many of its children as fit its height (and, as a grid, its width), with a pager
 * for the rest. The children are rendered as they are — no wrappers — so list styles apply.
 */
export function FitList({
  children,
  layout = 'list',
  minItemWidth = 260,
  gap = 0,
  className = '',
  label = 'Items',
  estimate = 64,
  itemsAs: ItemsTag = 'div',
  itemsClassName = '',
}: {
  children: ReactNode;
  layout?: 'list' | 'grid';
  /** Grid: the narrowest a column may get. */
  minItemWidth?: number;
  /** Space between items, matching the CSS gap. */
  gap?: number;
  className?: string;
  /** What the items are, for the pager's accessible name ("Agents"). */
  label?: string;
  /** Expected item height before the first measurement. */
  estimate?: number;
  /** The element that holds the items — `ul` when they are `li`s. */
  itemsAs?: 'div' | 'ul';
  itemsClassName?: string;
}) {
  const items = Children.toArray(children);
  const fit = useFitMode();
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [itemH, setItemH] = useState(0);
  const [page, setPage] = useState(0);
  const count = useRef(items.length);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The tallest item decides how many fit. It only grows (a page of shorter items must not
  // let more in, which would bring the tall one back — and loop); it starts over when the
  // width changes, because then the items reflow.
  const width = Math.round(size.w);
  useLayoutEffect(() => {
    setItemH(0);
  }, [width]);
  useLayoutEffect(() => {
    const kids = list.current ? Array.from(list.current.children) : [];
    if (!kids.length) return;
    const tallest = Math.max(...kids.map((k) => (k as HTMLElement).offsetHeight));
    if (tallest > itemH + 1) setItemH(tallest);
  });

  // Something new was added: show the page it lands on.
  useEffect(() => {
    if (items.length > count.current) setPage(Number.MAX_SAFE_INTEGER);
    count.current = items.length;
  }, [items.length]);

  const cols = layout === 'grid' ? Math.max(1, Math.floor((size.w + gap) / (minItemWidth + gap))) : 1;
  const rowsIn = (space: number) => Math.max(1, Math.floor((space + gap) / ((itemH || estimate) + gap)));
  let perPage = items.length;
  if (fit && size.h > 0) {
    perPage = rowsIn(size.h) * cols;
    if (items.length > perPage) perPage = rowsIn(size.h - PAGER_HEIGHT) * cols;
  }
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(page, pages - 1);
  const start = current * perPage;
  const shown = fit ? items.slice(start, start + perPage) : items;

  return (
    <div ref={box} className={`fit-list ${layout} ${fit ? 'is-fit' : ''} ${className}`}>
      <ItemsTag
        ref={list as never}
        className={`fit-items ${itemsClassName}`}
        style={layout === 'grid' ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap } : undefined}
      >
        {shown}
      </ItemsTag>
      {fit && pages > 1 && (
        <nav className="pager" aria-label={`${label}: pages`}>
          <span className="pager-info">
            {start + 1}–{Math.min(start + perPage, items.length)} of {items.length}
          </span>
          <span className="pager-controls">
            <button type="button" className="icon-btn small" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}>
              <ChevronLeft size={16} />
            </button>
            <span className="pager-pages" aria-live="polite">
              {current + 1} / {pages}
            </span>
            <button type="button" className="icon-btn small" aria-label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              <ChevronRight size={16} />
            </button>
          </span>
        </nav>
      )}
    </div>
  );
}

export interface AccordionPanel {
  key: string;
  title: ReactNode;
  /** A short line under the title, shown in the header. */
  description?: ReactNode;
  /** Small text at the right of the header, e.g. a count. */
  meta?: ReactNode;
  /** Buttons that belong to the section; shown in the header while it is open. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Sections that expand and collapse. On tablets and larger screens one is open at a time and
 * it gets the room the page has left. Closed sections stay mounted, so nothing typed in them
 * is lost.
 */
export function Accordion({ panels, defaultOpen, className = '' }: { panels: AccordionPanel[]; defaultOpen?: string; className?: string }) {
  const fit = useFitMode();
  const id = useId();
  const [open, setOpen] = useState<string[]>([defaultOpen ?? panels[0]?.key].filter(Boolean) as string[]);
  const headers = useRef<(HTMLButtonElement | null)[]>([]);

  const toggle = (key: string) =>
    setOpen((cur) => {
      if (cur.includes(key)) return cur.filter((k) => k !== key);
      return fit ? [key] : [...cur, key];
    });

  // Arrow keys move between section headers.
  const onKey = (e: KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? panels.length - 1 : -2;
    if (next === -2) return;
    e.preventDefault();
    headers.current[(next + panels.length) % panels.length]?.focus();
  };

  return (
    <div className={`accordion ${fit ? 'is-fit' : ''} ${className}`}>
      {panels.map((p, i) => {
        const isOpen = open.includes(p.key);
        const headId = `${id}-h-${p.key}`;
        const bodyId = `${id}-b-${p.key}`;
        return (
          <section key={p.key} className={`acc-panel ${isOpen ? 'open' : ''}`}>
            <div className="acc-head">
              <button
                ref={(el) => {
                  headers.current[i] = el;
                }}
                type="button"
                id={headId}
                className="acc-toggle"
                aria-expanded={isOpen}
                aria-controls={bodyId}
                onClick={() => toggle(p.key)}
                onKeyDown={(e) => onKey(e, i)}
              >
                <ChevronDown size={16} className="acc-chev" aria-hidden />
                <span className="acc-title-wrap">
                  <span className="acc-title">{p.title}</span>
                  {p.description && <span className="acc-desc">{p.description}</span>}
                </span>
                {p.meta !== undefined && <span className="acc-meta">{p.meta}</span>}
              </button>
              {isOpen && p.actions && <div className="acc-actions">{p.actions}</div>}
            </div>
            <div id={bodyId} role="region" aria-labelledby={headId} className="acc-body" hidden={!isOpen}>
              {p.children}
            </div>
          </section>
        );
      })}
    </div>
  );
}

type SectionLike = ReactElement<{ title?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }>;

/**
 * Shows a page's existing <Section>s as expandable sections — same content, same controls,
 * only presented one at a time on larger screens.
 */
export function SectionGroup({ children, defaultOpen = 0 }: { children: ReactNode; defaultOpen?: number }) {
  const sections = Children.toArray(children).filter(isValidElement) as SectionLike[];
  return (
    <Accordion
      defaultOpen={String(defaultOpen)}
      panels={sections.map((s, i) => ({
        key: String(i),
        title: s.props.title ?? 'Settings',
        description: s.props.description,
        actions: s.props.actions,
        children: <div className="section-card">{s.props.children}</div>,
      }))}
    />
  );
}
