import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { displayCharacterJob, displayCharacterName, formatCharacterLevel } from '../domain/characters';
import { buildCharacterDetailMetrics } from '../domain/characterDetails';
import { normalizeHofAssetUrl } from '../domain/hofAssets';
import { theme } from '../styles/theme';
import type {
  CharacterManagementActionRequest,
  CharacterManagementSnapshot,
  CharacterObservedAction,
  HofCharacter,
  HofCharacterDetail,
  HofCharacterEquipment,
  HofCharacterPatternSlot,
  HofCharacterSkill,
  LoadPatternResponse,
} from '../types/api';

type CharacterManagementView = 'hub' | 'stats' | 'patterns' | 'equipment' | 'skills' | 'items' | 'info';

type CharacterDetailProps = {
  character: HofCharacter;
  detail: HofCharacterDetail | null;
  isLoading: boolean;
  errorMessage: string | null;
  actions?: CharacterObservedAction[];
  onLoadPattern?: (hofCharacterId: string, slot: number) => Promise<LoadPatternResponse>;
  onExecuteAction?: (request: CharacterManagementActionRequest) => Promise<CharacterManagementSnapshot>;
  onBack?: () => void;
};

/** 캐릭터의 요약과 각 관리 기능으로 들어가는 모바일 허브다. */
export function CharacterDetail({
  character,
  detail,
  isLoading,
  errorMessage,
  actions = [],
  onLoadPattern,
  onExecuteAction,
  onBack,
}: CharacterDetailProps) {
  const [view, setView] = useState<CharacterManagementView>('hub');
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const name = displayCharacterName(character);

  if (isLoading) return <LoadingPanel />;
  if (errorMessage) return <Text style={styles.errorText}>{errorMessage}</Text>;
  if (!detail) return null;

  const runAction = async (request: CharacterManagementActionRequest) => {
    if (!onExecuteAction) return;
    setResultMessage(null);
    setActionError(null);
    try {
      const snapshot = await onExecuteAction(request);
      setResultMessage(snapshot.messages.filter(Boolean).join('\n') || '작업을 완료했습니다.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '작업을 완료하지 못했습니다.');
      throw error;
    }
  };

  return (
    <View style={styles.container}>
      {onBack ? (
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.detailBackButton}>
          <Text style={styles.detailBackIcon}>‹</Text>
          <Text style={styles.detailBackText}>캐릭터 목록</Text>
        </Pressable>
      ) : null}
      <View style={styles.header}>
        <Avatar name={name} imageUrl={detail.imageUrl} />
        <View style={styles.headerText}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.subtitle}>{formatCharacterLevel(character)} · {displayCharacterJob(character)}</Text>
        </View>
      </View>

      {view !== 'hub' ? (
        <Pressable accessibilityRole="button" onPress={() => setView('hub')} style={styles.backButton}>
          <Text style={styles.backButtonText}>‹ 캐릭터 관리</Text>
        </Pressable>
      ) : null}

      {resultMessage ? <ResultNotice tone="success" message={resultMessage} /> : null}
      {actionError ? <ResultNotice tone="error" message={actionError} /> : null}

      {view === 'hub' ? <ManagementHub detail={detail} onOpen={setView} /> : null}
      {view === 'patterns' ? (
        <PatternManagement
          detail={detail}
          actions={actions.filter(isPatternAction)}
          characterId={character.hofCharacterId}
          onExecute={runAction}
          onLoadPattern={onLoadPattern}
        />
      ) : null}
      {view === 'stats' ? (
        <StatManagement detail={detail} actions={actions.filter(isStatAction)} onExecute={runAction} />
      ) : null}
      {view === 'equipment' ? (
        <EquipmentManagement detail={detail} actions={actions.filter(isEquipmentAction)} onExecute={runAction} />
      ) : null}
      {view === 'skills' ? (
        <SkillManagement detail={detail} actions={actions.filter(isSkillAction)} onExecute={runAction} />
      ) : null}
      {view === 'items' ? (
        <ObservedActions title="아이템 사용" actions={actions.filter(isItemAction)} onExecute={runAction} />
      ) : null}
      {view === 'info' ? (
        <FullInformation detail={detail} actions={actions.filter(isIdentityAction)} onExecute={runAction} />
      ) : null}
    </View>
  );
}

function LoadingPanel() {
  return (
    <View style={styles.loadingPanel}>
      <ActivityIndicator color={theme.colors.accentGreen} />
      <Text style={styles.mutedText}>최신 캐릭터 정보를 확인하는 중</Text>
    </View>
  );
}

