export interface EvolutionCursorState {
  offset: number;
  cursorTs?: number;
  cursorCountAtTs?: number;
}

export interface TimestampedTrajectory {
  ts: number;
}

/**
 * Select records not covered by the durable cursor. The timestamp ordinal
 * keeps concurrent records created in the same millisecond distinct, while
 * `offset` remains as a compatibility fallback for old state files.
 */
export function freshTrajectories<T extends TimestampedTrajectory>(
  trajectories: T[],
  state: EvolutionCursorState,
): T[] {
  if (Number.isFinite(state.cursorTs)) {
    const cursorTs = Number(state.cursorTs);
    let sameTsSeen = 0;
    return trajectories.filter((trajectory) => {
      if (trajectory.ts < cursorTs) return false;
      if (trajectory.ts > cursorTs) return true;
      sameTsSeen += 1;
      return sameTsSeen > Math.max(0, state.cursorCountAtTs ?? 0);
    });
  }
  const offset = state.offset > trajectories.length ? 0 : Math.max(0, state.offset);
  return trajectories.slice(offset);
}

export function cursorForTrajectories<T extends TimestampedTrajectory>(
  trajectories: T[],
): Pick<EvolutionCursorState, 'cursorTs' | 'cursorCountAtTs'> {
  const cursorTs = trajectories.length > 0 ? trajectories[trajectories.length - 1].ts : undefined;
  if (!Number.isFinite(cursorTs)) return {};
  return {
    cursorTs,
    cursorCountAtTs: trajectories.filter((trajectory) => trajectory.ts === cursorTs).length,
  };
}
