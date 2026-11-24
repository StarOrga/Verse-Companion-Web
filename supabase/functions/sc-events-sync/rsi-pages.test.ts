// Tests for rsi-pages.ts — `node --test` (Node 24). Snippets mirror the live RSI shapes of 2026-11-23.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ageToIso, articleBodyUrl, articleImages, articlePriority, bodyText, ogImage, parseHubItems, pickEventImage, rsiAbsolute, titleYear,
} from './rsi-pages.ts';
import { matchCommLinks } from './matcher.ts';

const NOW = Date.parse('2026-11-23T20:00:00Z');

const hubBlock = (href: string, title: string, age: string, bg = 'https:\\/\\/media.robertsspaceindustries.com\\/f7zd99vwa3ks3\\/channel_item_full.jpg') =>
  `  <a class="content-block2 hub-block full \n    "\n  href="${href}"  data-original_class="full"\n>\n` +
  `<div class="type post"><div class="icon"></div><span>post</span></div>\n` +
  `<div class="background" style="background-image:url('${bg}');"></div>\n` +
  `<div class="title-holder">\n    <div class="title trans-opacity trans-03s">${title}</div>\n  </div>\n` +
  `<div class="text"><div class="comments">0</div><div class="time_ago">Posted: <span class="value">${age}</span></div></div></a>\n`;

test('hub list: id, absolute url, title, thumb and an approximate publish time', () => {
  const html = hubBlock('/comm-link/transmission/21386-Intergalactic-Aerospace-Expo-2956-Free-Fly-And-Manufacturer-Schedule', 'Intergalactic Aerospace Expo 2956 Free Fly and Manufacturer Schedule', '2 weeks ago')
    + hubBlock('/comm-link/transmission/21392-IAE-2956-Finale', 'IAE 2956 Finale', '5 hours ago')
    + hubBlock('https://evil.example/comm-link/transmission/1-x', 'Bad host', '1 day ago');
  const items = parseHubItems(html, NOW);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 21386);
  assert.equal(items[0].url, 'https://robertsspaceindustries.com/comm-link/transmission/21386-Intergalactic-Aerospace-Expo-2956-Free-Fly-And-Manufacturer-Schedule');
  assert.equal(items[0].thumb, 'https://media.robertsspaceindustries.com/f7zd99vwa3ks3/channel_item_full.jpg');
  assert.equal(items[0].publishedAt, '2026-11-09T20:00:00.000Z');
  assert.equal(items[1].title, 'IAE 2956 Finale');
  assert.equal(ageToIso('an hour ago', NOW), '2026-11-23T19:00:00.000Z');
  assert.equal(ageToIso('just now', NOW), new Date(NOW).toISOString());
});

test('page: og:image and the article body url, RSI hosts only', () => {
  const page = '<meta property="og:image" content="https://robertsspaceindustries.com/i/4e80/resize(2048,1024,cover,AD)/source.jpg" />'
    + '<div data-platform-client-props="{&quot;content&quot;:{&quot;html&quot;:null,&quot;htmlUrl&quot;:&quot;https:\\/\\/robertsspaceindustries.com\\/alexandria\\/html\\/6ad6\\/6aed\\/6IZB-en-mw55\\/&quot;}}"></div>';
  assert.equal(ogImage(page), 'https://robertsspaceindustries.com/i/4e80/resize(2048,1024,cover,AD)/source.jpg');
  assert.equal(articleBodyUrl(page), 'https://robertsspaceindustries.com/alexandria/html/6ad6/6aed/6IZB-en-mw55/');
  assert.equal(ogImage('<meta property="og:image" content="https://evil.example/x.jpg">'), null);
  assert.equal(articleBodyUrl('htmlUrl&quot;:&quot;https:\\/\\/evil.example\\/alexandria\\/x&quot;'), null);
  assert.equal(rsiAbsolute('javascript:alert(1)'), null);
});

