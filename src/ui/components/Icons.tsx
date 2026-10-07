import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

export const ArrowUpRight = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M7 17 17 7M8 7h9v9" />
  </svg>
);

export const ArrowRight = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
);

export const ArrowUp = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

export const ArrowDown = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
);

export const Star = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
  </svg>
);

export const Plus = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Ruler = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3 15.5 15.5 3 21 8.5 8.5 21z" />
    <path d="m7 12 2 2M10 9l2 2M13 6l2 2" />
  </svg>
);

export const Refresh = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </svg>
);

/**
 * The 2A Marketing mark: the letters 2A drawn as strokes, standing on a horizon line.
 * Drawn as paths (not text) so it looks the same before the web fonts load.
 */
export const BrandMark = (p: IconProps) => (
  <svg {...base} viewBox="0 0 32 32" strokeWidth={2.5} {...p}>
    <path d="M5.5 11.75C5.5 9.4 7.4 7.75 9.9 7.75S14.3 9.4 14.3 11.6c0 2.15-1.5 3.5-3.4 5.2L5.5 22.25h8.9" />
    <path d="M17.25 22.25 21.75 7.75l4.5 14.5M18.8 17.5h5.9" />
    <path d="M4 26.75h24" />
  </svg>
);
