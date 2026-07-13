import { memo, useCallback, useMemo } from 'react';
import { Image, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';

import {
  displayCharacterName,
  formatCharacterLevel,
  type CharacterGroup,
  groupCharactersByJob,
} from '../domain/characters';
import { normalizeHofAssetUrl } from '../domain/hofAssets';
import { theme } from '../styles/theme';
import type { HofCharacter } from '../types/api';

type CharacterListProps = {
  characters: HofCharacter[];
  onSelectCharacter: (character: HofCharacter) => void;
};

type CharacterSection = CharacterGroup & {
  data: HofCharacter[];
};

/**
 * 동기화된 캐릭터 목록을 직업별 섹션으로 보여주는 화면 조각이다.
 */
export function CharacterList({ characters, onSelectCharacter }: CharacterListProps) {
  const sections = useMemo<CharacterSection[]>(
    () => groupCharactersByJob(characters).map((group) => ({
      ...group,
      data: group.characters,
    })),
    [characters],
  );
  const charactersById = useMemo(
    () => new Map(characters.map((character) => [character.hofCharacterId, character])),
    [characters],
  );
  /**
   * row 컴포넌트는 ID만 넘기므로 실제 캐릭터 객체를 찾아 상위 화면에 전달한다.
   */
  const handlePressCharacter = useCallback((hofCharacterId: string) => {
    const character = charactersById.get(hofCharacterId);
    if (character) {
      onSelectCharacter(character);
    }
  }, [charactersById, onSelectCharacter]);
  /**
   * SectionList의 캐릭터 한 명 row를 렌더링한다.
   */
  const renderItem = useCallback(({ item }: { item: HofCharacter }) => (
    <CharacterRow
      hofCharacterId={item.hofCharacterId}
      imageUrl={item.imageUrl ?? null}
      job={item.job.trim() || '미분류'}
      levelText={formatCharacterLevel(item)}
      name={displayCharacterName(item)}
      onPressCharacter={handlePressCharacter}
    />
  ), [handlePressCharacter]);
  /**
   * 직업별 그룹 제목을 렌더링한다.
   */
  const renderSectionHeader = useCallback(({ section }: { section: CharacterSection }) => (
    <Text style={styles.groupTitle}>{section.headerText}</Text>
  ), []);

  if (characters.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>캐릭터 0명</Text>
        <Text style={styles.emptyText}>로그인 후 캐릭터 동기화를 진행하세요.</Text>
      </View>
    );
  }

  return (
    <SectionList
      contentContainerStyle={styles.listContent}
      contentInsetAdjustmentBehavior="automatic"
      ItemSeparatorComponent={ListItemSeparator}
      keyExtractor={(item) => item.hofCharacterId}
      renderItem={renderItem}
      renderSectionHeader={renderSectionHeader}
      SectionSeparatorComponent={SectionSeparator}
      sections={sections}
      stickySectionHeadersEnabled={false}
      style={styles.list}
    />
  );
}

type CharacterRowProps = {
  hofCharacterId: string;
  imageUrl: string | null;
  name: string;
  levelText: string;
  job: string;
  onPressCharacter: (hofCharacterId: string) => void;
};

/**
 * 캐릭터 목록의 한 줄이다.
 *
 * memo로 감싸서 SSE 동기화 중 다른 캐릭터가 추가되어도 변경되지 않은 row 렌더링을 줄인다.
 */
const CharacterRow = memo(function CharacterRow({
  hofCharacterId,
  imageUrl,
  name,
  levelText,
  job,
  onPressCharacter,
}: CharacterRowProps) {
  const normalizedImageUrl = normalizeHofAssetUrl(imageUrl);
  /**
   * 부모에게 전체 row 객체 대신 안정적인 HOF 캐릭터 ID만 전달한다.
   */
  const handlePress = useCallback(() => {
    onPressCharacter(hofCharacterId);
  }, [hofCharacterId, onPressCharacter]);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.avatar}>
        {normalizedImageUrl ? (
          <Image source={{ uri: normalizedImageUrl }} style={styles.avatarImage} resizeMode="contain" />
        ) : (
          <Text style={styles.avatarText}>{name.slice(0, 1)}</Text>
        )}
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {levelText} · {job}
        </Text>
      </View>
    </Pressable>
  );
});

/**
 * 캐릭터 목록의 행 사이 간격을 책임지는 작은 컴포넌트다.
 */
function ListItemSeparator() {
  return <View style={styles.itemSeparator} />;
}

/**
 * 직업 섹션 사이 간격을 책임지는 작은 컴포넌트다.
 */
function SectionSeparator() {
  return <View style={styles.sectionSeparator} />;
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: theme.spacing.xl,
  },
  groupTitle: {
    color: theme.colors.accentGreen,
    fontSize: 14,
    fontWeight: '900',
    paddingBottom: 4,
  },
  itemSeparator: {
    height: 4,
  },
  sectionSeparator: {
    height: 8,
  },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  rowPressed: {
    opacity: 0.82,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    overflow: 'hidden',
  },
  avatarText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  avatarImage: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.sm,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  name: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  meta: {
    maxWidth: '48%',
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
  },
  empty: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 14,
  },
});
