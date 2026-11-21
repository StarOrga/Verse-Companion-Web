import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { CONCEPT_FRAME_NAVIGATE, ConceptPageComponent, conceptFrameUrl } from './concept-page.component';
import { ConceptPageService, ConceptTicket, ConceptTicketFailure } from './concept-page.service';
import { renderFeedbackBody } from '../feedback/markdown.util';

/**
 * `/concept/:id` (admin feedback #224, full-screen since e4428abd): the route
 * mints a ticket and replaces itself with the app's loader for the document
 * the edge function serves (#330) — no in-app page, no sub-header, no iframe.
 * What it still renders are the failure copies.
 */
const ID = '2c8f6c5e-0b8d-4d7e-9c7a-4d9f1e2a3b4c';
const TICKET: ConceptTicket = {
  url: `https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/concept-page/${ID}?t=abc`,
  title: 'Layout Bewaffnung',
  expiresAt: '2026-09-15T00:00:00Z',
};

async function mount(mint: () => Promise<ConceptTicket>) {
  const navigate = vi.fn().mockName('navigate');
  await TestBed.configureTestingModule({
    imports: [ConceptPageComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({ fallbackLang: 'en' }),
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: ID })) } },
      { provide: ConceptPageService, useValue: { mintTicket: mint } },
      { provide: CONCEPT_FRAME_NAVIGATE, useValue: navigate },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ConceptPageComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, navigate, cmp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

describe('ConceptPageComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('builds the same-origin loader URL with the function URL only in the fragment', () => {
    const frame = conceptFrameUrl(ID.toUpperCase(), TICKET.url);
    expect(frame).toBe(`/concept-frame/${ID}.html#${encodeURIComponent(TICKET.url)}`);
    // The ticket never sits in the path or query the server sees.
    expect(frame.split('#')[0]).not.toContain('t=abc');
    expect(decodeURIComponent(frame.split('#')[1])).toBe(TICKET.url);
  });

  it('goes straight to the full-screen loader once the ticket is minted (e4428abd)', async () => {
    const mint = vi.fn().mockName('mintTicket').mockResolvedValue(TICKET);
    const { navigate, el } = await mount(mint);

    expect(mint).toHaveBeenCalledWith(ID);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(conceptFrameUrl(ID, TICKET.url));
    // Never the function URL itself: Supabase serves its html as text/plain.
    expect(navigate.mock.calls[0][0]).not.toMatch(/^https:/);
    // No intermediate page: no frame, no header, no "open in new tab".
    expect(el.querySelector('iframe')).toBeNull();
    expect(el.querySelector('header')).toBeNull();
    expect(el.querySelector('a.open')).toBeNull();
  });

  it('does not replace the tab when the component is gone before the ticket arrives', async () => {
    let resolve!: (t: ConceptTicket) => void;
    const mint = () => new Promise<ConceptTicket>((r) => { resolve = r; });
    const { fixture, navigate } = await mount(mint);
    fixture.destroy();
    resolve(TICKET);
    await Promise.resolve();
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the admin-only copy, a real back anchor and never leaves when the function refuses', async () => {
    const { cmp, el, navigate } = await mount(() => Promise.reject(new ConceptTicketFailure('forbidden')));
    expect(cmp.state()).toBe('forbidden');
    expect(navigate).not.toHaveBeenCalled();
    expect(el.querySelector('.msg.err')?.textContent).toContain('conceptPage.forbidden');
    const back = el.querySelector('a.back') as HTMLAnchorElement | null;
    expect(back?.getAttribute('href')).toBe('/admin/feedback');
  });

  it('tells a missing concept apart from a broken one, and the broken one can retry', async () => {
    const missing = await mount(() => Promise.reject(new ConceptTicketFailure('notFound')));
    expect(missing.el.querySelector('.msg.err')?.textContent).toContain('conceptPage.notFound');
    expect(missing.el.querySelector('button.retry')).toBeNull();
    TestBed.resetTestingModule();

    const mint = vi.fn().mockName('mintTicket').mockRejectedValueOnce(new Error('network')).mockResolvedValue(TICKET);
    const broken = await mount(mint);
    expect(broken.cmp.state()).toBe('error');
    expect(broken.el.querySelector('.msg.err')?.textContent).toContain('conceptPage.error');
    (broken.el.querySelector('button.retry') as HTMLButtonElement).click();
    await broken.fixture.whenStable();
    expect(mint).toHaveBeenCalledTimes(2);
    expect(broken.navigate).toHaveBeenCalledWith(conceptFrameUrl(ID, TICKET.url));
  });
});

describe('concept links in the feedback thread', () => {
  it('open the concept route in a new tab as a real anchor (e4428abd)', () => {
    const url = `https://versecompanion-alpha.vercel.app/concept/${ID}`;
    for (const body of [url, `[Konzept](${url})`]) {
      const host = document.createElement('div');
      host.innerHTML = renderFeedbackBody(body).html;
      const a = host.querySelector('a') as HTMLAnchorElement | null;
      expect(a?.getAttribute('href')).toBe(url);
      expect(a?.getAttribute('target')).toBe('_blank');
      expect(a?.getAttribute('rel')).toContain('noopener');
    }
  });
});
