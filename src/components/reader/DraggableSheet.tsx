import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { getReaderPalette, ReaderPalette } from '../../ui/theme';
import { styles } from '../../ui/styles';

type DraggableSheetProps = {
  visible: boolean;
  onClose: () => void;
  palette?: ReaderPalette;
  animateIn?: boolean;
  fillBelow?: boolean;
  style?: React.ComponentProps<typeof Animated.View>['style'];
  children: React.ReactNode;
};

export function DraggableSheet(props: DraggableSheetProps) {
  const palette = props.palette ?? getReaderPalette('paper');
  const { height: windowHeight } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(props.animateIn ? windowHeight : 0)).current;
  useEffect(() => {
    if (!props.visible) return;
    if (!props.animateIn) { translateY.setValue(0); return; }
    const frame = requestAnimationFrame(() => {
      Animated.timing(translateY, { toValue: 0, duration: 190, useNativeDriver: true }).start();
    });
    return () => cancelAnimationFrame(frame);
  }, [props.animateIn, props.visible, translateY]);
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 2 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => translateY.stopAnimation(),
    onPanResponderMove: (_event, gesture) => translateY.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > 95 || gesture.vy > 0.85) {
        const duration = Math.max(130, Math.min(260, 240 - Math.max(0, gesture.vy) * 70));
        Animated.timing(translateY, { toValue: windowHeight, duration, useNativeDriver: true }).start(props.onClose);
      } else {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 4 }).start();
      }
    },
    onPanResponderTerminate: () => Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start(),
  }), [props.onClose, translateY, windowHeight]);
  const scrimOpacity = translateY.interpolate({
    inputRange: [0, Math.max(1, windowHeight * 0.7)],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  return <>
    <Animated.View style={[styles.scrim, { backgroundColor: palette.scrim, opacity: scrimOpacity }]}><Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} /></Animated.View>
    <Animated.View style={[styles.sheet, { backgroundColor: palette.surface }, props.style, { transform: [{ translateY }] }]}>
      {props.fillBelow && <View pointerEvents="none" style={[styles.sheetFillBelow, { height: windowHeight, backgroundColor: palette.surface }]} />}
      <View style={styles.dragHandleZone} {...panResponder.panHandlers}><SheetHandle color={palette.line} /></View>
      {props.children}
    </Animated.View>
  </>;
}

export function SheetHandle({ color = '#C2CAC5' }: { color?: string }) {
  return <View style={[styles.handle, { backgroundColor: color }]} />;
}
