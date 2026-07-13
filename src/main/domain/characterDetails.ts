import type { HofCharacterDetail, HofCharacterSkill } from '../types/api';

export type CharacterDetailMetric = {
  label: string;
  value: string;
};

export type SkillGroup = {
  category: string;
  skills: HofCharacterSkill[];
};

/**
 * 캐릭터 상세 화면 상단에 보여줄 핵심 스탯 카드 목록을 만든다.
 */
export function buildCharacterDetailMetrics(detail: HofCharacterDetail): CharacterDetailMetric[] {
  const stats = detail.stats;

  return [
    { label: 'Atk', value: formatOptionalNumber(stats.atk) },
    { label: 'Matk', value: formatOptionalNumber(stats.matk) },
    { label: 'Def', value: formatBaseBonus(stats.defBase, stats.defBonus) },
    { label: 'Mdef', value: formatBaseBonus(stats.mdefBase, stats.mdefBonus) },
    { label: 'handle', value: formatPair(stats.handleUsed, stats.handleMax) },
    { label: 'cost', value: formatPair(stats.costUsed, stats.costMax) },
  ];
}

/**
 * 배운 스킬/배울 수 있는 스킬을 원본 카테고리 이름별로 묶는다.
 */
export function groupSkillsByCategory(skills: HofCharacterSkill[]): SkillGroup[] {
  const groups = new Map<string, HofCharacterSkill[]>();
  skills.forEach((skill) => {
    const category = skill.category.trim() || '기타';
    groups.set(category, [...(groups.get(category) ?? []), skill]);
  });

  return [...groups.entries()].map(([category, groupedSkills]) => ({
    category,
    skills: groupedSkills,
  }));
}

/**
 * 캐릭터 스탯 값이 없을 때 빈칸 대신 `-`로 통일해서 표시한다.
 */
function formatOptionalNumber(value: number | null): string {
  return value == null ? '-' : value.toLocaleString('en-US');
}

/**
 * 방어력처럼 기본값과 보너스가 분리된 스탯을 `기본 + 보너스` 형태로 만든다.
 */
function formatBaseBonus(
  base: number | null,
  bonus: number | null,
): string {
  if (base == null && bonus == null) return '-';
  if (bonus == null) return formatOptionalNumber(base);
  return `${formatOptionalNumber(base)} + ${formatOptionalNumber(bonus)}`;
}

/**
 * handle/cost처럼 사용량과 최대치가 함께 있는 스탯을 `사용/최대` 문자열로 만든다.
 */
function formatPair(
  used: number | null,
  max: number | null,
): string {
  if (used == null && max == null) return '-';
  return `${formatOptionalNumber(used)}/${formatOptionalNumber(max)}`;
}
