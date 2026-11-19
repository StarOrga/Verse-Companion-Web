// Tolerant parser of the PostHog error-tracking alert webhook body (pure, tested in _webhook.test.ts).
//
// Recommended body for the PostHog webhook destination (Hog template, see docs):
//   {"issue_id": "{event.properties.$exception_issue_id}", "title": "{event.properties.$exception_types} {event.properties.$exception_values}",
//    "kind": "{event.event}", "url": "{event.url}"}
// The parser also understands PostHog's default shapes (event.properties.*, properties.*, issue.*).

export interface SignalPayload { issueId: string; title: string; kind: 'created' | 'reopened'; url: string | null }

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
const pick = (o: Record<string, unknown> | undefined, ...keys: string[]) => {
  for (const k of keys) { const v = str(o?.[k]); if (v) return v; }
  return null;
};
const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined);

export function parseSignal(raw: unknown): SignalPayload | null {
  const root = obj(raw);
  if (!root) return null;
  const event = obj(root.event);
  const props = obj(event?.properties) ?? obj(root.properties);
  const issue = obj(root.issue);
  const issueId = pick(root, 'issue_id', 'issueId') ?? pick(issue, 'id') ?? pick(props, '$exception_issue_id');
  if (!issueId || issueId.includes('{')) return null; // unrendered template placeholder
  const name = pick(root, 'title', 'name') ?? pick(issue, 'name', 'title')
    ?? [pick(props, '$exception_types'), pick(props, '$exception_values')].filter(Boolean).join(': ');
  const kindRaw = (pick(root, 'kind', 'status', 'trigger') ?? '').toLowerCase();
  const url = pick(root, 'url') ?? pick(issue, 'url');
  return {
    issueId: issueId.slice(0, 80),
    title: (name || 'Unbekannter Fehler').slice(0, 160),
    kind: kindRaw.includes('reopen') ? 'reopened' : 'created',
    url: url && /^https:\/\/(eu|us|app)\.posthog\.com\//.test(url) ? url : null,
  };
}
