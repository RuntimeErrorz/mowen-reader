import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text } from 'react-native';
import { ReaderPalette } from '../../ui/theme';
import { styles } from '../../ui/styles';

export function AIThinkingToggle({ palette, value, onChange, disabled = false }: { palette: ReaderPalette; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="深度思考"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [
        styles.thinkingComposerToggle,
        { backgroundColor: value ? palette.surfaceAlt : 'transparent', borderColor: value ? palette.accent : palette.line },
        pressed && { opacity: 0.78 },
        disabled && styles.disabledControl,
      ]}
    >
      <Ionicons name={value ? 'sparkles' : 'sparkles-outline'} size={14} color={value ? palette.accent : palette.muted} />
      <Text style={[styles.thinkingComposerToggleText, { color: value ? palette.accent : palette.muted }]}>深度思考</Text>
    </Pressable>
  );
}
