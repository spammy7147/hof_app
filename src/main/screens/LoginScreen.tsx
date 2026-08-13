import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { scrollFocusedInputIntoView } from '../components/keyboardAwareScroll';
import { theme } from '../styles/theme';

type LoginScreenProps = {
  errorMessage: string | null;
  isSubmitting: boolean;
  onSubmit: (loginId: string, password: string) => Promise<void>;
};

/**
 * HOF 계정으로 로그인하는 첫 화면이다.
 */
export function LoginScreen({ errorMessage, isSubmitting, onSubmit }: LoginScreenProps) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  /**
   * 입력값을 검증한 뒤 부모 App의 로그인 흐름으로 넘긴다.
   */
  async function handleSubmit() {
    const trimmedLoginId = loginId.trim();
    if (!trimmedLoginId || !password) {
      setLocalError('아이디와 비밀번호를 입력하세요.');
      return;
    }

    setLocalError(null);
    await onSubmit(trimmedLoginId, password).catch(() => {
      // The parent owns the visible backend error message.
    });
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.keyboard}
    >
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.container}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onFocus={(event) => scrollFocusedInputIntoView(scrollRef.current, event.nativeEvent.target)}
        ref={scrollRef}
      >
        <View style={styles.header}>
          <Text style={styles.appName}>Spammy HOF</Text>
          <Text style={styles.subtitle}>HOF 계정을 확인하고 안전하게 연결합니다.</Text>
        </View>

        <View style={styles.form}>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isSubmitting}
            onChangeText={setLoginId}
            placeholder="HOF ID"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.input}
            value={loginId}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isSubmitting}
            onChangeText={setPassword}
            placeholder="비밀번호"
            placeholderTextColor={theme.colors.textMuted}
            secureTextEntry
            style={styles.input}
            value={password}
          />

          {localError || errorMessage ? (
            <Text style={styles.error}>{localError ?? errorMessage}</Text>
          ) : null}

          <PrimaryButton
            label="로그인"
            loading={isSubmitting}
            onPress={handleSubmit}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboard: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.xl,
  },
  header: {
    gap: theme.spacing.sm,
  },
  appName: {
    color: theme.colors.text,
    fontSize: 34,
    fontWeight: '900',
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 15,
    lineHeight: 21,
  },
  form: {
    gap: theme.spacing.md,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    fontSize: 16,
    paddingHorizontal: theme.spacing.md,
  },
  error: {
    color: theme.colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
});
