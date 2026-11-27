import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/**
 * #409 — the Analyse cards follow the loadout blocks they describe.
 *
 * The classic ship page used to stick the whole Analyse column under the KPI
 * strip, so Offensive, Verteidigung and Schiff rode along as one block while
 * the loadout beside them scrolled on: the shield generators were long on
 * screen while the column still showed weapons, and the ship card sat
 * nowhere near Antrieb & Systeme. Each card now has a range in the loadout:
 *
 *   Offensive    from the column top until the next card's block (the
 *                missiles end) — it stays pinned under the strip meanwhile;
 *   Verteidigung from the first defence block (Schildgeneratoren);
 *   Schiff       from Antrieb & Systeme to the column end.
 *
 * Inside its range a card behaves like `position: sticky`. A card taller than
 * its range sticks out below it and pushes the next one down; as the next
 * anchor approaches the stick line the cards above are lifted a little faster
 * than the page scrolls, so the pushed card meets its block at the stick line
 * instead of jumping there. Every step is a min/max of continuous functions
 * of the scroll position, so nothing snaps.
 */

/** Which loadout blocks (`data-sec` of a top-level `.mod-sec`) anchor which card. */
export const ANALYSIS_ANCHOR_BLOCKS: Readonly<Record<string, readonly string[]>> = {
  offense: ['weapons', 'remoteTurrets', 'mannedTurrets', 'missiles'],
  defense: ['shields', 'countermeasures'],
  ship: ['systems', 'powerPlants', 'quantum', 'coolers', 'radar', 'lifeSupport', 'structure'],
};

/** One Analyse card, measured in column-local px (column top = 0), untransformed. */
export interface SyncCard {
  /** Where the card sits in normal flow. */
  natural: number;
  height: number;
  /** Top of the loadout block it belongs to, or null (then it just follows). */
  anchor: number | null;
}

export interface SyncFrame {
  /** The stick line (under the KPI strip), column-local: viewport line − column top. */
  stickTop: number;
  /** Lowest line a card's bottom may park on, column-local (viewport bottom − 16). */
  viewBottom: number;
  /** Height the cards may use (the loadout column's height). */
  columnHeight: number;
  /** Space between two cards. */
  gap: number;
  /** Lift a pushed card towards its anchor (off under prefers-reduced-motion). */
  catchUp: boolean;
}

/** True when the cards fit beside the loadout at all — otherwise the old sticky column stays. */
export function canSyncAnalysis(cards: readonly SyncCard[], columnHeight: number, gap: number): boolean {
  if (cards.length === 0) return false;
  const total = cards.reduce((sum, c) => sum + c.height, 0) + gap * (cards.length - 1);
  return cards[0].natural + total <= columnHeight;
}

/**
 * Anchors must run down the column in card order; one that would put a card
 * above its predecessor's anchor (a mission lens that orders shields before
 * weapons, say) is dropped, so that card simply follows the one above.
 */
export function monotonicAnchors(anchors: readonly (number | null)[]): (number | null)[] {
  let last = -Infinity;
  return anchors.map((a) => {
    if (a === null || a < last) return null;
    last = a;
    return a;
  });
}

/** Vertical offset per card (px, relative to its natural position) for one scroll frame. */
export function analysisCardOffsets(cards: readonly SyncCard[], frame: SyncFrame): number[] {
  const { stickTop, viewBottom, columnHeight, gap, catchUp } = frame;
  const n = cards.length;
  const starts = cards.map((c) => c.anchor ?? c.natural);

  // A card's range ends where the next ANCHORED card starts, leaving room for
  // any un-anchored cards in between; the last range runs to the column end.
  const ends = cards.map((_, i) => {
    let room = 0;
    for (let j = i + 1; j < n; j++) {
      if (cards[j].anchor !== null) return (cards[j].anchor as number) - gap - room;
      room += cards[j].height + gap;
    }
    return columnHeight - room;
  });

  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const h = cards[i].height;
    const pin = Math.min(stickTop, viewBottom - h);
    let y = Math.max(starts[i], Math.min(pin, ends[i] - h));
    if (i > 0) {
      let push = ys[i - 1] + cards[i - 1].height + gap;
      const overflow = push - starts[i];
      if (catchUp && cards[i].anchor !== null && overflow > 0) {
        // Starts lifting when the anchor is `overflow` px below the stick
        // line; done (lift = overflow) when the anchor reaches it.
        const lift = Math.min(overflow, Math.max(0, stickTop - starts[i] + overflow));
        if (lift > 0) {
          for (let j = 0; j < i; j++) ys[j] -= lift;
          push -= lift;
        }
      }
      y = Math.max(y, push);
    }
    ys.push(y);
  }

  // Never past the column end, never overlapping on the way back up.
  for (let i = n - 1; i >= 0; i--) {
    const limit = (i === n - 1 ? columnHeight : ys[i + 1] - gap) - cards[i].height;
    ys[i] = Math.min(ys[i], limit);
  }
  return ys.map((y, i) => Math.round(y - cards[i].natural));
}

