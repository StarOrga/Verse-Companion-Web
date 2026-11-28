import { describe, expect, it } from 'vitest';
import { rotateShipBox } from '../../shared/sil-thumb/sil-thumbs.service';
import { arrivalThumbOf, uprightThumb } from './arrival-thumb';

describe('arrival thumb', () => {
  it('takes the detail silhouette as the table draws it, without a turn', () => {
    expect(arrivalThumbOf({ viewBox: '0 0 40 100', path: 'M0 0 L40 100' })).toEqual({ viewBox: '0 0 40 100', path: 'M0 0 L40 100', transform: '' });
    expect(arrivalThumbOf(null)).toBeNull();
    expect(arrivalThumbOf({ viewBox: '', path: 'M0 0' })).toBeNull();
  });

  it('takes the quarter turn of a tile thumb out again', () => {
    const box = '10 20 40 100';
    const turned = rotateShipBox(box)!;
    const upright = uprightThumb({ viewBox: turned.viewBox, path: 'M0 0', transform: turned.transform });
    expect(upright).toEqual({ viewBox: box, path: 'M0 0', transform: '' });
  });

  it('leaves a thumb without the turn, an unreadable box and null alone', () => {
    const plain = { viewBox: '0 0 40 100', path: 'M0 0', transform: '' };
    expect(uprightThumb(plain)).toBe(plain);
    const odd = { viewBox: 'nope', path: 'M0 0', transform: 'rotate(90 1 1)' };
    expect(uprightThumb(odd)).toBe(odd);
    expect(uprightThumb(null)).toBeNull();
  });
});
