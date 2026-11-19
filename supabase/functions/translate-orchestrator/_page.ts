// Reads every row of a query. The API caps one response at `max_rows` (1 000 on this project), whatever
// `.limit()` asks for, and says nothing when it cuts: a glossary of 1 200 rows came back as 1 000, and the
// learning step would have proposed the missing 200 again. Every list that can grow past the cap pages.

export interface PageResult {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

export const PAGE_ROWS = 1000;
/** Stop of last resort: 200 pages are 200 000 rows, far beyond any table of the pipeline. */
const MAX_PAGES = 200;

/**
 * `page(from, to)` must return the rows `from..to` (inclusive) of a query with a stable order.
 * Throws the error of the first failing page.
 */
export async function selectAll<T>(page: (from: number, to: number) => PromiseLike<PageResult>, size = PAGE_ROWS): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * size, i * size + size - 1);
    if (error) throw new Error(error.message ?? 'db error');
    const rows = (data ?? []) as T[];
    for (const r of rows) out.push(r);
    if (rows.length < size) break;
  }
  return out;
}
