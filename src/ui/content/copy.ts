// Every piece of marketing copy on the public site lives here so the owner can
// rename the brand or rewrite the story without touching components.
// The copy only states what the catalogue shows: a Sydney business, the shirts
// in the range, and where they are sold (Amazon, eBay, Depop, Poshmark and Sydney stalls). Add real details here when the
// owner supplies them.

import type { Size } from '../../../contracts/types';

export const BRAND = {
  name: '2A Marketing',
  legalName: '2A Marketing Pty Ltd',
  place: 'Sydney',
  // Sydney CBD, used as a small caption in the hero and footer.
  coordinates: '33.87° S, 151.21° E',
};

export const SITE = {
  description:
    '2A Marketing is a proudly Australian t-shirt business from Sydney: photo prints of the Harbour Bridge, the Opera House and Tasmania, vintage racing cars, a plain black crew and a Christmas tee.',
};

export const HOME = {
  eyebrow: 'Proudly Australian, from Sydney',
  headline: ['Love this land.', 'Wear it proud.'],
  lede:
    'Photo prints of the Harbour Bridge in 1938, the Opera House at sunset and a wild Tasmanian gorge. There are vintage racing cars, a plain black crew and a Christmas tee too. Find the one that feels like home.',
  primaryCta: 'Shop all shirts',
  secondaryCta: 'Our story',
  featuredTitle: 'Start with these',
  featuredLink: 'See all shirts',
  storyQuote: 'For Australia and the Australian people.',
  storyBody:
    '2A Marketing is a Sydney business with one great love: this country. Most of the range is Australia itself, with two photo prints of Sydney Harbour and one of Tasmania. The rest is two classic racing cars, a plain black tee and one for Christmas.',
  storyLink: 'Read our story',
};

export const ABOUT = {
  title: 'Proudly Australian',
  intro:
    '2A Marketing is a Sydney business that loves where it comes from. This site brings the whole range together in one place.',
  paragraphs: [
    'Most of the range is Australian. One shirt carries a 1938 photo of traffic crossing the Sydney Harbour Bridge under a big SYDNEY heading. Another shows the Opera House and the bridge at sunset, seen across the water. The third is a misty gorge in Tasmania.',
    'The rest are a few favourites of ours. Two shirts carry black and silver prints of classic open-top racing cars: No. 81 on stone and No. 07 on cream. There is a plain black crew for every day, and a black Christmas tee with Santa walking toward a Welcome New Year sign, ready for a summer Christmas.',
    "Each shirt has its own page here with photos, colours and sizes. Our shirts are sold on Amazon, eBay, Depop and Poshmark, and at stalls across Sydney.",
  ],
  signoff: 'Thanks for stopping by. Wear it proud.',
};

export interface SizeRow {
  size: Size;
  chestCm: number; // width across the chest, laid flat
  lengthCm: number; // high point of shoulder to hem
}

export const SIZE_CHART: SizeRow[] = [
  { size: 'S', chestCm: 49, lengthCm: 70 },
  { size: 'M', chestCm: 52, lengthCm: 72 },
  { size: 'L', chestCm: 55, lengthCm: 74 },
  { size: 'XL', chestCm: 58, lengthCm: 76 },
  { size: 'XXL', chestCm: 61, lengthCm: 78 },
];

export const SIZE_GUIDE = {
  title: 'Size guide',
  intro:
    'These measurements come from the shirt itself, laid flat on a table. The easiest way to choose is to measure a tee you already like the fit of and compare.',
  tips: [
    { term: 'Chest', text: 'Measure straight across the front, from armpit to armpit.' },
    { term: 'Length', text: 'Measure from the highest point of the shoulder, next to the collar, down to the hem.' },
    { term: 'In between?', text: 'Go up a size for a relaxed fit, or stay down for a closer one.' },
  ],
  amazonNote: "A marketplace listing may show its own size chart. If the two disagree, go with the listing's.",
};

export const SHOP = {
  intro:
    'Photo prints of Sydney and Tasmania, vintage racing cars, a plain black crew and a Christmas tee, from a Sydney business that loves this country. Pick a category to narrow it down.',
};

export const FOOTER = {
  note: 'Proudly Australian, from Sydney. Our shirts are sold on Amazon, eBay, Depop and Poshmark, and at stalls across Sydney.',
  acknowledgement: 'We acknowledge the Traditional Custodians of the land, and pay our respects to Elders past and present.',
};
