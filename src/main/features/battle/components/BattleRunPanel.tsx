import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BattlePartySelector } from '../../../components/BattlePartySelector';
import { PrimaryButton } from '../../../components/PrimaryButton';
import {
  type BattlePartyMember,
  isBattlePartyReady,
  sanitizeBattlePartyForCharacters,
} from '../../../domain/battleParty';
import {
  formatBattleOutcome,
  formatBattleProgressRow,
  formatBattleSideRow,
  getBattleResultRounds,
} from '../../../domain/battleResults';
import {
  createExecutablePartyFromPreset,
  emptyPartyMembers,
} from '../../../domain/partyPresets';
import { theme } from '../../../styles/theme';
import type {
  BattleResultResponse,
  BattleRoundResultResponse,
  HofCharacter,
  PartyPresetResponse,
} from '../../../types/api';
import {
  BattlePartyPresetPicker,
  type PartySelectionMode,
} from './BattlePartyPresetPicker';

type BattleRunPanelProps = {
  characters: HofCharacter[];
  partyPresets: PartyPresetResponse[];
  arePartyPresetsLoading: boolean;
  partyPresetsError: string | null;
  onRetryPartyPresets: () => void;
  isRunning: boolean;
  result: BattleResultResponse | null;
  errorMessage: string | null;
  onRunBattle: (party: BattlePartyMember[], battleCount: 1 | 3) => void;
};

/**
 * 펼친 맵 안에서 파티·패턴을 편집하고 1회 또는 3회 전투 실행 의도를 상위 화면에 전달한다.
 *
 * 프리셋 또는 직접 선택 방식이 정해진 뒤 편집기를 열며, 캐릭터 동기화 결과가 바뀌면 유효한 편집은
 * 유지하고 더 이상 존재하지 않는 캐릭터만 비운다. 실제 API 호출과 결과 저장은 상위 계층의 책임이다.
 */
export function BattleRunPanel({
  characters,
  partyPresets,
  arePartyPresetsLoading,
  partyPresetsError,
  onRetryPartyPresets,
  isRunning,
  result,
  errorMessage,
  onRunBattle,
}: BattleRunPanelProps) {
  const [selectedMode, setSelectedMode] = useState<PartySelectionMode>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null);
  const [party, setParty] = useState<BattlePartyMember[]>(emptyPartyMembers);
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);
  const ready = isBattlePartyReady(party, characters);
  const sortieCount = party.filter((member) => member.characterId != null).length;
  const partySelectionComplete = selectedMode != null;

  useEffect(() => {
    setParty((current) => sanitizeBattlePartyForCharacters(current, characters));
    setActiveSlotIndex(0);
  }, [characters]);

  const handleSelectDirect = useCallback(() => {
    setSelectedMode('direct');
    setSelectedPresetId(null);
    setParty(emptyPartyMembers());
    setActiveSlotIndex(0);
  }, []);

  const handleSelectPreset = useCallback((preset: PartyPresetResponse) => {
    setSelectedMode('preset');
    setSelectedPresetId(preset.id);
    setParty(createExecutablePartyFromPreset(preset, characters));
    setActiveSlotIndex(0);
  }, [characters]);

  return (
    <View style={styles.runPanel}>
      <BattlePartyPresetPicker
        characters={characters}
        presets={partyPresets}
        loading={arePartyPresetsLoading}
        errorMessage={partyPresetsError}
        selectedMode={selectedMode}
        selectedPresetId={selectedPresetId}
        onRetry={onRetryPartyPresets}
        onSelectDirect={handleSelectDirect}
        onSelectPreset={handleSelectPreset}
      />
      {partySelectionComplete ? (
        <>
          {characters.length === 0 ? (
            <Text style={styles.stateText}>동기화된 캐릭터가 없습니다.</Text>
          ) : (
            <>
              <BattlePartySelector
                activeSlotIndex={activeSlotIndex}
                characters={characters}
                party={party}
                onActiveSlotChange={setActiveSlotIndex}
                onPartyChange={setParty}
              />
              <Text style={styles.sortieCountText}>{sortieCount}명 출정 예정</Text>
              <View style={styles.actionRow}>
                <PrimaryButton
                  label="1회 전투"
                  loading={isRunning}
                  disabled={isRunning || !ready}
                  onPress={() => onRunBattle(party, 1)}
                  style={styles.actionButton}
                />
                <PrimaryButton
                  label="3회 전투"
                  variant="secondary"
                  loading={isRunning}
                  disabled={isRunning || !ready}
                  onPress={() => onRunBattle(party, 3)}
                  style={styles.actionButton}
                />
              </View>
            </>
          )}
          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
          {result ? <BattleResultSummary result={result} /> : null}
        </>
      ) : null}
    </View>
  );
}

