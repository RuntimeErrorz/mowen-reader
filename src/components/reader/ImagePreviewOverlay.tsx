import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  GestureResponderEvent,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { styles } from '../../ui/styles';

type ImageSize = { width: number; height: number };
type ImageFrame = { width: number; height: number };
type Point = { x: number; y: number };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getTouchPoints = (event: GestureResponderEvent): Point[] => {
  const touches = event.nativeEvent.touches.length > 0 ? event.nativeEvent.touches : event.nativeEvent.changedTouches;
  if (touches.length > 0) return touches.map((touch) => ({ x: touch.pageX, y: touch.pageY }));
  return [{ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }];
};

const getDistance = (first: Point, second: Point) => Math.hypot(second.x - first.x, second.y - first.y);

const getMidpoint = (first: Point, second: Point): Point => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2,
});

export function ImagePreviewOverlay({ imageUri, onClose }: { imageUri: string | null; onClose: () => void }) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scaleRef = useRef(1);
  const translateXRef = useRef(0);
  const translateYRef = useRef(0);
  const frameRef = useRef<ImageFrame | null>(null);
  const viewportRef = useRef({ width: windowWidth, height: windowHeight });
  const startPointRef = useRef<Point | null>(null);
  const startPanRef = useRef({ x: 0, y: 0 });
  const pinchDistanceRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef(1);
  const pinchStartPanRef = useRef({ x: 0, y: 0 });
  const pinchStartMidpointRef = useRef<Point | null>(null);
  const movedRef = useRef(false);
  const hadMultipleTouchesRef = useRef(false);
  const lastTapAtRef = useRef(0);

  const maxWidth = Math.max(1, windowWidth - 36);
  const maxHeight = Math.max(1, windowHeight - 72);
  const frame = useMemo<ImageFrame>(() => {
    if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0) {
      return { width: maxWidth, height: maxHeight };
    }

    const ratio = imageSize.width / imageSize.height;
    const width = Math.min(maxWidth, maxHeight * ratio);
    return { width, height: width / ratio };
  }, [imageSize, maxHeight, maxWidth]);

  frameRef.current = frame;
  viewportRef.current = { width: windowWidth, height: windowHeight };

  useEffect(() => {
    scaleRef.current = 1;
    translateXRef.current = 0;
    translateYRef.current = 0;
    scale.setValue(1);
    translateX.setValue(0);
    translateY.setValue(0);
    startPointRef.current = null;
    pinchDistanceRef.current = null;
    hadMultipleTouchesRef.current = false;
    lastTapAtRef.current = 0;
    setImageSize(null);

    if (!imageUri) return;

    let active = true;
    Image.getSize(
      imageUri,
      (width, height) => {
        if (active) setImageSize({ width, height });
      },
      () => {
        // The Image onLoad callback below still provides dimensions when getSize cannot resolve them ahead of time.
      },
    );

    return () => {
      active = false;
    };
  }, [imageUri, scale, translateX, translateY]);

  const getPanBounds = () => {
    const currentFrame = frameRef.current;
    if (!currentFrame) return { x: 0, y: 0 };

    const viewport = viewportRef.current;
    return {
      x: Math.max(0, (currentFrame.width * scaleRef.current - viewport.width) / 2),
      y: Math.max(0, (currentFrame.height * scaleRef.current - viewport.height) / 2),
    };
  };

  const setPan = (x: number, y: number) => {
    const bounds = getPanBounds();
    const nextX = clamp(x, -bounds.x, bounds.x);
    const nextY = clamp(y, -bounds.y, bounds.y);
    translateXRef.current = nextX;
    translateYRef.current = nextY;
    translateX.setValue(nextX);
    translateY.setValue(nextY);
  };

  const animateZoom = (nextScale: number) => {
    scaleRef.current = nextScale;
    if (nextScale <= 1) {
      translateXRef.current = 0;
      translateYRef.current = 0;
    } else {
      setPan(translateXRef.current, translateYRef.current);
    }

    Animated.parallel([
      Animated.spring(scale, { toValue: nextScale, useNativeDriver: true, friction: 8, tension: 90 }),
      Animated.spring(translateX, { toValue: translateXRef.current, useNativeDriver: true, friction: 8, tension: 90 }),
      Animated.spring(translateY, { toValue: translateYRef.current, useNativeDriver: true, friction: 8, tension: 90 }),
    ]).start();
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          movedRef.current = false;
          hadMultipleTouchesRef.current = false;
          const touches = getTouchPoints(event);
          if (touches.length >= 2) {
            hadMultipleTouchesRef.current = true;
            const midpoint = getMidpoint(touches[0], touches[1]);
            pinchDistanceRef.current = Math.max(1, getDistance(touches[0], touches[1]));
            pinchStartScaleRef.current = scaleRef.current;
            pinchStartPanRef.current = { x: translateXRef.current, y: translateYRef.current };
            pinchStartMidpointRef.current = midpoint;
            return;
          }

          startPointRef.current = touches[0] ?? null;
          startPanRef.current = { x: translateXRef.current, y: translateYRef.current };
        },
        onPanResponderMove: (event) => {
          const touches = getTouchPoints(event);
          if (touches.length >= 2) {
            hadMultipleTouchesRef.current = true;
            const distance = Math.max(1, getDistance(touches[0], touches[1]));
            const midpoint = getMidpoint(touches[0], touches[1]);
            if (pinchDistanceRef.current === null || !pinchStartMidpointRef.current) {
              pinchDistanceRef.current = distance;
              pinchStartScaleRef.current = scaleRef.current;
              pinchStartPanRef.current = { x: translateXRef.current, y: translateYRef.current };
              pinchStartMidpointRef.current = midpoint;
              return;
            }

            const nextScale = clamp(
              pinchStartScaleRef.current * (distance / pinchDistanceRef.current),
              1,
              4,
            );
            scaleRef.current = nextScale;
            scale.setValue(nextScale);
            const startMidpoint = pinchStartMidpointRef.current;
            setPan(
              pinchStartPanRef.current.x + midpoint.x - startMidpoint.x,
              pinchStartPanRef.current.y + midpoint.y - startMidpoint.y,
            );
            movedRef.current = true;
            return;
          }

          if (pinchDistanceRef.current !== null) {
            pinchDistanceRef.current = null;
            pinchStartMidpointRef.current = null;
            startPointRef.current = touches[0] ?? null;
            startPanRef.current = { x: translateXRef.current, y: translateYRef.current };
            return;
          }

          const point = touches[0];
          const startPoint = startPointRef.current;
          if (!point || !startPoint) return;

          const deltaX = point.x - startPoint.x;
          const deltaY = point.y - startPoint.y;
          if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) movedRef.current = true;
          if (scaleRef.current <= 1.01) return;

          setPan(startPanRef.current.x + deltaX, startPanRef.current.y + deltaY);
        },
        onPanResponderRelease: () => {
          const wasPinching = hadMultipleTouchesRef.current;
          pinchDistanceRef.current = null;
          pinchStartMidpointRef.current = null;
          startPointRef.current = null;

          if (movedRef.current || wasPinching) return;

          const now = Date.now();
          if (now - lastTapAtRef.current < 300) {
            lastTapAtRef.current = 0;
            animateZoom(scaleRef.current > 1.01 ? 1 : 2);
          } else {
            lastTapAtRef.current = now;
          }
        },
        onPanResponderTerminate: () => {
          pinchDistanceRef.current = null;
          pinchStartMidpointRef.current = null;
          startPointRef.current = null;
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  );

  if (!imageUri) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.imagePreviewRoot, { backgroundColor: '#000' }]}>
      <Pressable accessibilityLabel="Close image preview" style={StyleSheet.absoluteFill} onPress={onClose} />
      <View pointerEvents="box-none" style={styles.imagePreviewStage}>
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.imagePreviewImageSurface,
            { width: frame.width, height: frame.height },
            { transform: [{ translateX }, { translateY }, { scale }] },
          ]}
        >
          <Image
            source={{ uri: imageUri }}
            resizeMode="contain"
            onLoad={({ nativeEvent }) => {
              const { width, height } = nativeEvent.source;
              if (width > 0 && height > 0) setImageSize({ width, height });
            }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>
      </View>
    </View>
  );
}
