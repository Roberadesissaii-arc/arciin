// ── Postgres type catalogue ────────────────────────────────────────────────────

export type PgTypeGroup = "Numeric" | "Text" | "JSON" | "Date / Time" | "Other"

export type PgTypeDef = {
  value: string
  label: string
  group: PgTypeGroup
  icon: string
}

export const PG_TYPES: PgTypeDef[] = [
  { value: "int2",        label: "Signed two-byte integer",              group: "Numeric",     icon: "#" },
  { value: "int4",        label: "Signed four-byte integer",             group: "Numeric",     icon: "#" },
  { value: "int8",        label: "Signed eight-byte integer",            group: "Numeric",     icon: "#" },
  { value: "float4",      label: "Single precision floating-point (4 bytes)", group: "Numeric", icon: "#" },
  { value: "float8",      label: "Double precision floating-point (8 bytes)", group: "Numeric", icon: "#" },
  { value: "numeric",     label: "Exact numeric of selectable precision", group: "Numeric",    icon: "#" },
  { value: "json",        label: "Textual JSON data",                    group: "JSON",        icon: "{}" },
  { value: "jsonb",       label: "Binary JSON data, decomposed",         group: "JSON",        icon: "{}" },
  { value: "text",        label: "Variable-length character string",     group: "Text",        icon: "T" },
  { value: "varchar",     label: "Variable-length character string",     group: "Text",        icon: "T" },
  { value: "uuid",        label: "Universally unique identifier",        group: "Text",        icon: "T" },
  { value: "date",        label: "Calendar date (year, month, day)",     group: "Date / Time", icon: "▦" },
  { value: "time",        label: "Time of day (no time zone)",           group: "Date / Time", icon: "▦" },
  { value: "timetz",      label: "Time of day, including time zone",     group: "Date / Time", icon: "▦" },
  { value: "timestamp",   label: "Date and time (no time zone)",         group: "Date / Time", icon: "▦" },
  { value: "timestamptz", label: "Date and time, including time zone",   group: "Date / Time", icon: "▦" },
  { value: "bool",        label: "Logical boolean (true/false)",         group: "Other",       icon: "≡" },
  { value: "bytea",       label: "Variable-length binary string",        group: "Other",       icon: "≡" },
]

export const PG_GROUPS = ["Numeric", "Text", "JSON", "Date / Time", "Other"] as PgTypeGroup[]
