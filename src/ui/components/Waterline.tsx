/**
 * The waterline: where the sand of one section meets the harbour of the next.
 * A filled wave in the next section's colour, with a thin crest line on top.
 * The wave tile repeats so it can drift sideways (disabled under prefers-reduced-motion).
 */
export function Waterline({ className = '' }: { className?: string }) {
  // One 240-unit wave period, drawn twice so a -50% translate loops seamlessly.
  const crest = 'M0 22 C 30 10, 90 10, 120 22 S 210 34, 240 22 S 330 10, 360 22 S 450 34, 480 22';
  return (
    <div className={`waterline ${className}`} aria-hidden="true">
      <svg className="waterline__svg" viewBox="0 0 480 48" preserveAspectRatio="none" focusable="false">
        <path className="waterline__water" d={`${crest} L480 48 L0 48 Z`} />
        <path className="waterline__salt" d={crest} />
      </svg>
    </div>
  );
}
