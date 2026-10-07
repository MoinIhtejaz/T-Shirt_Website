// Every piece of marketing copy on the public site lives here so the owner can
// rename the brand or rewrite the story without touching components.
// The copy only states what the catalogue shows: a Sydney business, the shirts
// in the range, and that they are sold on Amazon. Add real details here when the
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
    '2A Marketing is a Sydney business selling t-shirts on Amazon: photo prints of Sydney and Tasmania, vintage racing cars, a plain black crew and a Christmas tee.',
};

export const HOME = {
  eyebrow: 'T-shirts from Sydney',
  headline: ['Our harbour,', 'on your back.'],
  lede:
    'Photo print tees of the Harbour Bridge in 1938, the Opera House at sunset and a gorge in Tasmania. There are a couple of vintage racing cars, a plain black crew and a Christmas tee too. Have a look around, then buy the one you like on Amazon.',
  primaryCta: 'Shop all shirts',
  secondaryCta: 'About us',
  featuredTitle: 'A few to start with',
  featuredLink: 'See all shirts',
  storyQuote: 'We are based in Sydney, so the harbour comes first.',
  storyBody:
    '2A Marketing keeps a short range. Most of it is Australia: two photo prints of Sydney Harbour and one of Tasmania. The rest is two racing cars, a plain black tee and one for Christmas.',
  storyLink: 'Read about us',
};

export const ABOUT = {
  title: 'Sydney first, then a few detours',
  intro: '2A Marketing is a Sydney business that sells t-shirts on Amazon. This site shows the whole range in one place.',
  paragraphs: [
    'The Australia prints come first. One is a 1938 photo of traffic crossing the Sydney Harbour Bridge, under a big SYDNEY heading. Another shows the Opera House and the bridge at sunset, seen across the water from the rocks. The third leaves the mainland for a misty gorge in Tasmania.',
    'Then come the detours. Two shirts carry black and silver prints of classic open-top racing cars: No. 81 on stone and No. 07 on cream. There is a plain black crew for days when you would rather skip the print, and a black Christmas tee with Santa walking toward a Welcome New Year sign.',
    "Each shirt has its own page here with photos, colours and sizes. The Buy on Amazon button takes you to the shirt's Amazon listing, which has the current price, sizes and delivery times.",
  ],
  signoff: 'Thanks for having a look around.',
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
  amazonNote: "The Amazon listing may show its own size chart. If the two disagree, go with Amazon's.",
};

export const SHOP = {
  intro:
    'Photo prints of Sydney and Tasmania, vintage racing cars, a plain black crew and a Christmas tee. Pick a category to narrow it down.',
};

export const FOOTER = {
  note: 'A Sydney business. Our shirts are sold on Amazon.',
  acknowledgement:
    'We acknowledge the Traditional Custodians of the lands and waters around Sydney, and pay our respects to Elders past and present.',
};
