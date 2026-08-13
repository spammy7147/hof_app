const KNOWN_UNION_MAP_NAMES: Readonly<Record<string, string>> = {
  '0003': '도적소탕',
  '0004': '사막의 살인적',
};

export function resolveUnionMapDisplayName(mapCode: string, observedName?: string | null): string {
  const normalizedName = observedName?.trim();
  if (normalizedName && normalizedName !== mapCode) return normalizedName;
  return KNOWN_UNION_MAP_NAMES[mapCode] ?? normalizedName ?? mapCode;
}
