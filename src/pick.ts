// pick.ts — the omit-when-absent primitive. exactOptionalPropertyTypes
// forbids assigning `undefined` to an optional key, and zod KEEPS
// undefined keys on output (verified against 4.6), so optional wire
// sections are built by SPREADING this helper:
//
//   ...pick("stats", node.stats)   // key present only when defined
//
// One primitive, one home — never a scattered conditional ternary.
export function pick<K extends string, V>(
  key: K,
  value: V | undefined,
): { [P in K]: V } | Record<never, never> {
  return value === undefined ? {} : { [key]: value };
}
