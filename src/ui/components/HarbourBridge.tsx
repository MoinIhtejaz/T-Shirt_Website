/**
 * A line drawing of the Sydney Harbour Bridge that stands on the hero's waterline:
 * the arch truss, the deck with its hangers, and the four granite pylons.
 * Decorative only. Coordinates are in a 400 x 150 box; the water covers the base.
 */
export function HarbourBridge({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`bridge ${className}`}
      viewBox="0 0 400 150"
      aria-hidden="true"
      focusable="false"
    >
      {/* Arch: top and bottom chords, then the verticals and diagonals between them. */}
      <g className="bridge__truss">
        <path d="M75 70Q200 -20 325 70M75 140Q200 -60 325 140" />
        <path d="M100 53.8V104M125 41.2V76M150 32.2V56M175 26.8V44M200 25V40M225 26.8V44M250 32.2V56M275 41.2V76M300 53.8V104" />
        <path d="M75 70L100 104M100 53.8L125 76M125 41.2L150 56M150 32.2L175 44M175 26.8L200 40M200 40L225 26.8M225 44L250 32.2M250 56L275 41.2M275 76L300 53.8M300 104L325 70" />
      </g>
      {/* Hangers from the arch down to the deck. */}
      <path className="bridge__hangers" d="M125 76V100M150 56V100M175 44V100M200 40V100M225 44V100M250 56V100M275 76V100" />
      {/* Deck, running out over the approach spans on both sides. */}
      <path className="bridge__deck" d="M0 100H400" />
      <path className="bridge__hangers" d="M20 100V150M355 100V150M380 100V150" />
      {/* Pylons, a pair at each end of the arch. */}
      <g className="bridge__pylons">
        <path d="M44 150V52H50V44H64V52H70V150Z" />
        <path d="M330 150V52H336V44H350V52H356V150Z" />
      </g>
    </svg>
  );
}
