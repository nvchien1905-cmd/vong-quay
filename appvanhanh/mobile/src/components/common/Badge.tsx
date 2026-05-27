import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  label: string;
  color: string;
  textColor?: string;
  size?: 'sm' | 'md';
}

export default function Badge({ label, color, textColor = '#fff', size = 'md' }: Props) {
  return (
    <View style={[styles.badge, { backgroundColor: color }, size === 'sm' && styles.sm]}>
      <Text style={[styles.text, { color: textColor }, size === 'sm' && styles.smText]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  sm: { paddingHorizontal: 6, paddingVertical: 2 },
  text: { fontSize: 12, fontWeight: '600' },
  smText: { fontSize: 10 },
});
