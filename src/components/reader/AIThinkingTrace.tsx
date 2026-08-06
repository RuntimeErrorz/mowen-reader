import React, { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ReaderPalette } from '../../ui/theme';
import { styles } from '../../ui/styles';
import { useAutoScrollToLatest } from './useAutoScrollToLatest';

export function AIThinkingTrace({ palette, thinking, active = false, defaultExpanded = false }: { palette: ReaderPalette; thinking?: string; active?: boolean; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded || active);
  const { scrollRef, beginFollowing, handleScroll, handleContentSizeChange, handleLayout } = useAutoScrollToLatest();
  const content = thinking?.trim() || '';
  const hasContent = !!content;
  useEffect(() => {
    if (active || defaultExpanded) setExpanded(true);
  }, [active, defaultExpanded]);
  useEffect(() => {
    if (expanded) beginFollowing();
  }, [beginFollowing, expanded]);
  if (!active && !hasContent) return null;

  return (
    <View style={styles.thinkingTrace}>
      <Pressable
        accessibilityRole={hasContent ? 'button' : undefined}
        accessibilityLabel={hasContent ? (expanded ? '收起思考过程' : '展开思考过程') : '正在思考'}
        accessibilityState={{ disabled: !hasContent }}
        disabled={!hasContent}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.thinkingTraceHeader, pressed && { opacity: 0.82 }]}
      >
        <Text style={[styles.thinkingTraceTitle, { color: palette.muted }]}>{active ? '思考中' : '思考过程'}</Text>
        {(active || hasContent) && <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={palette.muted} />}
      </Pressable>
      {expanded && hasContent && (
        <ScrollView
          ref={scrollRef}
          onLayout={handleLayout}
          onScroll={handleScroll}
          onContentSizeChange={handleContentSizeChange}
          scrollEventThrottle={16}
          nestedScrollEnabled
          style={[styles.thinkingTraceBody, { borderTopColor: palette.line }]}
          contentContainerStyle={styles.thinkingTraceBodyContent}
        >
          <Text style={[styles.thinkingTraceText, { color: palette.muted }]}>{content}</Text>
        </ScrollView>
      )}
    </View>
  );
}
