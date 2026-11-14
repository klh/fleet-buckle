// pick.ts — the omit-when-absent primitive. exactOptionalPropertyTypes
// forbids assigning `undefined` to an optional key, and zod KEEPS
// undefined keys on output (verified against 4.6), so optional wire
// sections are built by SPREADING this helper:
//
//   ...pick("stats", node.stats)   // key present only when defined
//
// Absent = undefined OR null (the two "nothing answered" shapes —
// headers.get returns null; optionals carry undefined). One
// primitive, one home — never a scattered conditional ternary.
export function pick<K extends string, V>(
  key: K,
  value: V | null | undefined,
): { [P in K]: V } | Record<never, never> {
  return value === undefined || value === null ? {} : { [key]: value };
}
