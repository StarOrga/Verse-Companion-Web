import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLegacyActions } from './check-legacy-actions.mjs';

const lines = (src) => findLegacyActions(src).map((h) => h.line);

test('flags the legacy button classes as whole tokens', () => {
  assert.deepEqual(lines('<button class="sc-btn">x</button>'), [1]);
  assert.deepEqual(lines('<a class="sc-btn sc-btn-primary" href="/x">x</a>'), [1]);
  assert.deepEqual(lines('\n<button class="btn ghost">x</button>'), [2]);
  assert.deepEqual(lines('<button class="quiet link-btn">x</button>'), [1]);
  assert.deepEqual(lines('<button class="sc-btn micro danger">x</button>'), [1]);
});
test('flags class bindings of the same tokens', () => {
  assert.deepEqual(lines('<a [class.sc-btn]="p" [class.sc-btn-primary]="p">x</a>'), [1, 1]);
  assert.deepEqual(lines('<a [class.btn]="on">x</a>'), [1]);
});
test('lets scAction, look-alike tokens and bespoke controls through', () => {
  assert.deepEqual(lines('<button scAction tier="primary" class="more">x</button>'), []);
  assert.deepEqual(lines('<button class="back-btn fold-btn lg-btn">x</button>'), []);
  assert.deepEqual(lines('<a class="cta" routerLink="/x">x</a>'), []);
  assert.deepEqual(lines('<td class="act"><button class="act fav">x</button></td>'), []);
  assert.deepEqual(lines('<svg [attr.class]="x"></svg>'), []);
});
test('ignores comments, CSS selectors and exempted lines', () => {
  assert.deepEqual(lines('<!-- was class="sc-btn" -->\n<p></p>'), []);
  assert.deepEqual(lines('// old: class="btn"\nfoo();'), []);
  assert.deepEqual(lines('.sc-btn { color: red; }'), []);
  assert.deepEqual(lines('<button class="btn"> <!-- legacy-action: exception — third-party markup --></button>'), []);
});
