export const ACTOR_IDENTITY_COLORS = [
  '#6ea8fe',
  '#f28b82',
  '#81c995',
  '#c58af9',
  '#f6c85f',
  '#78d9ec',
  '#ff9e64',
  '#b6a0ff',
] as const;

export function actorIdentityColor(index: number): string {
  return ACTOR_IDENTITY_COLORS[Math.abs(index) % ACTOR_IDENTITY_COLORS.length];
}
