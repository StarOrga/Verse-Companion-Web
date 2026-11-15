/**
 * Keyboard ring on text fields. A browser matches `:focus-visible` on every focused text field,
 * also after a mouse click (wherever typing is possible it shows the ring), so CSS alone cannot
 * keep the ring off a clicked field. This marks the document while focus is being moved with
 * Tab: `<html data-sc-tabbing>`. Without the mark, styles.scss ("Keyboard focus ring") blanks the
 * ring tokens on a focused text field; the field then shows focus on its own border only.
 *
 * Only Tab sets the mark: typing into a clicked field is keyboard use too, but not navigation.
 * Buttons, links and the other controls need none of this, `:focus-visible` is right for them.
 */
export const TABBING_ATTR = 'data-sc-tabbing';

/** Starts the tracking; returns the function that stops it. */
export function trackTabbing(doc: Document = document): () => void {
  const root = doc.documentElement;
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) root.setAttribute(TABBING_ATTR, '');
  };
  const onPointer = (): void => root.removeAttribute(TABBING_ATTR);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('pointerdown', onPointer, true);
  return () => {
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('pointerdown', onPointer, true);
    root.removeAttribute(TABBING_ATTR);
  };
}
