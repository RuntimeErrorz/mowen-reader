import { useCallback, useEffect, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

const BOTTOM_THRESHOLD = 48;

export function useAutoScrollToLatest() {
  const scrollRef = useRef<ScrollView>(null);
  const followLatestRef = useRef(false);
  const userDraggingRef = useRef(false);
  const userScrolledAwayRef = useRef(false);
  const frameRef = useRef<number | null>(null);

  const isNearBottom = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    return contentSize.height - (contentOffset.y + layoutMeasurement.height) <= BOTTOM_THRESHOLD;
  }, []);

  const scrollToLatest = useCallback((animated = false) => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      scrollRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const beginFollowing = useCallback(() => {
    followLatestRef.current = true;
    userScrolledAwayRef.current = false;
    scrollToLatest();
  }, [scrollToLatest]);

  const resetFollowing = useCallback(() => {
    followLatestRef.current = false;
    userDraggingRef.current = false;
    userScrolledAwayRef.current = false;
  }, []);

  const handleInputFocus = useCallback(() => {
    if (userScrolledAwayRef.current) return;
    followLatestRef.current = true;
    scrollToLatest();
  }, [scrollToLatest]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (userDraggingRef.current) followLatestRef.current = isNearBottom(event);
  }, [isNearBottom]);

  const handleScrollBeginDrag = useCallback(() => {
    userDraggingRef.current = true;
    followLatestRef.current = false;
    userScrolledAwayRef.current = true;
  }, []);

  const handleScrollEndDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    userDraggingRef.current = false;
    const nearBottom = isNearBottom(event);
    followLatestRef.current = nearBottom;
    userScrolledAwayRef.current = !nearBottom;
  }, [isNearBottom]);

  const handleMomentumScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    userDraggingRef.current = false;
    const nearBottom = isNearBottom(event);
    followLatestRef.current = nearBottom;
    userScrolledAwayRef.current = !nearBottom;
  }, [isNearBottom]);

  const handleContentSizeChange = useCallback(() => {
    if (followLatestRef.current) scrollToLatest();
  }, [scrollToLatest]);

  const handleLayout = useCallback(() => {
    if (followLatestRef.current) scrollToLatest();
  }, [scrollToLatest]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  return { scrollRef, beginFollowing, resetFollowing, handleInputFocus, handleScroll, handleScrollBeginDrag, handleScrollEndDrag, handleMomentumScrollEnd, handleContentSizeChange, handleLayout, scrollToLatest };
}
