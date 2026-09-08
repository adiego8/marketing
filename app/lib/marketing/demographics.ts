// The demographic dimensions the ICP tab always offers.
//
// This used to be a bare `["industry", "company_size", "role", "revenue_range"]`
// inline in the editor. Two problems with that. It was B2B-shaped, so a product
// sold to individuals had nowhere to record who those individuals are; and any
// key outside the four was invisible — the editor never rendered it, though a
// save preserved it, so data written by the API or the intake prompt sat in
// Firestore unreachable.
//
// So: a fixed set that always renders, plus custom keys for the dimension only
// this client has (a tax product cares about filing complexity; nobody else
// does). Same shape as CONTENT_TYPES in ./content-types.ts.

export interface DemographicField {
  key: string;
  label: string;
  /** Shown under the input when the field only applies to some clients. */
  hint?: string;
}

export const DEMOGRAPHIC_FIELDS: readonly DemographicField[] = [
  { key: "customer_type", label: "Customer type", hint: "An individual, or a business" },
  { key: "industry", label: "Industry" },
  { key: "role", label: "Role" },
  { key: "location", label: "Location" },
  { key: "age_range", label: "Age range" },
  { key: "language", label: "Language" },
  { key: "company_size", label: "Company size", hint: "B2B only" },
  { key: "income_or_revenue", label: "Income / revenue" },
];

const FIXED_KEYS = new Set(DEMOGRAPHIC_FIELDS.map((f) => f.key));

/**
 * A typed label to a storage key: "Tax complexity" -> "tax_complexity".
 *
 * Every run of anything that is not a letter or a digit becomes one underscore,
 * so "Household size (est.)" and "Household size — est" land on the same key
 * rather than two near-identical rows.
 */
export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Stored keys that are not one of the fixed fields, in insertion order. */
export function customDemographicKeys(
  demographics: Record<string, unknown>
): string[] {
  return Object.keys(demographics).filter((key) => !FIXED_KEYS.has(key));
}

/** The heading for a key — the field's own label, or the key made readable. */
export function demographicLabel(key: string): string {
  const known = DEMOGRAPHIC_FIELDS.find((f) => f.key === key);
  if (known) return known.label;
  const words = key.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}
