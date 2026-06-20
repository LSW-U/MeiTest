import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  Alert,
  Platform,
  Pressable,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { components } from '@meimart/shared-types';
import {
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '../locales';
import { changeLanguage } from '../i18n';

type LoginRequest = components['schemas']['LoginRequest'];

const LOCALE_LABELS: Record<SupportedLanguage, string> = {
  en: 'EN',
  zh: '中',
  id: 'ID',
  pt: 'PT',
};

export function LoginScreen() {
  const { t, i18n } = useTranslation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function onSubmit() {
    setSubmitting(true);
    const body: LoginRequest = { identifier, password };
    // TODO: D4-T6 接入真实 /api/v1/common/auth/login-password
    console.log('login payload:', body);
    setTimeout(() => {
      setSubmitting(false);
      Alert.alert(t('login.devsStubNoBackend'));
    }, 300);
  }

  function onLanguageChange(lng: SupportedLanguage) {
    changeLanguage(lng);
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{t('login.title')}</Text>

        <Text style={styles.label}>{t('login.identifier')}</Text>
        <TextInput
          style={styles.input}
          value={identifier}
          onChangeText={setIdentifier}
          placeholder={t('login.identifierPlaceholder')}
          autoCapitalize="none"
          autoComplete="username"
        />

        <Text style={styles.label}>{t('login.password')}</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder={t('login.passwordPlaceholder')}
          secureTextEntry
          autoComplete="password"
        />

        <View style={styles.buttonWrap}>
          <Button
            title={submitting ? t('login.submitting') : t('login.submit')}
            onPress={onSubmit}
            disabled={submitting}
          />
        </View>

        <Text style={styles.hint}>{t('login.seedAccountHint')}</Text>

        <View style={styles.langRow}>
          {SUPPORTED_LANGUAGES.map((l) => (
            <Pressable
              key={l}
              onPress={() => onLanguageChange(l)}
              style={[
                styles.langBtn,
                i18n.language === l && styles.langBtnActive,
              ]}
            >
              <Text
                style={[
                  styles.langText,
                  i18n.language === l && styles.langTextActive,
                ]}
              >
                {LOCALE_LABELS[l]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  title: {
    fontSize: 22,
    fontWeight: '600' as const,
    marginBottom: 20,
    textAlign: 'center',
  },
  label: {
    fontSize: 13,
    color: '#666',
    marginTop: 12,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d5d5d5',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 10, android: 8 }),
    fontSize: 14,
  },
  buttonWrap: {
    marginTop: 20,
  },
  hint: {
    marginTop: 16,
    fontSize: 11,
    color: '#999',
    textAlign: 'center',
  },
  langRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },
  langBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#d5d5d5',
    borderRadius: 4,
  },
  langBtnActive: {
    backgroundColor: '#1a5dc2',
    borderColor: '#1a5dc2',
  },
  langText: {
    fontSize: 12,
    color: '#666',
  },
  langTextActive: {
    color: 'white',
    fontWeight: '600' as const,
  },
});
