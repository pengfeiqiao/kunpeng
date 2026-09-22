/** One-entry cache for immutable store projections; never retains a history of projects. */
export function memoizeLast<Args extends unknown[], Result>(project: (...args: Args) => Result): (...args: Args) => Result {
  let previous: Args | undefined;
  let result: Result;
  return (...args) => {
    if (previous && previous.length === args.length && args.every((arg, index) => Object.is(arg, previous![index]))) return result;
    const next = project(...args);
    previous = args;
    result = next;
    return next;
  };
}
