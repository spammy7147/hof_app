import { StyleSheet, View } from 'react-native';

import { theme } from '../styles/theme';
import type { CompactSwitchProps } from './CompactSwitch';

/** HTML button이 Space·Enter와 비활성화를 처리하고, 트랙은 장식으로 표시한다. */
export function CompactSwitch({ value = false, disabled, onValueChange, style, ...props }: CompactSwitchProps) {
  const track = props.trackColor?.[value ? 'true' : 'false'];
  return (
    <View style={[styles.target, style]}>
      <button
        type="button"
        role="switch"
        aria-label={props.accessibilityLabel}
        aria-description={props.accessibilityHint}
        aria-checked={value}
        data-testid={props.testID}
        disabled={disabled}
        onClick={() => onValueChange?.(!value)}
        style={{
          alignItems: 'center', justifyContent: 'center', display: 'flex',
          minWidth: theme.control.touch, minHeight: theme.control.touch, width: '100%',
          padding: 0, border: 0, borderRadius: theme.radius.sm, background: 'transparent',
          cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
        }}
      >
        <span aria-hidden style={{ position: 'relative', width: 36, height: 20, borderRadius: 10,
          background: typeof track === 'string' ? track : value ? theme.colors.accentGreen : theme.colors.border }}>
          <span style={{ position: 'absolute', top: 0, left: value ? 16 : 0, width: 20, height: 20, borderRadius: '50%',
            background: typeof props.thumbColor === 'string' ? props.thumbColor : theme.colors.buttonText }} />
        </span>
      </button>
    </View>
  );
}

const styles = StyleSheet.create({
  target: { minWidth: theme.control.touch, minHeight: theme.control.touch, flexShrink: 0 },
});
