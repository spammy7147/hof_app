import type { ReactNode } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  displayCharacterJob,
  displayCharacterName,
  formatCharacterLevel,
} from '../domain/characters';
import {
  buildCharacterDetailMetrics,
  type CharacterDetailMetric,
} from '../domain/characterDetails';
import { normalizeHofAssetUrl } from '../domain/hofAssets';
import { theme } from '../styles/theme';
import type {
  HofCharacter,
  HofCharacterDetail,
  HofCharacterEquipment,
  HofCharacterPatternSlot,
  LoadPatternResponse,
} from '../types/api';

type CharacterDetailProps = {
  character: HofCharacter;
  detail: HofCharacterDetail | null;
  isLoading: boolean;
  errorMessage: string | null;
  onLoadPattern?: (hofCharacterId: string, slot: number) => Promise<LoadPatternResponse>;
};

/**
 * 캐릭터 상세 화면이다.
 *
 * 저장 패턴 로드, 핵심 스탯, 장착 장비를 한 화면에 보여준다.
 */
export function CharacterDetail({
  character,
  detail,
  isLoading,
  errorMessage,
  onLoadPattern,
}: CharacterDetailProps) {
  const [loadingPatternSlot, setLoadingPatternSlot] = useState<string | null>(null);
  const [patternMessage, setPatternMessage] = useState<string | null>(null);
  const [patternErrorMessage, setPatternErrorMessage] = useState<string | null>(null);
  const name = displayCharacterName(character);
  const metrics = detail ? buildCharacterDetailMetrics(detail) : [];

  /**
   * 선택한 저장 패턴 슬롯을 HOF 원본 서버에 로드하도록 백엔드에 요청한다.
   */
  async function loadPatternSlot(slot: HofCharacterPatternSlot) {
    if (!onLoadPattern) return;

    const slotNumber = Number.parseInt(slot.slot, 10);
    if (Number.isNaN(slotNumber)) {
      setPatternMessage(null);
      setPatternErrorMessage('패턴 번호를 읽지 못했습니다.');
      return;
    }

    setLoadingPatternSlot(slot.slot);
    setPatternMessage(null);
    setPatternErrorMessage(null);

    try {
      const response = await onLoadPattern(character.hofCharacterId, slotNumber);
      setPatternMessage(response.message);
    } catch (error) {
      setPatternErrorMessage(error instanceof Error ? error.message : '패턴 로드에 실패했습니다.');
    } finally {
      setLoadingPatternSlot(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Avatar name={name} imageUrl={detail?.imageUrl ?? null} />
        <View style={styles.headerText}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.subtitle}>
            {formatCharacterLevel(character)} · {displayCharacterJob(character)}
          </Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingPanel}>
          <ActivityIndicator color={theme.colors.accentGreen} />
          <Text style={styles.loadingText}>캐릭터 상세 정보를 불러오는 중</Text>
        </View>
      ) : null}

      {errorMessage != null && errorMessage.length > 0 ? (
        <Text style={styles.errorText}>{errorMessage}</Text>
      ) : null}

      {detail ? (
        <>
          <Section title="저장 패턴">
            <PatternSlotList
              loadingSlot={loadingPatternSlot}
              onLoadSlot={onLoadPattern ? loadPatternSlot : undefined}
              slots={detail.patternSlots}
            />
            {patternMessage != null && patternMessage.length > 0 ? (
              <Text style={styles.successText}>{patternMessage}</Text>
            ) : null}
            {patternErrorMessage != null && patternErrorMessage.length > 0 ? (
              <Text style={styles.inlineErrorText}>{patternErrorMessage}</Text>
            ) : null}
          </Section>

          <Section title="스탯">
            <View style={styles.statGrid}>
              {metrics.map((metric) => (
                <StatMetric key={metric.label} metric={metric} />
              ))}
            </View>
          </Section>

          <Section title="장착 장비">
            <EquipmentList equipment={detail.equipment} />
          </Section>
        </>
      ) : null}
    </View>
  );
}

type AvatarProps = {
  name: string;
  imageUrl: string | null;
};

/**
 * 캐릭터 이미지가 있으면 실제 이미지를, 없으면 이름 첫 글자 fallback을 보여준다.
 */
function Avatar({ name, imageUrl }: AvatarProps) {
  const normalizedImageUrl = normalizeHofAssetUrl(imageUrl);

  return (
    <View style={styles.avatar}>
      {normalizedImageUrl ? (
        <Image source={{ uri: normalizedImageUrl }} style={styles.avatarImage} resizeMode="contain" />
      ) : (
        <Text style={styles.avatarText}>{name.slice(0, 1)}</Text>
      )}
    </View>
  );
}

type StatMetricProps = {
  metric: CharacterDetailMetric;
};

/**
 * 캐릭터 상세의 단일 스탯 카드다.
 */
function StatMetric({ metric }: StatMetricProps) {
  return (
    <View style={styles.statMetric}>
      <Text style={styles.statLabel}>{metric.label}</Text>
      <Text style={styles.statValue}>{metric.value}</Text>
    </View>
  );
}

type SectionProps = {
  title: string;
  children: ReactNode;
};

