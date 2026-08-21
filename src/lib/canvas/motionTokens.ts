/**
 * Shared framer-motion presets for canvas UI — keeps entrance/exit motion
 * consistent (restrained, 120-200ms, easeOut) across panels and menus.
 */
export const DUR = {
  fast: 0.12,
  base: 0.15,
  slow: 0.2,
} as const;

export const EASE = [0.25, 0.1, 0.25, 1] as const; // standard easeOut-ish

/** Menu / popover entrance: scale .9 + fade, 150ms (TapNow/LibTV pattern). */
export const popIn = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.9 },
  transition: { duration: DUR.base, ease: EASE },
};

/** Bottom-sheet / composer entrance. */
export const slideUpIn = {
  initial: { opacity: 0, y: 12, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 12, scale: 0.97 },
  transition: { duration: DUR.slow, ease: EASE },
};

/** Side-drawer entrance. */
export const slideInLeft = {
  initial: { opacity: 0, x: -16 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -16 },
  transition: { duration: DUR.base, ease: EASE },
};

export const SPRING_SNAPPY = { type: 'spring' as const, stiffness: 400, damping: 28 };
