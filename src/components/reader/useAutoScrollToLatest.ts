import { useCallback, useEffect, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

const BOTTOM_THRESHOLD = 48;

export function useAutoScrollToLatest() {
  const scrollRef = useRef<ScrollView>(null);
  const followLatestRef = useRef(false);
  const frameRef = useRef<number | null>(null);

  const scrollToLatest = useCallback((animated = false) => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      scrollRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const beginFollowing = useCallback(() => {
    followLatestRef.current = true;
    scrollToLatest(true);
  }, [scrollToLatest]);

  const resetFollowing = useCallback(() => {
    followLatestRef.current = false;
  }, []);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceToBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    followLatestRef.current = distanceToBottom <= BOTTOM_THRESHOLD;
  }, []);

  const handleContentSizeChange = useCallback(() => {
    if (followLatestRef.current) scrollToLatest();
  }, [scrollToLatest]);

  const handleLayout = useCallback(() => {
    if (followLatestRef.current) scrollToLatest();
  }, [scrollToLatest]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  return { scrollRef, beginFollowing, resetFollowing, handleScroll, handleContentSizeChange, handleLayout, scrollToLatest };
}
