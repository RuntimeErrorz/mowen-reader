import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, GestureResponderEvent, Image, PanResponder, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { BookSummary } from '../types';
import { BOOK_COVER_ASPECT_RATIO, C, ReaderPalette } from '../ui/theme';
import { styles } from '../ui/styles';

type SortableBookGridProps = {
  books: BookSummary[];
  palette: ReaderPalette;
  importing: boolean;
  openingBookId: string | null;
  onImport: () => void;
  onOpen: (book: BookSummary) => void;
  onRemove: (book: BookSummary) => Promise<void>;
  onRemoveRequest: (book: BookSummary, confirm: () => void) => void;
  onCancelRemove: () => void;
  pendingRemovalId: string | null;
  removalPending: boolean;
  onReorder: (books: BookSummary[]) => Promise<void>;
  onNotice: (text: string, error?: boolean) => void;
  onDraggingChange: (dragging: boolean) => void;
};

type GridPoint = { left: number; top: number };
type DragState = { id: string; originIndex: number; targetIndex: number };

const LONG_PRESS_MS = 360;
const MOVE_THRESHOLD = 8;
const SPRING_CONFIG = { useNativeDriver: true, speed: 20, bounciness: 6 } as const;
const COVER_PALETTES: Array<[string, string]> = [
  ['#8DA9A6', '#355B61'], ['#A5A797', '#4E554F'], ['#B58D73', '#654B42'], ['#78919E', '#354D59'],
];

