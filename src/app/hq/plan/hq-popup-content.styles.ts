/**
 * Content-area CSS shared by the HQ popups that render through `<sc-popup>` (frame, head, footer, width and
 * scroll come from the scaffold; this is only what sits in the body). Put the body markup in `<div class="pbody">`.
 */
export const HQ_POPUP_CONTENT_STYLES = `
  .pbody { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); }
  .dlg-msg { margin: 0; color: var(--sc-fg-1); }
  .dlg-err { margin: 0; color: var(--sc-warning); }
  .opt { display: flex; align-items: center; gap: var(--sc-space-2, 8px); padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-0); }
`;
