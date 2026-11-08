import { buildAnswer, classifySafety, draftPlanFor, resolveQuery } from "./retrieval.js";

export function buildSourceAnswer({ record, ...context }) {
  // Opening a specific lesson is an explicit selection, rather than a new
  // ranking request. Safety routing still takes priority over practice steps.
  if (record && !classifySafety(resolveQuery(context.query, context.previousQuery))) return draftPlanFor(record);
  return buildAnswer(context);
}