export function SortableBookGrid(props: SortableBookGridProps) {
  const [orderedBooks, setOrderedBooks] = useState(props.books);
  const [gridWidth, setGridWidth] = useState(0);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const finishingDragRef = useRef(false);
  const deletingRef = useRef<string | null>(null);
  const dragOffset = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  useEffect(() => {
    if (dragRef.current || deletingRef.current) return;
    setOrderedBooks(props.books);
  }, [props.books]);

  const metrics = useMemo(() => {
    const width = gridWidth || 300;
    const tileWidth = width * 0.46;
    const columnGap = width - tileWidth * 2;
    const coverHeight = tileWidth / BOOK_COVER_ASPECT_RATIO;
    const rowHeight = coverHeight + 70;
    return { width, tileWidth, columnGap, coverHeight, rowHeight };
  }, [gridWidth]);

  const slotForIndex = useCallback((index: number): GridPoint => ({
    left: index % 2 === 0 ? 0 : metrics.tileWidth + metrics.columnGap,
    top: Math.floor(index / 2) * metrics.rowHeight,
  }), [metrics.columnGap, metrics.rowHeight, metrics.tileWidth]);

  const gridHeight = Math.max(metrics.rowHeight, Math.ceil((orderedBooks.length + 1) / 2) * metrics.rowHeight);

  const findTargetIndex = useCallback((originIndex: number, dx: number, dy: number) => {
    const origin = slotForIndex(originIndex);
    const center = {
      x: origin.left + dx + metrics.tileWidth / 2,
      y: origin.top + dy + metrics.rowHeight / 2,
    };
    let targetIndex = originIndex;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < orderedBooks.length; index += 1) {
      const slot = slotForIndex(index);
      const slotCenterX = slot.left + metrics.tileWidth / 2;
      const slotCenterY = slot.top + metrics.rowHeight / 2;
      const distance = Math.hypot(center.x - slotCenterX, center.y - slotCenterY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        targetIndex = index;
      }
    }
    return targetIndex;
  }, [metrics.rowHeight, metrics.tileWidth, orderedBooks.length, slotForIndex]);

  const beginDrag = useCallback((id: string) => {
    if (props.openingBookId || props.removalPending || deletingRef.current || dragRef.current) return;
    const originIndex = orderedBooks.findIndex((book) => book.id === id);
    if (originIndex < 0) return;
    const next = { id, originIndex, targetIndex: originIndex };
    dragRef.current = next;
    finishingDragRef.current = false;
    dragOffset.stopAnimation();
    dragOffset.setValue({ x: 0, y: 0 });
    setDragState(next);
    props.onDraggingChange(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [dragOffset, orderedBooks, props.onDraggingChange, props.openingBookId, props.removalPending]);

  const moveDrag = useCallback((id: string, dx: number, dy: number) => {
    const current = dragRef.current;
    if (!current || current.id !== id || finishingDragRef.current) return;
    dragOffset.setValue({ x: dx, y: dy });
    const targetIndex = findTargetIndex(current.originIndex, dx, dy);
    if (targetIndex === current.targetIndex) return;
    current.targetIndex = targetIndex;
    setDragState({ ...current });
  }, [dragOffset, findTargetIndex]);

  const finishDrag = useCallback(() => {
    const current = dragRef.current;
    if (!current || finishingDragRef.current) return;
    finishingDragRef.current = true;
    const origin = slotForIndex(current.originIndex);
    const target = slotForIndex(current.targetIndex);
    const snapTo = { x: target.left - origin.left, y: target.top - origin.top };
    const complete = () => {
      const latest = dragRef.current;
      if (!latest) return;
      const next = moveBook(orderedBooks, latest.originIndex, latest.targetIndex);
      dragRef.current = null;
      finishingDragRef.current = false;
      setDragState(null);
      setOrderedBooks(next);
      props.onDraggingChange(false);
      props.onReorder(next).catch((cause) => {
        props.onNotice(cause instanceof Error ? `排序未保存：${cause.message}` : '排序未保存，请稍后重试。', true);
      });
    };
    Animated.spring(dragOffset, { ...SPRING_CONFIG, toValue: snapTo }).start(complete);
  }, [dragOffset, orderedBooks, props, slotForIndex]);

  const cancelDrag = useCallback(() => {
    if (!dragRef.current || finishingDragRef.current) return;
    finishingDragRef.current = true;
    Animated.spring(dragOffset, { ...SPRING_CONFIG, toValue: { x: 0, y: 0 } }).start(() => {
      dragRef.current = null;
      finishingDragRef.current = false;
      setDragState(null);
      props.onDraggingChange(false);
    });
  }, [dragOffset, props.onDraggingChange]);

  const removeBook = useCallback(async (book: BookSummary) => {
    if (deletingRef.current || dragRef.current) return;
    deletingRef.current = book.id;
    setDeletingId(book.id);
    try {
      await props.onRemove(book);
      setOrderedBooks((current) => current.filter((item) => item.id !== book.id));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      props.onNotice(`“${book.title}”已移出书架`);
    } catch (cause) {
      props.onNotice(cause instanceof Error ? `移出失败：${cause.message}` : '移出失败，请稍后重试。', true);
    } finally {
      deletingRef.current = null;
      setDeletingId(null);
    }
  }, [props]);

  const requestRemove = useCallback((book: BookSummary) => {
    if (props.removalPending || deletingRef.current || dragRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    props.onRemoveRequest(book, () => { void removeBook(book); });
  }, [props.onRemoveRequest, removeBook]);

  return (
    <View onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)} style={[styles.bookGrid, styles.sortableGrid, { height: gridHeight }]}>
      {props.removalPending && <Pressable accessibilityRole="button" accessibilityLabel="取消删除" onPress={props.onCancelRemove} style={styles.sortableDismissLayer} />}
      {orderedBooks.map((book, index) => {
        const isDragging = dragState?.id === book.id;
        const visualIndex = dragState ? visualIndexFor(index, dragState.originIndex, dragState.targetIndex) : index;
        const position = slotForIndex(visualIndex);
        if (isDragging) {
          return (
            <SortableBookTile
              key={book.id}
              book={book}
              palette={props.palette}
              position={slotForIndex(dragState.originIndex)}
              tileWidth={metrics.tileWidth}
              loading={false}
              disabled={!!props.openingBookId || props.removalPending || !!deletingId}
              deleting={false}
              markedForRemoval={false}
              hidden
              onOpen={() => props.onOpen(book)}
              onDelete={() => requestRemove(book)}
              onDragStart={() => beginDrag(book.id)}
              onDragMove={(dx, dy) => moveDrag(book.id, dx, dy)}
              onDragEnd={finishDrag}
              onDragCancel={cancelDrag}
            />
          );
        }
        return (
          <SortableBookTile
            key={book.id}
            book={book}
            palette={props.palette}
            position={position}
            tileWidth={metrics.tileWidth}
            loading={props.openingBookId === book.id}
            disabled={!!props.openingBookId || props.removalPending || !!deletingId}
            deleting={deletingId === book.id}
            markedForRemoval={props.pendingRemovalId === book.id}
            onOpen={() => props.onOpen(book)}
            onDelete={() => requestRemove(book)}
            onDragStart={() => beginDrag(book.id)}
            onDragMove={(dx, dy) => moveDrag(book.id, dx, dy)}
            onDragEnd={finishDrag}
            onDragCancel={cancelDrag}
          />
        );
      })}

      {dragState && (
        <SortableBookTile
          key={`drag-${dragState.id}`}
          book={orderedBooks[dragState.originIndex]}
          palette={props.palette}
          position={slotForIndex(dragState.originIndex)}
          tileWidth={metrics.tileWidth}
          loading={false}
          disabled
          deleting={false}
          markedForRemoval={false}
          overlay
          dragOffset={dragOffset}
          onOpen={() => undefined}
          onDelete={() => undefined}
          onDragStart={() => undefined}
          onDragMove={() => undefined}
          onDragEnd={() => undefined}
          onDragCancel={() => undefined}
        />
      )}

      <View style={[styles.addTileWrap, styles.sortableTile, { width: metrics.tileWidth, height: metrics.rowHeight, left: slotForIndex(orderedBooks.length).left, top: slotForIndex(orderedBooks.length).top }]}>
        <Pressable disabled={!!deletingId || props.removalPending} onPress={props.onImport} style={({ pressed }) => [styles.addTile, { borderColor: props.palette.line, backgroundColor: props.palette.surface }, pressed && styles.cardPressed]}>
          {props.importing ? <ActivityIndicator color={props.palette.accent} /> : <Ionicons name="add" size={30} color={props.palette.accent} />}
          <Text style={[styles.addText, { color: props.palette.accent }]}>{props.importing ? '正在导入…' : '导入 EPUB'}</Text>
          <Text style={[styles.addHint, { color: props.palette.muted }]}>文件仅保存在本机</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SortableBookTile(props: {
  book: BookSummary;
  palette: ReaderPalette;
  position: GridPoint;
  tileWidth: number;
  loading: boolean;
  disabled: boolean;
  deleting: boolean;
  markedForRemoval: boolean;
  overlay?: boolean;
  hidden?: boolean;
  dragOffset?: Animated.ValueXY;
  onOpen: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragMove: (dx: number, dy: number) => void;
  onDragEnd: () => void;
  onDragCancel: () => void;
}) {
  const position = useRef(new Animated.ValueXY({ x: props.position.left, y: props.position.top })).current;
  const deleteOpacity = useRef(new Animated.Value(1)).current;
  const deleteScale = useRef(new Animated.Value(1)).current;
  const wasHidden = useRef(!!props.hidden);
  const hasPositioned = useRef(false);
  const lastTileWidth = useRef(props.tileWidth);
  const gestureMode = useRef<'idle' | 'pending' | 'pendingDelete' | 'dragReady' | 'dragging' | 'ending' | 'deleting'>('idle');
  const touchCount = useRef(0);
  const touchStart = useRef({ x: 0, y: 0 });
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionsRef = useRef({ onOpen: props.onOpen, onDelete: props.onDelete, onDragStart: props.onDragStart, onDragMove: props.onDragMove, onDragEnd: props.onDragEnd, onDragCancel: props.onDragCancel });
  const [pressed, setPressed] = useState(false);
  actionsRef.current = { onOpen: props.onOpen, onDelete: props.onDelete, onDragStart: props.onDragStart, onDragMove: props.onDragMove, onDragEnd: props.onDragEnd, onDragCancel: props.onDragCancel };

  useLayoutEffect(() => {
    const nextPosition = { x: props.position.left, y: props.position.top };
    const layoutChanged = hasPositioned.current && lastTileWidth.current !== props.tileWidth;
    if (wasHidden.current && !props.hidden) {
      position.stopAnimation();
      position.setValue(nextPosition);
    } else if (!hasPositioned.current || layoutChanged || props.overlay) {
      position.stopAnimation();
      position.setValue(nextPosition);
    } else {
      Animated.spring(position, { ...SPRING_CONFIG, toValue: nextPosition }).start();
    }
    wasHidden.current = !!props.hidden;
    hasPositioned.current = true;
    lastTileWidth.current = props.tileWidth;
  }, [position, props.hidden, props.overlay, props.position.left, props.position.top, props.tileWidth]);

  useEffect(() => {
    if (props.deleting) {
      Animated.parallel([
        Animated.timing(deleteOpacity, { toValue: 0, duration: 170, useNativeDriver: true }),
        Animated.spring(deleteScale, { toValue: 0.9, useNativeDriver: true, speed: 24, bounciness: 0 }),
      ]).start();
    } else {
      deleteOpacity.setValue(1);
      deleteScale.setValue(1);
    }
  }, [deleteOpacity, deleteScale, props.deleting]);

  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  const clearHoldTimer = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }, []);

  const scheduleHold = (deleteIntent: boolean) => {
    clearHoldTimer();
    holdTimer.current = setTimeout(() => {
      if (gestureMode.current !== 'pending' && gestureMode.current !== 'pendingDelete') return;
      if (deleteIntent || touchCount.current >= 2) {
        gestureMode.current = 'deleting';
        setPressed(false);
        actionsRef.current.onDelete();
      } else {
        gestureMode.current = 'dragReady';
        setPressed(false);
        actionsRef.current.onDragStart();
      }
    }, LONG_PRESS_MS);
  };

  const getTouchCount = (event: GestureResponderEvent) => Math.max(1, event.nativeEvent.touches?.length ?? 1);
  const movedTooFar = (event: GestureResponderEvent) => Math.hypot(event.nativeEvent.pageX - touchStart.current.x, event.nativeEvent.pageY - touchStart.current.y) > MOVE_THRESHOLD;

  const handleTouchStart = (event: GestureResponderEvent) => {
    if (props.overlay || props.disabled) return;
    const count = getTouchCount(event);
    touchCount.current = count;
    touchStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
    gestureMode.current = count >= 2 ? 'pendingDelete' : 'pending';
    setPressed(true);
    scheduleHold(count >= 2);
  };

  const handleTouchMove = (event: GestureResponderEvent) => {
    const count = getTouchCount(event);
    touchCount.current = count;
    if (count >= 2 && (gestureMode.current === 'dragReady' || gestureMode.current === 'dragging')) {
      actionsRef.current.onDragCancel();
      gestureMode.current = 'pendingDelete';
      scheduleHold(false);
      return;
    }
    if ((gestureMode.current === 'pending' || gestureMode.current === 'pendingDelete') && movedTooFar(event)) {
      clearHoldTimer();
      gestureMode.current = 'idle';
      setPressed(false);
    }
  };

  const finishTouch = useCallback(() => {
    clearHoldTimer();
    touchCount.current = 0;
    setPressed(false);
  }, [clearHoldTimer]);

  const handleTouchEnd = () => {
    if (gestureMode.current === 'pending') {
      finishTouch();
      gestureMode.current = 'idle';
      actionsRef.current.onOpen();
    } else if (gestureMode.current === 'dragReady') {
      finishTouch();
      gestureMode.current = 'ending';
      actionsRef.current.onDragCancel();
    } else if (gestureMode.current === 'dragging') {
      finishTouch();
      gestureMode.current = 'ending';
      actionsRef.current.onDragEnd();
    } else if (gestureMode.current === 'pendingDelete' || gestureMode.current === 'deleting') {
      finishTouch();
      gestureMode.current = 'idle';
    } else {
      finishTouch();
      gestureMode.current = 'idle';
    }
  };

  const handleTouchCancel = () => {
    clearHoldTimer();
    setPressed(false);
    if (gestureMode.current === 'dragReady' || gestureMode.current === 'dragging') actionsRef.current.onDragCancel();
    gestureMode.current = 'idle';
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder: () => gestureMode.current === 'dragReady' || gestureMode.current === 'dragging',
    onMoveShouldSetPanResponderCapture: () => gestureMode.current === 'dragReady' || gestureMode.current === 'dragging',
    onPanResponderGrant: () => {
      if (gestureMode.current === 'dragReady') gestureMode.current = 'dragging';
    },
    onPanResponderMove: (_event, gesture) => {
      if (gestureMode.current === 'dragging') actionsRef.current.onDragMove(gesture.dx, gesture.dy);
    },
    onPanResponderRelease: () => {
      if (gestureMode.current !== 'dragging') return;
      finishTouch();
      gestureMode.current = 'ending';
      actionsRef.current.onDragEnd();
    },
    onPanResponderTerminate: () => {
      if (gestureMode.current === 'dragReady' || gestureMode.current === 'dragging') actionsRef.current.onDragCancel();
      finishTouch();
      gestureMode.current = 'idle';
    },
    onPanResponderTerminationRequest: () => false,
  }), [finishTouch]);

  const translateX = props.overlay && props.dragOffset ? Animated.add(position.x, props.dragOffset.x) : position.x;
  const translateY = props.overlay && props.dragOffset ? Animated.add(position.y, props.dragOffset.y) : position.y;

  return (
    <Animated.View
      pointerEvents={props.overlay ? 'none' : 'auto'}
      accessibilityRole="button"
      accessibilityLabel={props.book.title}
      accessibilityHint="单击打开；单指长按拖动排序；双指长按移出书架"
      {...(!props.overlay ? panResponder.panHandlers : {})}
      onTouchStart={props.overlay ? undefined : handleTouchStart}
      onTouchMove={props.overlay ? undefined : handleTouchMove}
      onTouchEnd={props.overlay ? undefined : handleTouchEnd}
      onTouchCancel={props.overlay ? undefined : handleTouchCancel}
      style={[
        styles.bookTileWrap,
        styles.sortableTile,
        { width: props.tileWidth, zIndex: props.overlay ? 40 : props.deleting ? 20 : 1, elevation: props.overlay ? 12 : 4 },
        { opacity: deleteOpacity, transform: [{ translateX }, { translateY }, { scale: deleteScale }] },
      ]}
    >
      <View style={{ opacity: props.hidden ? 0 : 1 }}>
        <BookTileContent book={props.book} palette={props.palette} loading={props.loading} pressed={pressed} markedForRemoval={props.markedForRemoval} />
      </View>
    </Animated.View>
  );
}

