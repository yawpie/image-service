const DEFAULT_CORS_ORIGINS = [
  "https://smkn4mtr.sch.id",
  "https://admin.smkn4mtr.sch.id",
  "https://landing.dev.smkn4mtr.sch.id",
  "https://admin.dev.smkn4mtr.sch.id",
];

export function resolveCorsOrigins(configured?: string): string[] {
  if (!configured?.trim()) return [...DEFAULT_CORS_ORIGINS];

  // Preserve the existing JSON array format documented in .env.example.
  const parsed: unknown = JSON.parse(configured);
  if (!Array.isArray(parsed) || !parsed.every(origin => typeof origin === "string")) {
    throw new Error("CORS_ORIGIN must be a JSON array of strings");
  }
  return [...new Set([...DEFAULT_CORS_ORIGINS, ...parsed.map(origin => origin.trim()).filter(Boolean)])];
}