const GAP = 12;
const VIEW_MARGIN = 16;

/**
 * Drives `analysisCardOffsets` on the Analyse column. The host is the column;
 * its cards are `:scope > [data-an-anchor]` slots, the loadout is the sibling
 * `.col-loadout`. Only active in the two-column desktop layout; anywhere else
 * (single column, phones, a column that would not fit) it removes every trace
 * and the CSS sticky column applies as before.
 */
@Directive({ selector: '[scAnalysisScrollSync]', standalone: true })
export class AnalysisScrollSyncDirective {
  private readonly host = inject(ElementRef<HTMLElement>);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return;
      const col = this.host.nativeElement as HTMLElement;
      const wide = window.matchMedia('(min-width: 1101px)');
      const still = window.matchMedia('(prefers-reduced-motion: reduce)');
      let frame = 0;
      let synced = false;
      let observed = new Set<Element>();

      const slots = () => Array.from(col.querySelectorAll<HTMLElement>(':scope > [data-an-anchor]'));
      const loadout = () => col.parentElement?.querySelector<HTMLElement>(':scope > .col-loadout') ?? null;

      const reset = () => {
        if (!synced) return;
        synced = false;
        col.classList.remove('an-synced');
        for (const s of slots()) s.style.removeProperty('top');
      };

      const run = () => {
        frame = 0;
        const lo = loadout();
        const cardEls = slots();
        const single = col.parentElement?.classList.contains('single') ?? true;
        if (!wide.matches || single || !lo || cardEls.length === 0) return reset();
        observe([lo, ...cardEls]);

        const colRect = col.getBoundingClientRect();
        const blocks = Array.from(lo.querySelectorAll<HTMLElement>('.layout > .mod-sec[data-sec]'));
        const anchorOf = (key: string | undefined): number | null => {
          const set = key ? ANALYSIS_ANCHOR_BLOCKS[key] : undefined;
          if (!set) return null;
          let top: number | null = null;
          for (const b of blocks) {
            if (!set.includes(b.dataset['sec'] ?? '')) continue;
            const t = b.getBoundingClientRect().top - colRect.top;
            top = top === null ? t : Math.min(top, t);
          }
          return top;
        };
        // The first card already shares its top line with the first block (#408).
        const anchors = monotonicAnchors(cardEls.map((el, i) => (i === 0 ? null : anchorOf(el.dataset['anAnchor']))));
        // offsetTop includes the relative `top` this directive set last frame.
        const cards: SyncCard[] = cardEls.map((el, i) => ({
          natural: el.offsetTop - (parseFloat(el.style.top) || 0),
          height: el.offsetHeight,
          anchor: anchors[i],
        }));
        const columnHeight = lo.getBoundingClientRect().height;
        if (!canSyncAnalysis(cards, columnHeight, GAP)) return reset();

        if (!synced) {
          // The column changes from sticky to a full-height row first; measure
          // again on the next frame, from the layout the offsets apply to.
          synced = true;
          col.classList.add('an-synced');
          return schedule();
        }
        // The stick line lives in CSS (--_stick-top); scroll-margin-top carries
        // it resolved to px without moving anything.
        const stickLine = parseFloat(getComputedStyle(col).scrollMarginTop) || 0;
        const offsets = analysisCardOffsets(cards, {
          stickTop: stickLine - colRect.top,
          viewBottom: window.innerHeight - VIEW_MARGIN - colRect.top,
          columnHeight,
          gap: GAP,
          catchUp: !still.matches,
        });
        cardEls.forEach((el, i) => {
          const v = `${offsets[i]}px`;
          if (el.style.top !== v) el.style.top = v;
        });
      };

      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(run);
      };
      const ro = new ResizeObserver(schedule);
      const observe = (els: Element[]) => {
        const next = new Set(els);
        for (const el of observed) if (!next.has(el)) ro.unobserve(el);
        for (const el of next) if (!observed.has(el)) ro.observe(el);
        observed = next;
      };
      const mo = new MutationObserver(schedule);
      mo.observe(col, { childList: true });

      document.addEventListener('scroll', schedule, { capture: true, passive: true });
      window.addEventListener('resize', schedule, { passive: true });
      wide.addEventListener('change', schedule);
      still.addEventListener('change', schedule);
      schedule();

      destroyRef.onDestroy(() => {
        if (frame) cancelAnimationFrame(frame);
        ro.disconnect();
        mo.disconnect();
        document.removeEventListener('scroll', schedule, { capture: true });
        window.removeEventListener('resize', schedule);
        wide.removeEventListener('change', schedule);
        still.removeEventListener('change', schedule);
        reset();
      });
    });
  }
}
