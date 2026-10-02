import type { Transition } from 'motion/react';

/** The three springs from the design spec, set by response (seconds) and damping ratio, like SwiftUI. */
export function spring(response: number, dampingRatio: number): Transition {
  return {
    type: 'spring',
    stiffness: ((2 * Math.PI) / response) ** 2,
    damping: (4 * Math.PI * dampingRatio) / response,
    mass: 1,
  };
}

export const springs = {
  /** Hover, toggles, segmented controls, indicators. */
  snappy: spring(0.32, 0.86),
  /** Page turns, panels, opening a book. Anything that holds text. */
  smooth: spring(0.5, 1),
  /** Small objects you touch directly. Never text. */
  bouncy: spring(0.55, 0.68),
};
