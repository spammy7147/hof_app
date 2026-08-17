export const CHARACTER_PATTERN_THRESHOLDS = [10, 15, 30, 50, 80, 120, 160, 200, 250] as const;

export type PatternStatRecommendation = {
  additionalPatterns: number;
  targetRequirement: number;
  addInt: number;
  addSpd: number;
  pointsUsed: number;
  pointsRemaining: number;
};

export function calculatePatternRequirement(realInt: number, realSpd: number) {
  const requirement = Math.max(0, realInt) + Math.floor(Math.max(0, realSpd) / 5);
  return { requirement, additionalPatterns: CHARACTER_PATTERN_THRESHOLDS.filter((threshold) => requirement >= threshold).length };
}

/** 원본 규칙대로 목표 구간 안에서 INT 투자를 최소화하고 SPD를 최대화한다. */
export function recommendPatternStats(realInt: number, realSpd: number, availablePoints: number, additionalPatterns: number): PatternStatRecommendation | null {
  const target = CHARACTER_PATTERN_THRESHOLDS[additionalPatterns - 1];
  if (target == null || calculatePatternRequirement(realInt, realSpd).requirement > target) return null;
  for (let addInt = 0; addInt <= availablePoints; addInt += 1) {
    const minSpd = Math.max(0, 5 * (target - realInt - addInt) - realSpd);
    const maxSpd = Math.max(-1, 5 * (target - realInt - addInt + 1) - 1 - realSpd);
    const addSpd = Math.min(availablePoints - addInt, maxSpd);
    if (addSpd >= minSpd && calculatePatternRequirement(realInt + addInt, realSpd + addSpd).requirement === target) {
      return { additionalPatterns, targetRequirement: target, addInt, addSpd, pointsUsed: addInt + addSpd, pointsRemaining: availablePoints - addInt - addSpd };
    }
  }
  return null;
}
