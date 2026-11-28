import { hitThumbCandidates, type SearchHitArtSource } from './search-hit-thumbs';

describe('hitThumbCandidates', () => {
  const art: SearchHitArtSource = {
    shipArt: (name) => (name === 'Gladius' ? ['https://media.example/gladius-small.jpg', 'https://media.example/gladius-large.jpg'] : []),
    upcomingArt: (id) => (id === 'arrastra' ? ['https://media.example/arrastra.jpg'] : []),
    itemRender: (name) => `https://cdn.example/previews/${name}`,
  };

  it('a ship row gets the RSI renders of its hull, matched on name_localized', () => {
    expect(hitThumbCandidates({ kind: 'ship', classNameSlug: 'aegs_gladius', nameLocalized: 'Gladius' }, art)).toEqual([
      'https://media.example/gladius-small.jpg',
      'https://media.example/gladius-large.jpg',
    ]);
  });

  it('an announced ship row gets the renders of its feed entry', () => {
    expect(hitThumbCandidates({ kind: 'upcoming', classNameSlug: 'arrastra', nameLocalized: 'Arrastra' }, art)).toEqual([
      'https://media.example/arrastra.jpg',
    ]);
  });

  it('a ship RSI has no render of keeps its icon (no candidates)', () => {
    expect(hitThumbCandidates({ kind: 'ship', classNameSlug: 'x', nameLocalized: 'Unknown Hull' }, art)).toEqual([]);
  });

  it('an item, weapon or component with a model render shows it', () => {
    for (const kind of ['item', 'weapon', 'component'] as const) {
      expect(
        hitThumbCandidates({ kind, classNameSlug: 'x', nameLocalized: 'X', renderImage: 'model_abc.webp' }, art),
      ).toEqual(['https://cdn.example/previews/model_abc.webp']);
    }
  });

  it('a model render is dropped when the reader picked icons (itemRender null)', () => {
    const icons: SearchHitArtSource = { ...art, itemRender: () => null };
    expect(
      hitThumbCandidates({ kind: 'item', classNameSlug: 'x', nameLocalized: 'X', renderImage: 'model_abc.webp' }, icons),
    ).toEqual([]);
  });

  it('kinds without model renders ignore a stray renderImage', () => {
    for (const kind of ['ammunition', 'manufacturer', 'blueprint'] as const) {
      expect(hitThumbCandidates({ kind, classNameSlug: 'x', nameLocalized: 'X', renderImage: 'm.webp' }, art)).toEqual([]);
    }
  });

  it('items, weapons and components without a render keep their category icon', () => {
    for (const kind of ['item', 'weapon', 'component', 'ammunition', 'manufacturer', 'blueprint'] as const) {
      expect(hitThumbCandidates({ kind, classNameSlug: 'Gladius', nameLocalized: 'Gladius' }, art)).toEqual([]);
    }
  });
});
