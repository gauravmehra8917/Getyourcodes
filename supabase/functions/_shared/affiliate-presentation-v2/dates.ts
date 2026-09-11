export interface ProjectedUtcDateV2 {
  ok: true;
  value: string | null;
}

export interface InvalidUtcDateV2 {
  ok: false;
  value: null;
}

export type UtcDateProjectionV2 = ProjectedUtcDateV2 | InvalidUtcDateV2;

export type EffectiveDateSourceV2 =
  | "deal_start_date"
  | "start_date"
  | "deal_end_date"
  | "end_date";

export interface EffectiveDateFieldsV2 {
  dealStartDate: string | null;
  startDate: string | null;
  dealEndDate: string | null;
  endDate: string | null;
}

export interface EffectiveDateProjectionSuccessV2 {
  ok: true;
  startDate: string | null;
  expiryDate: string | null;
  startSource:
    | Extract<
      EffectiveDateSourceV2,
      "deal_start_date" | "start_date"
    >
    | null;
  endSource:
    | Extract<
      EffectiveDateSourceV2,
      "deal_end_date" | "end_date"
    >
    | null;
}

export interface EffectiveDateProjectionFailureV2 {
  ok: false;
  reason: "invalid_start_date" | "invalid_end_date" | "invalid_date_range";
}

export type EffectiveDateProjectionV2 =
  | EffectiveDateProjectionSuccessV2
  | EffectiveDateProjectionFailureV2;

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const EXPLICIT_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i;

export function isValidDateOnlyV2(value: string): boolean {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return date.toISOString().slice(0, 10) === value;
}

export function isExplicitEvaluationTimestampV2(value: string): boolean {
  const match = EXPLICIT_TIMESTAMP_PATTERN.exec(value);
  if (!match || !isValidDateOnlyV2(value.slice(0, 10))) return false;
  return Number.isFinite(Date.parse(value));
}

/** Projects a valid date or explicit-zone timestamp onto its represented UTC date. */
export function projectUtcDateV2(value: string | null): UtcDateProjectionV2 {
  if (value === null) return { ok: true, value: null };
  if (isValidDateOnlyV2(value)) return { ok: true, value };
  if (!isExplicitEvaluationTimestampV2(value)) {
    return { ok: false, value: null };
  }
  return {
    ok: true,
    value: new Date(Date.parse(value)).toISOString().slice(0, 10),
  };
}

export function evaluationUtcDateV2(evaluationTimestamp: string): string {
  if (!isExplicitEvaluationTimestampV2(evaluationTimestamp)) {
    throw new TypeError(
      "evaluationTimestamp must be an explicit valid date-time with a zone",
    );
  }
  return new Date(Date.parse(evaluationTimestamp)).toISOString().slice(0, 10);
}

export function evaluationYearV2(evaluationTimestamp: string): number {
  evaluationUtcDateV2(evaluationTimestamp);
  return new Date(Date.parse(evaluationTimestamp)).getUTCFullYear();
}

function representedInstant(value: string): number {
  return isValidDateOnlyV2(value)
    ? Date.parse(`${value}T00:00:00.000Z`)
    : Date.parse(value);
}

/**
 * Provider-native deal dates take precedence. A present invalid preferred date
 * fails closed; it never falls through to the lower-priority base date.
 */
export function projectEffectiveDatesV2(
  fields: EffectiveDateFieldsV2,
): EffectiveDateProjectionV2 {
  const selectedStart = fields.dealStartDate !== null
    ? {
      value: fields.dealStartDate,
      source: "deal_start_date" as const,
    }
    : fields.startDate !== null
    ? { value: fields.startDate, source: "start_date" as const }
    : null;
  const selectedEnd = fields.dealEndDate !== null
    ? { value: fields.dealEndDate, source: "deal_end_date" as const }
    : fields.endDate !== null
    ? { value: fields.endDate, source: "end_date" as const }
    : null;

  const start = projectUtcDateV2(selectedStart?.value ?? null);
  if (!start.ok) return { ok: false, reason: "invalid_start_date" };
  const end = projectUtcDateV2(selectedEnd?.value ?? null);
  if (!end.ok) return { ok: false, reason: "invalid_end_date" };

  if (
    selectedStart !== null && selectedEnd !== null &&
    representedInstant(selectedStart.value) >
      representedInstant(selectedEnd.value)
  ) {
    return { ok: false, reason: "invalid_date_range" };
  }

  return {
    ok: true,
    startDate: start.value,
    expiryDate: end.value,
    startSource: selectedStart?.source ?? null,
    endSource: selectedEnd?.source ?? null,
  };
}