function ManagementHub({ detail, onOpen }: { detail: HofCharacterDetail; onOpen: (view: CharacterManagementView) => void }) {
  const metrics = buildCharacterDetailMetrics(detail);
  const cards: Array<{ id: CharacterManagementView; title: string; description: string }> = [
    { id: 'stats', title: '스탯 배분', description: detail.statusLines.some((line) => /point\s*:/i.test(line)) ? '배분 가능한 포인트 확인' : '남은 포인트 없음' },
    { id: 'patterns', title: '패턴 관리', description: `행동 패턴 ${detail.actionPatterns.length}개 · 저장 슬롯 ${detail.patternSlots.length}개` },
    { id: 'equipment', title: '장비 관리', description: `현재 장착 ${detail.equipment.filter((item) => item.checked).length}개` },
    { id: 'skills', title: '스킬 관리', description: `보유 ${detail.learnedSkills.length}개 · 습득 가능 ${detail.learnableSkills.length}개` },
    { id: 'items', title: '아이템 사용', description: '사용 가능한 캐릭터 아이템 확인' },
    { id: 'info', title: '전체 정보 및 기본 관리', description: '추가 효과·이름·순서·삭제 관리' },
  ];
  return (
    <>
      <Section title="핵심 능력치">
        <View style={styles.metricGrid}>
          {metrics.map((metric) => (
            <View key={metric.label} style={styles.metricCard}>
              <Text style={styles.metricLabel}>{metric.label}</Text>
              <Text style={styles.metricValue}>{metric.value}</Text>
            </View>
          ))}
        </View>
      </Section>
      <Section title="관리">
        <View style={styles.list}>
          {cards.map((card) => (
            <Pressable key={card.id} accessibilityRole="button" onPress={() => onOpen(card.id)} style={styles.navigationCard}>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>{card.title}</Text>
                <Text style={styles.mutedText}>{card.description}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>
      </Section>
    </>
  );
}

function StatManagement({ detail, actions, onExecute }: {
  detail: HofCharacterDetail;
  actions: CharacterObservedAction[];
  onExecute: (request: CharacterManagementActionRequest) => Promise<void>;
}) {
  const availablePoints = extractAvailableStatPoints(detail.statusLines);
  return (
    <>
      <ScreenHeading title="스탯 배분" description="올릴 수치를 바로 선택한 뒤 한 번에 적용합니다." />
      {actions.length ? (
        <View style={styles.statActionList}>
          {actions.map((action) => (
            <StatAllocationAction
              key={action.actionId}
              action={action}
              availablePoints={availablePoints}
              onExecute={onExecute}
            />
          ))}
        </View>
      ) : <EmptyText text="현재 배분할 수 있는 스탯 포인트가 없습니다." />}
    </>
  );
}

function StatAllocationAction({ action, availablePoints, onExecute }: {
  action: CharacterObservedAction;
  availablePoints: number | null;
  onExecute: (request: CharacterManagementActionRequest) => Promise<void>;
}) {
  const candidateGroups = useMemo(() => groupCharacterCandidates(action.candidates), [action.candidates]);
  const [selectedCandidates, setSelectedCandidates] = useState<Record<string, string>>(() => Object.fromEntries(
    candidateGroups.flatMap(([groupId, candidates]) => {
      const selected = candidates.find((candidate) => candidate.selected) ?? candidates[0];
      return selected ? [[groupId, selected.id]] : [];
    }),
  ));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    action.fields.map((field) => [field.id, field.value]),
  ));
  const [submitting, setSubmitting] = useState(false);
  const allocatedPoints = candidateGroups.reduce((sum, [groupId, candidates]) => {
    const selected = candidates.find((candidate) => candidate.id === selectedCandidates[groupId]);
    return sum + parseStatCandidateValue(selected?.label);
  }, 0);

  const selectStatValue = (
    groupId: string,
    candidates: CharacterObservedAction['candidates'],
    requestedValue: number,
  ) => {
    const currentCandidate = candidates.find((candidate) => candidate.id === selectedCandidates[groupId]);
    const currentValue = parseStatCandidateValue(currentCandidate?.label);
    const otherAllocatedPoints = allocatedPoints - currentValue;
    const candidateMaximum = Math.max(0, ...candidates.map((candidate) => parseStatCandidateValue(candidate.label)));
    const availableMaximum = availablePoints == null
      ? candidateMaximum
      : Math.max(0, availablePoints - otherAllocatedPoints);
    const nextValue = Math.min(Math.max(0, requestedValue), candidateMaximum, availableMaximum);
    const nextCandidate = candidates.find((candidate) => parseStatCandidateValue(candidate.label) === nextValue);
    if (!nextCandidate) return;
    setSelectedCandidates((current) => ({ ...current, [groupId]: nextCandidate.id }));
  };

  const execute = async () => {
    setSubmitting(true);
    try {
      await onExecute({
        action: {
          actionId: action.actionId,
          selections: Object.values(selectedCandidates).map((candidateId) => ({ candidateId })),
          values: action.fields.map((field) => ({ fieldId: field.id, value: values[field.id] ?? '' })),
        },
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.statCard}>
      <View style={styles.statSummary}>
        <Text style={styles.cardTitle}>배분할 포인트</Text>
        <View style={styles.pointBadge}>
          <Text style={styles.pointBadgeText}>
            {availablePoints == null
              ? `배분 ${allocatedPoints}`
              : `남음 ${Math.max(0, availablePoints - allocatedPoints)} · 배분 ${allocatedPoints}`}
          </Text>
        </View>
      </View>

      <View style={styles.statRows}>
        {candidateGroups.map(([groupId, candidates]) => {
          const selected = candidates.find((candidate) => candidate.id === selectedCandidates[groupId]);
          const selectedValue = parseStatCandidateValue(selected?.label);
          const otherAllocatedPoints = allocatedPoints - selectedValue;
          const candidateMaximum = Math.max(0, ...candidates.map((candidate) => parseStatCandidateValue(candidate.label)));
          const availableMaximum = availablePoints == null
            ? candidateMaximum
            : Math.min(candidateMaximum, Math.max(0, availablePoints - otherAllocatedPoints));
          const label = statGroupLabel(groupId);
          return (
            <View key={groupId} style={styles.statRow}>
              <Text style={styles.statName}>{label}</Text>
              <View style={styles.statStepper}>
                <Pressable
                  accessibilityLabel={`${label} 1 감소`}
                  accessibilityRole="button"
                  disabled={selectedValue <= 0}
                  onPress={() => selectStatValue(groupId, candidates, selectedValue - 1)}
                  style={({ pressed }) => [styles.stepperButton, selectedValue <= 0 && styles.controlDisabled, pressed && styles.controlPressed]}
                >
                  <Text style={styles.stepperButtonText}>−</Text>
                </Pressable>
                <TextInput
                  accessibilityLabel={`${label} 배분량`}
                  accessibilityRole="spinbutton"
                  accessibilityValue={{ min: 0, max: availableMaximum, now: selectedValue }}
                  keyboardType="number-pad"
                  maxLength={String(candidateMaximum).length}
                  onChangeText={(value) => selectStatValue(groupId, candidates, Number.parseInt(value || '0', 10) || 0)}
                  selectTextOnFocus
                  style={styles.statValueInput}
                  value={String(selectedValue)}
                />
                <Pressable
                  accessibilityLabel={`${label} 1 증가`}
                  accessibilityRole="button"
                  disabled={selectedValue >= availableMaximum}
                  onPress={() => selectStatValue(groupId, candidates, selectedValue + 1)}
                  style={({ pressed }) => [styles.stepperButton, selectedValue >= availableMaximum && styles.controlDisabled, pressed && styles.controlPressed]}
                >
                  <Text style={styles.stepperButtonText}>+</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`${label} 최대 배분`}
                  accessibilityRole="button"
                  disabled={selectedValue >= availableMaximum}
                  onPress={() => selectStatValue(groupId, candidates, availableMaximum)}
                  style={({ pressed }) => [styles.maxButton, selectedValue >= availableMaximum && styles.controlDisabled, pressed && styles.controlPressed]}
                >
                  <Text style={styles.maxButtonText}>MAX</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>

      {action.fields.map((field) => (
        <View key={field.id} style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{field.label}</Text>
          <TextInput
            keyboardType={field.inputType === 'NUMBER' ? 'number-pad' : 'default'}
            maxLength={field.maxLength ?? undefined}
            onChangeText={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
            style={styles.input}
            value={values[field.id] ?? ''}
          />
        </View>
      ))}

      <Pressable
        accessibilityRole="button"
        disabled={submitting || allocatedPoints === 0}
        onPress={() => void execute()}
        style={[styles.actionButton, (submitting || allocatedPoints === 0) && styles.disabledCard]}
      >
        <Text style={styles.actionButtonText}>{submitting ? '적용 중' : '스탯 적용'}</Text>
      </Pressable>
    </View>
  );
}

function PatternManagement({
  detail,
  actions,
  characterId,
  onExecute,
  onLoadPattern,
}: {
  detail: HofCharacterDetail;
  actions: CharacterObservedAction[];
  characterId: string;
  onExecute: (request: CharacterManagementActionRequest) => Promise<void>;
  onLoadPattern?: CharacterDetailProps['onLoadPattern'];
}) {
  const [loadingSlot, setLoadingSlot] = useState<string | null>(null);
  const loadSlot = async (slot: HofCharacterPatternSlot) => {
    if (!onLoadPattern) return;
    const slotNumber = Number.parseInt(slot.slot, 10);
    if (Number.isNaN(slotNumber)) return;
    setLoadingSlot(slot.slot);
    try { await onLoadPattern(characterId, slotNumber); } finally { setLoadingSlot(null); }
  };
  return (
    <>
      <ScreenHeading title="패턴 관리" description="행동 규칙과 위치·호위를 편집하고 별도 슬롯에 저장합니다." />
      <Section title="행동 패턴">
        <View style={styles.list}>
          {detail.actionPatterns.map((row) => (
            <View key={row.index} style={styles.card}>
              <Text style={styles.cardTitle}>{row.index + 1}. {row.judgeText || row.judge || '조건 없음'}</Text>
              <Text style={styles.mutedText}>기준 {row.quantityText || row.quantity || '0'}</Text>
              <Text style={styles.accentText}>{row.skillText || row.skill || '행동 없음'}</Text>
            </View>
          ))}
          {detail.actionPatterns.length === 0 ? <EmptyText text="표시할 행동 패턴이 없습니다." /> : null}
        </View>
        <Text style={styles.caption}>위치 {detail.positionGuard.selectedPosition || '-'} · 호위 {detail.positionGuard.guardText || '-'}</Text>
      </Section>
      <Section title="저장 슬롯">
        <View style={styles.list}>
          {detail.patternSlots.map((slot) => (
            <Pressable
              key={slot.slot}
              disabled={!slot.canLoad || loadingSlot != null || !onLoadPattern}
              onPress={() => loadSlot(slot)}
              style={[styles.navigationCard, !slot.canLoad && styles.disabledCard]}
            >
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>{slot.label || `패턴 ${Number(slot.slot) + 1}`}</Text>
                <Text style={styles.mutedText}>{slot.canLoad ? '행동 패턴과 위치·호위 불러오기' : '빈 슬롯'}</Text>
              </View>
              <Text style={styles.accentText}>{loadingSlot === slot.slot ? '로드 중' : slot.canLoad ? '로드' : '비어 있음'}</Text>
            </Pressable>
          ))}
        </View>
      </Section>
      <ObservedActions
        title="패턴 작업"
        actions={actions.filter((action) => !normalizedSource(action).includes('loadpattern'))}
        onExecute={onExecute}
      />
    </>
  );
}

function EquipmentManagement({ detail, actions, onExecute }: {
  detail: HofCharacterDetail;
  actions: CharacterObservedAction[];
  onExecute: (request: CharacterManagementActionRequest) => Promise<void>;
}) {
  const current = detail.equipment.filter((item) => item.checked);
  return (
    <>
      <ScreenHeading title="장비 관리" description="현재 장비와 장착 가능한 보유 장비를 관리합니다." />
      <Section title="현재 장비"><EquipmentList equipment={current} /></Section>
      <ObservedActions title="장착 가능한 장비·해제·세트 슬롯" actions={actions} onExecute={onExecute} />
    </>
  );
}

function EquipmentList({ equipment }: { equipment: HofCharacterEquipment[] }) {
  if (equipment.length === 0) return <EmptyText text="표시할 장비가 없습니다." />;
  return <View style={styles.list}>{equipment.map((item) => (
    <View key={`${item.slot}-${item.name}`} style={styles.card}>
      <Text style={styles.overline}>{item.part || item.slot || '장비'}</Text>
      <Text style={styles.cardTitle}>{item.name}</Text>
      {item.description ? <Text style={styles.mutedText}>{item.description}</Text> : null}
    </View>
  ))}</View>;
}

function SkillManagement({ detail, actions, onExecute }: {
  detail: HofCharacterDetail;
  actions: CharacterObservedAction[];
  onExecute: (request: CharacterManagementActionRequest) => Promise<void>;
}) {
  return (
    <>
      <ScreenHeading title="스킬 관리" description="보유 스킬을 확인하고 현재 배울 수 있는 스킬을 습득합니다." />
      <Section title="배울 수 있는 스킬"><SkillList skills={detail.learnableSkills} /></Section>
      <Section title="보유 스킬"><SkillList skills={detail.learnedSkills} /></Section>
      <ObservedActions title="스킬 작업" actions={actions} onExecute={onExecute} />
    </>
  );
}

function SkillList({ skills }: { skills: HofCharacterSkill[] }) {
  if (skills.length === 0) return <EmptyText text="표시할 스킬이 없습니다." />;
  return <View style={styles.list}>{skills.map((skill, index) => (
    <View key={`${skill.value}-${skill.name}-${index}`} style={styles.card}>
      {skill.category ? <Text style={styles.overline}>{skill.category}</Text> : null}
      <Text style={styles.cardTitle}>{skill.name}</Text>
    </View>
  ))}</View>;
}

function FullInformation({ detail, actions, onExecute }: {
  detail: HofCharacterDetail;
  actions: CharacterObservedAction[];
  onExecute: (request: CharacterManagementActionRequest) => Promise<void>;
}) {
  return (
    <>
      <ScreenHeading title="전체 정보 및 기본 관리" description="HOF에 표시된 캐릭터 상태와 기본 작업을 확인합니다." />
      <Section title="상태 및 추가 효과">
        {detail.statusLines.length ? detail.statusLines.map((line, index) => (
          <Text key={`${line}-${index}`} style={styles.statusLine}>{line}</Text>
        )) : <EmptyText text="추가 상태 정보가 없습니다." />}
      </Section>
      <ObservedActions title="기본 작업" actions={actions.filter((action) => !isDangerousAction(action))} onExecute={onExecute} />
      <ObservedActions title="위험 작업" actions={actions.filter(isDangerousAction)} onExecute={onExecute} dangerous />
    </>
  );
}

function ObservedActions({ title, actions, onExecute, dangerous = false }: {
  title: string;
  actions: CharacterObservedAction[];
  onExecute: (request: CharacterManagementActionRequest) => Promise<void>;
  dangerous?: boolean;
}) {
  if (actions.length === 0) return <Section title={title}><EmptyText text="현재 실행 가능한 작업이 없습니다." /></Section>;
  return <Section title={title}><View style={styles.list}>{actions.map((action) => (
    <ObservedActionCard key={action.actionId} action={action} onExecute={onExecute} dangerous={dangerous || isDangerousAction(action)} />
  ))}</View></Section>;
}

function ObservedActionCard({ action, onExecute, dangerous }: {
  action: CharacterObservedAction;
  onExecute: (request: CharacterManagementActionRequest) => Promise<void>;
  dangerous: boolean;
}) {
  const [selectedCandidates, setSelectedCandidates] = useState<Record<string, string>>(() => Object.fromEntries(
    action.candidates.filter((candidate) => candidate.selected).map((candidate) => [candidate.groupId, candidate.id]),
  ));
  const [expanded, setExpanded] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(action.fields.map((field) => [field.id, field.value])));
  const [submitting, setSubmitting] = useState(false);
  const candidateGroups = useMemo(() => groupCharacterCandidates(action.candidates), [action.candidates]);
  const request = useMemo<CharacterManagementActionRequest>(() => ({
    action: {
      actionId: action.actionId,
      selections: Object.values(selectedCandidates).map((candidateId) => ({ candidateId })),
      values: action.fields.map((field) => ({ fieldId: field.id, value: values[field.id] ?? '' })),
    },
  }), [action, selectedCandidates, values]);
  const execute = async () => {
    setSubmitting(true);
    try { await onExecute(request); } finally { setSubmitting(false); }
  };
  const confirm = () => {
    if (!dangerous) { void execute(); return; }
    Alert.alert('위험 작업 확인', dangerousDescription(action), [
      { text: '취소', style: 'cancel' },
      { text: actionLabel(action), style: 'destructive', onPress: () => void execute() },
    ]);
  };
  return (
    <View style={[styles.actionCard, dangerous && styles.dangerCard]}>
      <Pressable accessibilityRole="button" onPress={() => setExpanded((current) => !current)} style={styles.actionHeader}>
        <Text style={styles.cardTitle}>{actionLabel(action)}</Text>
        <Text style={styles.chevron}>{expanded ? '⌃' : '⌄'}</Text>
      </Pressable>
      {expanded ? <>
      {candidateGroups.length ? <View style={styles.choiceList}>{candidateGroups.map(([groupId, candidates = []]) => {
        const selected = candidates.find((candidate) => candidate.id === selectedCandidates[groupId]);
        const groupOpen = expandedGroup === groupId;
        return <View key={groupId} style={styles.choiceGroup}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: groupOpen }}
            onPress={() => setExpandedGroup((current) => current === groupId ? null : groupId)}
            style={styles.choiceGroupHeader}
          >
            <View style={styles.flex}>
              <Text style={styles.fieldLabel}>{candidateGroupLabel(groupId)}</Text>
              <Text style={styles.choiceText}>{selected?.label || '선택하세요'}</Text>
            </View>
            <Text style={styles.chevron}>{groupOpen ? '⌃' : '⌄'}</Text>
          </Pressable>
          {groupOpen ? candidates.map((candidate) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selectedCandidates[groupId] === candidate.id }}
              key={candidate.id}
              onPress={() => {
                setSelectedCandidates((current) => ({ ...current, [groupId]: candidate.id }));
                setExpandedGroup(null);
              }}
              style={[styles.choice, selectedCandidates[groupId] === candidate.id && styles.choiceSelected]}
            >
              <Text style={styles.choiceText}>{candidate.label}</Text>
            </Pressable>
          )) : null}
        </View>;
      })}</View> : null}
      {action.fields.map((field) => (
        <View key={field.id} style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{field.label}</Text>
          <TextInput
            keyboardType={field.inputType === 'NUMBER' ? 'number-pad' : 'default'}
            maxLength={field.maxLength ?? undefined}
            onChangeText={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
            style={styles.input}
            value={values[field.id] ?? ''}
          />
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={submitting}
        onPress={confirm}
        style={[styles.actionButton, dangerous && styles.dangerButton, submitting && styles.disabledCard]}
      >
        <Text style={styles.actionButtonText}>{submitting ? '처리 중' : actionLabel(action)}</Text>
      </Pressable>
      </> : null}
    </View>
  );
}

function ScreenHeading({ title, description }: { title: string; description: string }) {
  return <View><Text style={styles.screenTitle}>{title}</Text><Text style={styles.mutedText}>{description}</Text></View>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

function EmptyText({ text }: { text: string }) { return <Text style={styles.mutedText}>{text}</Text>; }

function ResultNotice({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  return <View accessibilityLiveRegion="assertive" style={[styles.notice, tone === 'error' && styles.errorNotice]}>
    <Text style={styles.noticeTitle}>{tone === 'success' ? '완료' : '확인 필요'}</Text>
    <Text style={styles.noticeText}>{message}</Text>
  </View>;
}

function Avatar({ name, imageUrl }: { name: string; imageUrl: string | null }) {
  const url = normalizeHofAssetUrl(imageUrl);
  return <View style={styles.avatar}>{url ? <Image source={{ uri: url }} style={styles.avatarImage} resizeMode="contain" /> : <Text style={styles.avatarText}>{name.slice(0, 1)}</Text>}</View>;
}

const normalizedLabel = (action: CharacterObservedAction) => action.label.toLowerCase();
const normalizedSource = (action: CharacterObservedAction) => action.source.toLowerCase();
const hasAny = (action: CharacterObservedAction, words: string[]) => words.some((word) => normalizedLabel(action).includes(word));
const isPatternAction = (action: CharacterObservedAction) => {
  const label = normalizedLabel(action).trim();
  return /pattern|guard|position/.test(normalizedSource(action)) ||
    hasAny(action, ['pattern', '패턴', 'simulate', 'switch pattern']) ||
    label === 'add' || label === 'delete' || label.startsWith('set ');
};
const isEquipmentAction = (action: CharacterObservedAction) => /equip|remove/.test(normalizedSource(action)) || hasAny(action, ['equip', 'remove', '장착', '해제']);
const isSkillAction = (action: CharacterObservedAction) => /learnskill|pray/.test(normalizedSource(action)) || hasAny(action, ['learn skill', '스킬 배우기', '기도']);
const isStatAction = (action: CharacterObservedAction) => /status/.test(normalizedSource(action)) || hasAny(action, ['increase status', '스탯']);
const isItemAction = (action: CharacterObservedAction) => /showreset|use_char_item/.test(normalizedSource(action));
const isDangerousAction = (action: CharacterObservedAction) => /byebye|kick|knockback/.test(normalizedSource(action)) || hasAny(action, ['kick', 'knockback', '해고', '맨 뒤', '리스트 맨 뒤']);
const isIdentityAction = (action: CharacterObservedAction) => /rename|pray|byebye|kick|knockback/.test(normalizedSource(action)) || hasAny(action, ['change', 'name', '이름', '기도', 'pray', 'kick', 'knockback', '해고', '맨 뒤']);

function candidateGroupLabel(groupId: string): string {
  const judge = /^judge(\d+)$/i.exec(groupId);
  if (judge) return `${Number(judge[1]) + 1}번 행동 조건`;
  const skill = /^skill(\d+)$/i.exec(groupId);
  if (skill) return `${Number(skill[1]) + 1}번 실행 스킬`;
  if (/patternnumber/i.test(groupId)) return '편집할 패턴';
  if (/position/i.test(groupId)) return '위치';
  if (/guard/i.test(groupId)) return '호위';
  if (/newskill/i.test(groupId)) return '배울 스킬';
  if (/item_no|spot/i.test(groupId)) return '대상 아이템';
  return groupId;
}

function groupCharacterCandidates(candidates: CharacterObservedAction['candidates']) {
  const grouped = new Map<string, CharacterObservedAction['candidates']>();
  candidates.forEach((candidate) => {
    const current = grouped.get(candidate.groupId) ?? [];
    grouped.set(candidate.groupId, [...current, candidate]);
  });
  return [...grouped.entries()];
}

export function extractAvailableStatPoints(statusLines: string[]): number | null {
  for (const line of statusLines) {
    const match = /point\s*[:?]?\s*(\d+)/i.exec(line);
    if (match) return Number(match[1]);
  }
  return null;
}

export function statGroupLabel(groupId: string): string {
  const withoutPrefix = groupId.replace(/^up/i, '');
  return withoutPrefix ? withoutPrefix.toUpperCase() : groupId.toUpperCase();
}

function parseStatCandidateValue(label: string | undefined): number {
  const value = Number.parseInt(label?.match(/[+-]?\d+/)?.[0] ?? '0', 10);
  return Number.isNaN(value) ? 0 : Math.max(0, value);
}

function actionLabel(action: CharacterObservedAction): string {
  const source = normalizedSource(action);
  const target = action.label.includes(' · ') ? ` · ${action.label.split(' · ').slice(1).join(' · ')}` : '';
  if (/knockback\d+/.test(source)) return '맨 뒤로 이동 확인';
  if (source.includes('knockback')) return '맨 뒤로 이동';
  if (/byebye\d+/.test(source)) return '캐릭터 삭제 확인';
  if (source.includes('byebye')) return '캐릭터 삭제';
  if (source.includes('rename')) return action.label.toLowerCase() === 'change' ? '이름 변경 확인' : '이름 변경';
  if (source.includes('showreset')) return '사용 아이템 목록 열기';
  if (source.includes('use_char_item')) return '선택 아이템 사용';
  if (source.includes('loadpattern')) return `저장 패턴 불러오기${target}`;
  if (source.includes('savepattern')) return `현재 패턴 저장${target}`;
  if (source.includes('delpattern')) return `저장 패턴 삭제${target}`;
  if (source.includes('changepattern')) return '행동 패턴 적용';
  if (source.includes('testbattle')) return '패턴 적용 후 시험 전투';
  if (source.includes('patternmemo')) return '편집 패턴 전환';
  if (source.includes('addnewpattern')) return '행동 패턴 추가';
  if (source.includes('deletepattern')) return '행동 패턴 삭제';
  if (source.includes('equip_l_')) return `장비 세트 불러오기${target}`;
  if (source.includes('equip_s_')) return `장비 세트 저장${target}`;
  if (source.includes('equip_item')) return '선택 장비 장착';
  if (source.includes('remove_all')) return '장비 전체 해제';
  if (source.includes('remove')) return '선택 장비 해제';
  if (source === 'unnamed-submit' && normalizedLabel(action).trim() === 'set') return '위치·호위 저장';
  if (hasAny(action, ['knockback', '리스트 맨 뒤'])) return '맨 뒤로 이동';
  if (hasAny(action, ['kick', '해고'])) return '캐릭터 삭제';
  if (hasAny(action, ['changename', 'change', '이름'])) return '이름 변경';
  if (hasAny(action, ['기도', 'pray'])) return '기도하기';
  if (hasAny(action, ['learn'])) return '스킬 배우기';
  return action.label || '실행';
}

function dangerousDescription(action: CharacterObservedAction): string {
  if (normalizedSource(action).includes('knockback') || hasAny(action, ['knockback', '리스트 맨 뒤'])) return '캐릭터 ID가 변경되며 저장 파티와 콜로세움 팀에서 제거될 수 있습니다.';
  return '캐릭터가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.';
}

const styles = StyleSheet.create({
  container: { gap: theme.spacing.lg, paddingBottom: theme.spacing.xl },
  detailBackButton: { minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, paddingRight: theme.spacing.md },
  detailBackIcon: { color: theme.colors.accentGreen, fontSize: 30, lineHeight: 32 },
  detailBackText: { color: theme.colors.accentGreen, fontSize: 15, fontWeight: '800' },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  headerText: { flex: 1, gap: theme.spacing.xs },
  name: { color: theme.colors.text, fontSize: 24, fontWeight: '800' },
  subtitle: { color: theme.colors.textMuted, fontSize: 15 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.borderStrong, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: 58, height: 58 }, avatarText: { color: theme.colors.accentGreen, fontSize: 24, fontWeight: '800' },
  loadingPanel: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md },
  errorText: { color: theme.colors.danger, fontSize: 15 }, mutedText: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 21 },
  backButton: { alignSelf: 'flex-start', paddingVertical: theme.spacing.sm }, backButtonText: { color: theme.colors.accentGreen, fontSize: 16, fontWeight: '700' },
  section: { gap: theme.spacing.md }, sectionTitle: { color: theme.colors.text, fontSize: 19, fontWeight: '800' }, screenTitle: { color: theme.colors.text, fontSize: 24, fontWeight: '800', marginBottom: theme.spacing.xs },
  list: { gap: theme.spacing.md }, flex: { flex: 1, gap: theme.spacing.xs },
  navigationCard: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
  card: { gap: theme.spacing.sm, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
  cardTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '800', lineHeight: 22 }, overline: { color: theme.colors.accentAmber, fontSize: 12, fontWeight: '800' }, accentText: { color: theme.colors.accentGreen, fontSize: 14, fontWeight: '700' }, chevron: { color: theme.colors.textMuted, fontSize: 28 }, caption: { color: theme.colors.textMuted, fontSize: 13, marginTop: theme.spacing.sm },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }, metricCard: { width: '31%', minWidth: 90, padding: theme.spacing.md, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface }, metricLabel: { color: theme.colors.textMuted, fontSize: 12 }, metricValue: { color: theme.colors.text, fontSize: 16, fontWeight: '800', marginTop: theme.spacing.xs },
  notice: { borderLeftWidth: 4, borderLeftColor: theme.colors.accentGreen, padding: theme.spacing.lg, gap: theme.spacing.sm, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md }, errorNotice: { borderLeftColor: theme.colors.danger }, noticeTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '800' }, noticeText: { color: theme.colors.textMuted, fontSize: 15, lineHeight: 22 },
  statusLine: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 21, paddingVertical: theme.spacing.xs },
  statActionList: { gap: theme.spacing.md },
  statCard: { gap: theme.spacing.lg, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
  statSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md },
  pointBadge: { paddingHorizontal: theme.spacing.sm, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.colors.surfaceAlt },
  pointBadgeText: { color: theme.colors.accentGreen, fontSize: 12, fontWeight: '800' },
  statRows: { gap: theme.spacing.md },
  statRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  statName: { width: 42, color: theme.colors.text, fontSize: 15, fontWeight: '900', letterSpacing: 0.8 },
  statStepper: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  stepperButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt },
  stepperButtonText: { color: theme.colors.text, fontSize: 20, fontWeight: '800' },
  statValueInput: { minWidth: 58, height: 42, flex: 1, paddingHorizontal: theme.spacing.sm, color: theme.colors.text, fontSize: 16, fontWeight: '900', textAlign: 'center', backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.accentGreen, borderRadius: theme.radius.md },
  maxButton: { minWidth: 50, height: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt },
  maxButtonText: { color: theme.colors.accentGreen, fontSize: 11, fontWeight: '900' },
  controlDisabled: { opacity: 0.35 },
  controlPressed: { opacity: 0.72 },
  actionCard: { gap: theme.spacing.md, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md }, dangerCard: { borderColor: theme.colors.danger },
  actionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md },
  choiceList: { gap: theme.spacing.sm }, choice: { padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt }, choiceSelected: { borderColor: theme.colors.accentGreen }, choiceText: { color: theme.colors.text, fontSize: 14 },
  choiceGroup: { gap: theme.spacing.sm }, choiceGroupHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt },
  fieldGroup: { gap: theme.spacing.sm }, fieldLabel: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '700' }, input: { minHeight: 48, paddingHorizontal: theme.spacing.md, color: theme.colors.text, backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md },
  actionButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.md, backgroundColor: theme.colors.accentGreen }, dangerButton: { backgroundColor: theme.colors.danger }, actionButtonText: { color: theme.colors.buttonText, fontSize: 16, fontWeight: '800' }, disabledCard: { opacity: 0.45 },
});