const SHA = (c: string) => c.repeat(40);
const schedulePaths = [
  `/i/${SHA('a')}/resize(1920,1080,cover,crop(1920,1080,0,0,ADdP))/85/iae2956-schedule-16x9-72dpi.jpg`,
  `/i/${SHA('b')}/resize(953,1695,cover,crop(1080,1920,0,1,ADdP))/85/iae2956-schedule-16x9-72dpi.jpg`,
  `/i/${SHA('c')}/ADdPNihJ/iae2956-schedule-16x9-72dpi.jpg`,
  `/i/${SHA('c')}/ADdPNihJ/iae2956-schedule-16x9-72dpi.webp`,
  `/i/${SHA('d')}/resize(4,18,cover,crop(1920,1080,0,0,ADdP))/85/iae2956-schedule-16x9-72dpi.webp`,
];
const countdownBody = `<g-feature :picture="{&quot;originalFormat&quot;:{&quot;desktop&quot;:&quot;${schedulePaths[0]}&quot;,&quot;mobile&quot;:&quot;${schedulePaths[1]}&quot;},&quot;original&quot;:&quot;${schedulePaths[2]}&quot;,&quot;webp&quot;:&quot;${schedulePaths[3]}&quot;,&quot;blur&quot;:&quot;${schedulePaths[4]}&quot;}">`
  + `<template slot="introduction"><p>From November 13 - 27, you have the chance to try ships for free.</p></template>`
  + `<img src="/i/${SHA('e')}/resize(3000,1286,cover,crop(3840,1645,0,0,AD))/85/sc-42-9-banner-iae-savethedate.jpg">`;

test('article images: one per file, the untouched original wins, placeholders dropped', () => {
  const imgs = articleImages(countdownBody);
  assert.deepEqual(imgs.map((i) => i.name).sort(), ['iae2956-schedule-16x9-72dpi', 'sc-42-9-banner-iae-savethedate']);
  assert.equal(imgs.find((i) => i.name.startsWith('iae'))!.url, `https://robertsspaceindustries.com${schedulePaths[2]}`);
});

test('body text keeps the dates readable for the matcher', () => {
  const text = bodyText(countdownBody);
  assert.match(text, /From November 13 - 27, you have the chance/);
  const { candidates } = matchCommLinks([{
    id: 21386, title: 'Intergalactic Aerospace Expo 2956 Free Fly and Manufacturer Schedule',
    url: 'https://robertsspaceindustries.com/comm-link/transmission/21386-x', publishedAt: '2026-11-09T20:00:00.000Z', body: text,
  }]);
  assert.deepEqual(candidates.map((c) => [c.series, c.start, c.end]), [['iae', '2026-11-13', '2026-11-27']]);
});

test('event image: a schedule artwork anywhere in the edition beats the hero', () => {
  const own = { url: 'https://robertsspaceindustries.com/comm-link/transmission/21386-x', og: 'https://robertsspaceindustries.com/i/hero/source.jpg', images: [{ url: 'https://robertsspaceindustries.com/i/x/galaxy.png', name: 'galaxy2026' }] };
  const countdown = { url: 'https://robertsspaceindustries.com/comm-link/transmission/21389-x', og: null, images: articleImages(countdownBody) };
  assert.deepEqual(pickEventImage([own, countdown]), { url: `https://robertsspaceindustries.com${schedulePaths[2]}`, kind: 'schedule', from: countdown.url });
  assert.deepEqual(pickEventImage([own]), { url: own.og, kind: 'hero', from: own.url });
  assert.equal(pickEventImage([]), null);
});

test('edition helpers', () => {
  assert.equal(titleYear('IAE 2956 Finale'), 2956);
  assert.equal(titleYear('This Week in Star Citizen'), null);
  assert.ok(articlePriority('Intergalactic Aerospace Expo 2956 Free Fly and Manufacturer Schedule') < articlePriority('IAE 2956 Anvil Aerospace'));
  assert.ok(articlePriority('Countdown To IAE 2956') < articlePriority('IAE 2956 RSI'));
});
