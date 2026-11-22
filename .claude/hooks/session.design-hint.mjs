#!/usr/bin/env node
// SessionStart hook: inject a short design-system reminder so every session
// (and every agent it briefs) knows where the rules are before the first UI edit.
// Plain stdout from a SessionStart hook is added to the session context.
// Keep it short — the details live in .claude/deep-knowledge/design-system.md.
process.stdout.write(
  [
    '[design-system] Before any UI change (web src/app or data-uploader): read .claude/deep-knowledge/design-system.md.',
    'StarUI is the source for tokens, brand and the catalog (node_modules/@starorga/star-ui/docs/CATALOG.md).',
    'New or deviating UI is allowed but must be marked `ds-new: <reason>` (candidate for StarUI) or `ds-ok: <reason>` (deliberate local look)',
    'and named in the reply/PR. Scales: radius 2/4/8/pill, text >= 13px, 4px spacing steps.',
    'When briefing a frontend agent, pass these lines on verbatim.',
  ].join(' ') + '\n',
);