function BookTileContent({ book, palette, loading, pressed, markedForRemoval }: { book: BookSummary; palette: ReaderPalette; loading: boolean; pressed: boolean; markedForRemoval: boolean }) {
  const colors = coverColorsFor(book.id);
  return (
    <View>
      <View style={[styles.bookTile, pressed && styles.cardPressed, markedForRemoval && { borderWidth: 2, borderColor: palette.danger }]}>
        {book.cover ? <Image source={{ uri: book.cover }} style={styles.coverImage} /> : (
          <LinearGradient colors={colors} style={styles.coverFallback}>
            <View style={styles.coverLine} />
            <Text numberOfLines={4} style={styles.coverTitle}>{book.title}</Text>
            <Text numberOfLines={1} style={styles.coverAuthor}>{book.author}</Text>
            <Text style={styles.coverSeal}>墨问</Text>
          </LinearGradient>
        )}
        {loading && <View style={styles.bookOpening}><ActivityIndicator color={C.white} /></View>}
        {markedForRemoval && <View style={[styles.bookRemovalMarker, { backgroundColor: palette.danger }]}><Ionicons name="trash-outline" size={14} color={palette.onAccent} /></View>}
        {book.progress > 0 && <View style={styles.bookProgress}><View style={[styles.bookProgressFill, { width: `${Math.min(1, book.progress) * 100}%` }]} /></View>}
      </View>
      <Text numberOfLines={1} style={[styles.tileTitle, { color: palette.text }]}>{book.title}</Text>
      <Text numberOfLines={1} style={[styles.tileAuthor, { color: palette.muted }]}>{book.author}</Text>
    </View>
  );
}

function coverColorsFor(id: string): [string, string] {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return COVER_PALETTES[Math.abs(hash) % COVER_PALETTES.length];
}

function visualIndexFor(index: number, originIndex: number, targetIndex: number) {
  if (index === originIndex) return originIndex;
  if (originIndex < targetIndex && index > originIndex && index <= targetIndex) return index - 1;
  if (originIndex > targetIndex && index >= targetIndex && index < originIndex) return index + 1;
  return index;
}

function moveBook<T>(items: T[], from: number, to: number) {
  if (from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
