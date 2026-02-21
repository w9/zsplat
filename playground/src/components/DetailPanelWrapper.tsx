import { useState, useRef, useCallback, useEffect } from 'react';
import { Icon } from '@mdi/react';
import { mdiResizeBottomRight } from '@mdi/js';
import { Card } from '@/components/ui/card';
import { BOTTOM_BAR_OFFSET, TOP_BAR_OFFSET } from './BottomBar';

const DEFAULT_PANEL_WIDTH = 260;
const DEFAULT_PANEL_HEIGHT = 280;
const MIN_PANEL_WIDTH = 200;
const MIN_PANEL_HEIGHT = 120;

function getInitialPosition(
  anchor: 'top' | 'bottom',
  anchorIndex: number
): { x: number; y: number } {
  const x = 12;
  if (typeof window === 'undefined') return { x, y: 0 };
  if (anchor === 'top') {
    return { x, y: TOP_BAR_OFFSET + 12 + anchorIndex * 24 };
  }
  return {
    x,
    y: window.innerHeight - BOTTOM_BAR_OFFSET - DEFAULT_PANEL_HEIGHT - 12 - anchorIndex * 260,
  };
}

export function DetailPanelWrapper({
  title,
  anchor,
  onClose,
  anchorIndex = 0,
  initialWidth = DEFAULT_PANEL_WIDTH,
  initialHeight = DEFAULT_PANEL_HEIGHT,
  children,
}: {
  title: string;
  anchor: 'top' | 'bottom';
  onClose?: () => void;
  anchorIndex?: number;
  initialWidth?: number;
  initialHeight?: number;
  children: React.ReactNode;
}) {
  const [position, setPosition] = useState(() => getInitialPosition(anchor, anchorIndex));
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; left: number; top: number } | null>(null);
  const resizeStartRef = useRef<{
    clientX: number;
    clientY: number;
    width: number;
    height: number;
  } | null>(null);

  const handleTitleBarPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest?.('button')) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setDragging(true);
      dragStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        left: position.x,
        top: position.y,
      };
    },
    [position.x, position.y]
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      setPosition({
        x: start.left + (e.clientX - start.clientX),
        y: start.top + (e.clientY - start.clientY),
      });
    };
    const onUp = () => {
      setDragging(false);
      dragStartRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging]);

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setResizing(true);
    resizeStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      width: size.width,
      height: size.height,
    };
  }, [size.width, size.height]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: PointerEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const maxHeight = typeof window !== 'undefined' ? window.innerHeight * 0.8 : start.height;
      setSize({
        width: Math.max(MIN_PANEL_WIDTH, start.width + (e.clientX - start.clientX)),
        height: Math.max(MIN_PANEL_HEIGHT, Math.min(maxHeight, start.height + (e.clientY - start.clientY))),
      });
    };
    const onUp = () => {
      setResizing(false);
      resizeStartRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [resizing]);

  return (
    <Card
      role="dialog"
      aria-labelledby={`detail-panel-title-${title}`}
      className="flex flex-col rounded-md bg-card/95 border-border shadow-md gap-0 py-0 overflow-hidden select-none max-h-[80vh] relative"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 20,
        width: size.width,
        height: size.height,
        minWidth: MIN_PANEL_WIDTH,
        minHeight: MIN_PANEL_HEIGHT,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label="Drag to move panel"
        onPointerDown={handleTitleBarPointerDown}
        data-dragging={dragging}
        className="flex flex-row items-center min-h-8 px-2 py-1.5 border-b border-border shrink-0 gap-1 bg-muted/25 cursor-grab touch-none select-none data-[dragging=true]:cursor-grabbing"
      >
        <span
          id={`detail-panel-title-${title}`}
          className="text-xs font-medium text-muted-foreground flex-1 truncate"
        >
          {title}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-0.5 text-muted-foreground/70 hover:text-muted-foreground text-sm leading-none rounded cursor-pointer font-[inherit] shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>
      <div className="overflow-auto shrink min-h-0 flex flex-col">
        {children}
      </div>
      <div
        role="separator"
        aria-label="Resize panel"
        onPointerDown={handleResizePointerDown}
        data-resizing={resizing}
        className="absolute bottom-0 right-0 flex items-end justify-end p-0.5 cursor-se-resize touch-none text-muted-foreground/60 hover:text-muted-foreground"
      >
        <Icon path={mdiResizeBottomRight} size="14px" className="block" />
      </div>
    </Card>
  );
}
