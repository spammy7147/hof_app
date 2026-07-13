import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';

import { theme } from '../styles/theme';

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  style?: StyleProp<ViewStyle>;
};

/**
 * 앱 전반에서 사용하는 기본 버튼 컴포넌트다.
 */
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  style,
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;
  const indicatorColor = variant === 'secondary' ? theme.colors.text : theme.colors.buttonText;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={indicatorColor} />
      ) : (
        <Text style={[styles.label, variant === 'secondary' && styles.secondaryLabel]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  primary: {
    backgroundColor: theme.colors.accentGreen,
  },
  secondary: {
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.border,
    borderWidth: 1,
  },
  danger: {
    backgroundColor: theme.colors.danger,
  },
  disabled: {
    opacity: 0.48,
  },
  pressed: {
    opacity: 0.82,
  },
  label: {
    color: theme.colors.buttonText,
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryLabel: {
    color: theme.colors.text,
  },
});
