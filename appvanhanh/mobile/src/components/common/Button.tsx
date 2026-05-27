import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { Colors } from '../../utils/colors';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export default function Button({ title, onPress, variant = 'primary', loading, disabled, style }: Props) {
  const bg = {
    primary: Colors.primary,
    secondary: Colors.accent,
    danger: Colors.error,
    outline: 'transparent',
  }[variant];

  const tc = variant === 'outline' ? Colors.primary : Colors.white;

  return (
    <TouchableOpacity
      style={[styles.btn, { backgroundColor: bg }, variant === 'outline' && styles.outlineBorder,
        (disabled || loading) && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={tc} size="small" />
      ) : (
        <Text style={[styles.text, { color: tc }]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  outlineBorder: { borderWidth: 2, borderColor: Colors.primary },
  disabled: { opacity: 0.6 },
  text: { fontSize: 16, fontWeight: '700' },
});
