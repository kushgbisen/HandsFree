/**
 * Compound-task splitter. "open youtube, search Interstellar, play the first
 * vid" → three tasks. Conservative by design: a split is accepted only when
 * EVERY part starts with an action verb, so "search for cats and dogs" and
 * "search for fish, chips and curry" stay single tasks.
 */
export const MAX_TASKS = 5;
const STRONG_SEP =
  /\s+(?:and then|then|after that|followed by|next|finally)\s+|[,;]\s*|\s+[1-9][.)]\s+/i;
const VERBS =
  /^(open|go to|visit|search|look up|find|play|watch|click|press|tap|type|fill|enter|set|change|scroll|pause|mute|comment|like|subscribe|go|navigate|stop)\b/i;
/** Split a compound command into subtasks (max MAX_TASKS). Never over-splits. */
export function splitGoal(goal) {
  const clean = goal.trim().replace(/[.?!]+$/, '');
  let parts = clean
    .split(STRONG_SEP)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
  if (parts.length < 2 && /\band\b/i.test(clean)) {
    const sides = clean
      .split(/\band\b/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 1);
    if (sides.length > 1 && sides.every((s) => VERBS.test(s))) parts = sides;
  }
  // every part must be action-led, else the separators were inside one task
  if (parts.length > 1 && !parts.every((p) => VERBS.test(p))) return [clean];
  if (parts.length > MAX_TASKS) parts = parts.slice(0, MAX_TASKS);
  return parts.length ? parts : [clean];
}