/** 백엔드가 파싱한 단일·다중 회차 결과를 원본 실행 순서대로 모두 표시한다. */
function BattleResultSummary({ result }: { result: BattleResultResponse }) {
  const rounds = getBattleResultRounds(result);
  return (
    <View style={styles.resultStack}>
      {rounds.map((round, index) => (
        <BattleRoundSummary
          key={`${round.title}:${round.ally.totalDamage ?? 'damage'}:${index}`}
          round={round}
          roundIndex={rounds.length > 1 ? index : null}
        />
      ))}
    </View>
  );
}

/** 전투 한 회차의 승패, 양측 상태, 보상과 전리품을 구조화된 row로 표시한다. */
function BattleRoundSummary({
  round,
  roundIndex,
}: {
  round: BattleRoundResultResponse;
  roundIndex: number | null;
}) {
  return (
    <View style={styles.resultPanel}>
      <View style={styles.resultHeader}>
        <Text style={styles.resultOutcome}>{formatBattleOutcome(round.outcome)}</Text>
        <Text style={styles.resultTurns}>
          {[
            roundIndex == null ? null : `${roundIndex + 1}회차`,
            round.turns == null ? '-' : `${round.turns}턴`,
          ].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Text style={styles.resultTitle} numberOfLines={2}>{round.title}</Text>
      <View style={styles.resultRows}>
        <Text style={styles.resultText}>{formatBattleSideRow('적군', round.enemy)}</Text>
        <Text style={styles.resultText}>{formatBattleSideRow('아군', round.ally)}</Text>
        <Text style={styles.resultText}>{formatBattleProgressRow(round)}</Text>
      </View>
      {round.loots.length > 0 ? (
        <View style={styles.lootSection}>
          <Text style={styles.lootTitle}>전리품</Text>
          {round.loots.map((loot, index) => (
            <Text key={`${loot.name}:${index}`} style={styles.lootText}>{loot.name}</Text>
          ))}
        </View>
      ) : null}
      {round.quest ? <Text style={styles.questText} numberOfLines={2}>{round.quest}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  runPanel: { gap: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceAlt, padding: theme.spacing.md },
  stateText: { color: theme.colors.textMuted, fontSize: 14, fontWeight: '800' },
  errorText: { color: theme.colors.danger, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  actionRow: { flexDirection: 'row', gap: theme.spacing.sm },
  sortieCountText: { minWidth: 0, color: theme.colors.accentGreen, fontSize: 12, fontWeight: '900', textAlign: 'right' },
  actionButton: { minWidth: 0, flex: 1 },
  resultStack: { gap: theme.spacing.sm },
  resultPanel: { gap: theme.spacing.xs, borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surface, padding: theme.spacing.md },
  resultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md },
  resultOutcome: { color: theme.colors.accentAmber, fontSize: 16, fontWeight: '900' },
  resultTurns: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '800' },
  resultTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '900', lineHeight: 18 },
  resultRows: { gap: 4 },
  resultText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  lootSection: { gap: 3 },
  lootTitle: { color: theme.colors.accentAmber, fontSize: 12, fontWeight: '900' },
  lootText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '800', lineHeight: 17 },
  questText: { color: theme.colors.accentBlue, fontSize: 12, fontWeight: '800', lineHeight: 17 },
});
