import type { CSSProperties } from 'react';

function fireContour(phase: number, floor: number, primary: number, secondary: number): string {
  const points = [`0,${floor}`];
  let previousY = floor;
  for (let x = 0; x <= 320; x += 2) {
    const broad = Math.pow(Math.max(0, Math.sin((x + phase) * 0.115)), 4);
    const narrow = Math.pow(Math.max(0, Math.sin((x + phase * 1.7) * 0.267)), 10);
    const ripple = Math.pow(Math.max(0, Math.sin((x - phase) * 0.061)), 3);
    const y = Math.round((floor - 7 - broad * primary - narrow * secondary - ripple * 9) / 2) * 2;
    points.push(`${x},${previousY}`, `${x},${y}`);
    previousY = y;
  }
  points.push(`320,${floor}`);
  return points.join(' ');
}

export function StandupFireEffect({ paused, heat }: { paused: boolean; heat: number }) {
  const emberCount = 10 + heat * 7;
  return <div className={`standup-fire-effect heat-${heat}${paused ? ' is-paused' : ''}`} aria-hidden="true">
    <svg className="standup-fire-sheet" viewBox="0 0 320 180" preserveAspectRatio="none" focusable="false">
      <polygon className="standup-fire-layer standup-fire-outer" points={fireContour(5, 180, 84, 40)} />
      <polygon className="standup-fire-layer standup-fire-middle" points={fireContour(23, 180, 60, 29)} />
      <polygon className="standup-fire-layer standup-fire-core" points={fireContour(41, 180, 35, 18)} />
    </svg>
    <span className="standup-fire-embers">{Array.from({ length: emberCount }, (_, index) => {
      const style = { '--standup-ember-x': `${(index * 29 + 7) % 97}%`, '--standup-ember-y': `${8 + (index * 17) % 72}%`, '--standup-ember-delay': `${-(index % 7) * 0.19}s` } as CSSProperties;
      return <b key={index} style={style} />;
    })}</span>
  </div>;
}