/**
 * 캐릭터 상세 화면의 반복되는 섹션 레이아웃을 만든다.
 */
function Section({ title, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

type PatternSlotListProps = {
  loadingSlot: string | null;
  onLoadSlot?: (slot: HofCharacterPatternSlot) => void;
  slots: HofCharacterPatternSlot[];
};

/**
 * 캐릭터가 저장해둔 패턴 슬롯 목록을 보여준다.
 *
 * 로드 가능한 슬롯은 버튼처럼 동작하고, 빈 슬롯은 비활성 상태로 표시한다.
 */
function PatternSlotList({ loadingSlot, onLoadSlot, slots }: PatternSlotListProps) {
  if (slots.length === 0) {
    return <Text style={styles.emptyText}>저장된 패턴 슬롯이 없습니다.</Text>;
  }

  return (
    <View style={styles.cardList}>
      {slots.map((slot) => (
        <Pressable
          accessibilityRole="button"
          disabled={!slot.canLoad || !onLoadSlot || loadingSlot != null}
          key={slot.slot}
          onPress={() => onLoadSlot?.(slot)}
          style={({ pressed }) => [
            styles.patternCard,
            slot.canLoad && onLoadSlot && styles.loadablePatternCard,
            (!slot.canLoad || !onLoadSlot) && styles.disabledPatternCard,
            pressed && styles.pressedCard,
          ]}
        >
          <View style={styles.patternCardText}>
            <Text style={styles.patternName} numberOfLines={1}>
              {slot.label || formatPatternSlotLabel(slot.slot)}
            </Text>
            <Text style={styles.patternMeta} numberOfLines={1}>
              {slot.canLoad ? '전투 전에 불러올 수 있음' : '비어 있는 슬롯'}
            </Text>
          </View>
          <Text style={[styles.patternActionText, !slot.canLoad && styles.disabledActionText]}>
            {loadingSlot === slot.slot ? '로드 중' : slot.canLoad ? '로드' : '빈 슬롯'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

type EquipmentListProps = {
  equipment: HofCharacterEquipment[];
};

/**
 * 캐릭터의 장착 장비 목록을 장비 부위별 카드로 표시한다.
 */
function EquipmentList({ equipment }: EquipmentListProps) {
  if (equipment.length === 0) {
    return <Text style={styles.emptyText}>저장된 장착 장비가 없습니다.</Text>;
  }

  return (
    <View style={styles.cardList}>
      {equipment.map((item) => (
        <View key={`${item.slot}-${item.name}`} style={styles.equipmentCard}>
          <Text style={styles.equipmentPart}>{item.part || item.slot || '-'}</Text>
          <View style={styles.equipmentBody}>
            <Text style={styles.equipmentName} numberOfLines={2}>{item.name}</Text>
            {item.description ? (
              <Text style={styles.equipmentDescription} numberOfLines={3}>{item.description}</Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * 원본 슬롯 번호를 사용자가 읽는 1부터 시작하는 패턴 번호 라벨로 바꾼다.
 */
function formatPatternSlotLabel(slot: string): string {
  const slotNumber = Number.parseInt(slot, 10);
  return Number.isNaN(slotNumber) ? `패턴 ${slot}` : `패턴 ${slotNumber + 1}`;
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: theme.spacing.lg,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.accentGreen,
    overflow: 'hidden',
  },
  avatarImage: {
    width: 46,
    height: 46,
  },
  avatarText: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  subtitle: {
    marginTop: 4,
    color: theme.colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  loadingPanel: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
  },
  loadingText: {
    color: theme.colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  errorText: {
    color: theme.colors.danger,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    borderRadius: theme.radius.sm,
    padding: theme.spacing.md,
    fontSize: 14,
    lineHeight: 20,
  },
  successText: {
    color: theme.colors.accentGreen,
    fontSize: 12,
    fontWeight: '800',
  },
  inlineErrorText: {
    color: theme.colors.danger,
    fontSize: 12,
    fontWeight: '800',
  },
  section: {
    gap: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.lg,
  },
  sectionTitle: {
    color: theme.colors.accentGreen,
    fontSize: 15,
    fontWeight: '900',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  statMetric: {
    width: '31%',
    minWidth: 94,
    minHeight: 54,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  statLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  statValue: {
    marginTop: 4,
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  cardList: {
    gap: theme.spacing.sm,
  },
  patternCard: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  loadablePatternCard: {
    borderColor: theme.colors.accentGreen,
  },
  disabledPatternCard: {
    opacity: 0.62,
  },
  pressedCard: {
    opacity: 0.75,
  },
  patternCardText: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  patternName: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  patternMeta: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  patternActionText: {
    color: theme.colors.accentAmber,
    fontSize: 12,
    fontWeight: '900',
  },
  disabledActionText: {
    color: theme.colors.textMuted,
  },
  equipmentCard: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
  },
  equipmentPart: {
    minWidth: 70,
    maxWidth: 86,
    color: theme.colors.accentAmber,
    fontSize: 12,
    fontWeight: '900',
  },
  equipmentBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  equipmentName: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  equipmentDescription: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
});
