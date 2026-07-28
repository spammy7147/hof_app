import { useCallback, useMemo } from 'react';

import { PartyPresetPickerModal } from '../../../components/PartyPresetPickerModal';
import type { PartyPresetCatalogResponse, PartyPresetResponse } from '../../../types/api';

type Props = {
  disabled: boolean;
  mapName: string;
  onClose: () => void;
  onSelect: (presetId: number | null) => void;
  catalog: PartyPresetCatalogResponse;
  selectedPresetId: number | null;
  selectedPresetMode: 'PRIMARY' | 'EXPLICIT';
  visible: boolean;
};

/** 자동화의 nullable 대표/명시 프리셋 계약을 공통 선택 모달로 번역한다. */
export function BattleMapPresetPickerModal({
  disabled,
  mapName,
  onClose,
  onSelect,
  catalog,
  selectedPresetId,
  selectedPresetMode,
  visible,
}: Props) {
  const primaryPreset = useMemo(() => catalog.presets.find(({ isPrimary }) => isPrimary) ?? null, [catalog.presets]);
  const selectPrimary = useCallback(() => onSelect(null), [onSelect]);
  const selectPreset = useCallback((preset: PartyPresetResponse) => onSelect(preset.id), [onSelect]);
  const syntheticOptions = useMemo(() => [{
    key: 'primary',
    accessibilityLabel: '대표 프리셋 선택',
    label: primaryPreset == null ? '대표 프리셋 없음' : `대표 · ${primaryPreset.name}`,
    selected: selectedPresetMode === 'PRIMARY',
    onSelect: selectPrimary,
  }], [primaryPreset, selectPrimary, selectedPresetMode]);

  return (
    <PartyPresetPickerModal
      catalog={catalog}
      disabled={disabled}
      initialExpandedFolderIds={[null]}
      onClose={onClose}
      onSelectPreset={selectPreset}
      selectedPresetId={selectedPresetMode === 'EXPLICIT' ? selectedPresetId : null}
      syntheticOptions={syntheticOptions}
      title={mapName}
      visible={visible}
    />
  );
}
