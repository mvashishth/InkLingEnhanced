
"use client";

import React, {
  useRef,
  useEffect,
  useState,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';
import { cn } from '@/lib/utils';

interface Point {
  x: number;
  y: number;
}

interface SerializableImageData {
  width: number;
  height: number;
  data: string;
}
export interface AnnotationData {
  history: [number, SerializableImageData[]][];
  historyIndex: [number, number][];
}

export interface DrawingCanvasRef {
  exportAsDataURL: () => { dataUrl: string | undefined; pageNum: number } | undefined;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  initializePages: (numPages: number) => void;
  getAnnotationData: () => AnnotationData | undefined;
  getPageElement: (pageIndex: number) => HTMLDivElement | null;
  getScrollContainer: () => HTMLDivElement | null;
}

interface DrawingCanvasProps {
  pages: string[];
  tool: 'draw' | 'erase' | 'highlight' | 'snapshot' | 'inkling' | 'note' | null;
  penColor: string;
  penSize: number;
  eraserSize: number;
  highlighterSize: number;
  highlighterColor: string;
  onHistoryChange: (canUndo: boolean, canRedo: boolean) => void;
  initialAnnotations: AnnotationData | null;
  isProjectLoading: boolean;
  onProjectLoadComplete: () => void;
  toast: (options: { title: string; description: string; variant?: 'default' | 'destructive' }) => void;
  onSnapshot?: (imageDataUrl: string, pageIndex: number, rect: { x: number; y: number; width: number; height: number }) => void;
  onNoteCreate?: (rect: { x: number; y: number; width: number; height: number }) => void;
  onCanvasClick?: (pageIndex: number, point: Point, canvas: HTMLCanvasElement) => void;
}

interface PageProps {
  pageDataUrl: string;
  index: number;
  tool: DrawingCanvasProps['tool'];
  currentSelection: { pageIndex: number; startX: number; startY: number; endX: number; endY: number} | null;
  drawingCanvasRefs: React.MutableRefObject<(HTMLCanvasElement | null)[]>;
  contextRefs: React.MutableRefObject<(CanvasRenderingContext2D | null)[]>;
  pageContainerRef: React.RefObject<HTMLDivElement>;
  pageHistoryRef: React.MutableRefObject<Map<number, ImageData[]>>;
  pageHistoryIndexRef: React.MutableRefObject<Map<number, number>>;
  isProjectLoading: boolean;
  startDrawing: (e: React.MouseEvent | React.TouchEvent, pageIndex: number) => void;
  restoreState: (pageIndex: number, historyIndex: number) => void;
  saveState: (pageIndex: number) => void;
}

const Page = React.memo(({ 
  pageDataUrl, 
  index, 
  tool,
  currentSelection, 
  drawingCanvasRefs, 
  contextRefs,
  pageContainerRef,
  pageHistoryRef,
  pageHistoryIndexRef,
  isProjectLoading,
  startDrawing,
  restoreState,
  saveState,
}: PageProps) => {
    const imgRef = useRef<HTMLImageElement>(null);
    
    useEffect(() => {
        const drawingCanvas = drawingCanvasRefs.current[index];
        const image = imgRef.current;
        if (!drawingCanvas || !image) return;

        const context = drawingCanvas.getContext('2d', { willReadFrequently: true });
        if (!context) return;
        contextRefs.current[index] = context;
        
        const setCanvasSize = () => {
          if (image.naturalWidth > 0 && pageContainerRef.current) {
              const containerWidth = pageContainerRef.current.clientWidth;
              const scale = (containerWidth - 32) / image.naturalWidth; // 32 for padding
              const width = image.naturalWidth * scale;
              const height = image.naturalHeight * scale;

              drawingCanvas.width = width;
              drawingCanvas.height = height;
              
              const history = pageHistoryRef.current.get(index) ?? [];
              const historyIdx = pageHistoryIndexRef.current.get(index) ?? -1;

              if (history.length > 0 && historyIdx > -1 && history[historyIdx]) {
                restoreState(index, historyIdx);
              } else if (!isProjectLoading) {
                if (!pageHistoryRef.current.has(index)) {
                  pageHistoryRef.current.set(index, []);
                  pageHistoryIndexRef.current.set(index, -1);
                  saveState(index);
                }
              }
          }
        }

        if(image.complete) {
          setCanvasSize();
        } else {
          image.onload = setCanvasSize;
        }

        const resizeObserver = new ResizeObserver(setCanvasSize);
        if(pageContainerRef.current) {
            resizeObserver.observe(pageContainerRef.current);
        }
        return () => resizeObserver.disconnect();
        
    }, [index, restoreState, saveState, contextRefs, drawingCanvasRefs, pageContainerRef, pageHistoryRef, pageHistoryIndexRef, isProjectLoading]);

    return (
        <div className="relative shadow-lg my-4 mx-auto w-fit page-wrapper">
            <img ref={imgRef} src={pageDataUrl} alt={`Page ${index + 1}`} className="block pointer-events-none w-full h-auto max-w-[calc(100vw-2rem)] page-image" data-ai-hint="pdf page" />
            <canvas
                ref={(el) => (drawingCanvasRefs.current[index] = el)}
                onMouseDown={(e) => startDrawing(e, index)}
                onTouchStart={(e) => startDrawing(e, index)}
                className={cn(
                    "absolute inset-0",
                    !tool && 'pointer-events-none',
                    (tool === 'snapshot' || tool === 'inkling' || tool === 'note') && 'cursor-crosshair'
                )}
            />
            {currentSelection && currentSelection.pageIndex === index && (
              <div 
                  className="absolute border-2 border-dashed border-blue-500 bg-blue-500/20 pointer-events-none"
                  style={{
                      left: Math.min(currentSelection.startX, currentSelection.endX),
                      top: Math.min(currentSelection.startY, currentSelection.endY),
                      width: Math.abs(currentSelection.endX - currentSelection.startX),
                      height: Math.abs(currentSelection.endY - currentSelection.startY),
                  }}
              />
            )}
        </div>
    )
});
Page.displayName = 'Page';


export const DrawingCanvas = forwardRef<DrawingCanvasRef, DrawingCanvasProps>(
  ({ pages, tool, penColor, penSize, eraserSize, highlighterSize, highlighterColor, onHistoryChange, initialAnnotations, isProjectLoading, onProjectLoadComplete, toast, onSnapshot, onNoteCreate, onCanvasClick }, ref) => {
    const isDrawingRef = useRef(false);
    const hasMovedRef = useRef(false);

    const pageContainerRef = useRef<HTMLDivElement>(null);
    const drawingCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
    const contextRefs = useRef<(CanvasRenderingContext2D | null)[]>([]);
    
    const lastActivePageRef = useRef<number>(0);
    const pageHistoryRef = useRef(new Map<number, ImageData[]>());
    const pageHistoryIndexRef = useRef(new Map<number, number>());

    const preStrokeImageDataRef = useRef<ImageData | null>(null);
    const currentPathRef = useRef<Path2D | null>(null);
    const lastPointRef = useRef<Point | null>(null);

    const [selection, setSelection] = useState<{ pageIndex: number; startX: number; startY: number; endX: number; endY: number} | null>(null);


    useEffect(() => {
        drawingCanvasRefs.current = drawingCanvasRefs.current.slice(0, pages.length || 1);
        contextRefs.current = contextRefs.current.slice(0, pages.length || 1);
    }, [pages]);
    
    useEffect(() => {
        const container = pageContainerRef.current;
        if (container) {
            container.style.touchAction = tool ? 'none' : 'auto';
        }
    }, [tool]);

    const updateHistoryButtons = useCallback((page: number) => {
        const history = pageHistoryRef.current.get(page) ?? [];
        const index = pageHistoryIndexRef.current.get(page) ?? -1;
        onHistoryChange(index > 0, index < history.length - 1);
    }, [onHistoryChange]);

    const saveState = useCallback((pageIndex: number) => {
      const canvas = drawingCanvasRefs.current[pageIndex];
      const context = contextRefs.current[pageIndex];
      if (!canvas || !context || canvas.width === 0 || canvas.height === 0) return;

      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      
      const history = pageHistoryRef.current.get(pageIndex) ?? [];
      const currentIndex = pageHistoryIndexRef.current.get(pageIndex) ?? -1;

      const newHistory = history.slice(0, currentIndex + 1);
      newHistory.push(imageData);
      
      pageHistoryRef.current.set(pageIndex, newHistory);
      pageHistoryIndexRef.current.set(pageIndex, newHistory.length - 1);
    }, []);

    const restoreState = useCallback((pageIndex: number, historyIndex: number) => {
        const history = pageHistoryRef.current.get(pageIndex);
        const context = contextRefs.current[pageIndex];
        if (!context || !history || !history[historyIndex]) return;
        context.putImageData(history[historyIndex], 0, 0);
    }, []);

    useEffect(() => {
      if (initialAnnotations && isProjectLoading) {
        const base64ToUint8ClampedArray = (base64: string) => {
            const binary_string = window.atob(base64);
            const len = binary_string.length;
            const bytes = new Uint8ClampedArray(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binary_string.charCodeAt(i);
            }
            return bytes;
        }

        const newHistoryMap = new Map<number, ImageData[]>();
        const newHistoryIndexMap = new Map<number, number>();

        try {
            for (const [pageIndex, history] of initialAnnotations.history) {
                const newPageHistory = history.map(s_img => {
                    const dataArray = base64ToUint8ClampedArray(s_img.data);
                    return new ImageData(dataArray, s_img.width, s_img.height);
                });
                newHistoryMap.set(pageIndex, newPageHistory);
            }
            
            for (const [pageIndex, index] of initialAnnotations.historyIndex) {
                newHistoryIndexMap.set(pageIndex, index);
            }

            pageHistoryRef.current = newHistoryMap;
            pageHistoryIndexRef.current = newHistoryIndexMap;

            newHistoryMap.forEach((_, pageIndex) => {
                const historyIdx = newHistoryIndexMap.get(pageIndex);
                if (historyIdx !== undefined) {
                    restoreState(pageIndex, historyIdx);
                }
            });
            onProjectLoadComplete();

        } catch(e) {
            console.error("Failed to load annotations, file may be corrupt.", e);
            toast({
                title: "Error loading project",
                description: "The project file may be corrupt. Loading PDF without annotations.",
                variant: "destructive",
            });
            pageHistoryRef.current.clear();
            pageHistoryIndexRef.current.clear();
        }
      }
    }, [initialAnnotations, isProjectLoading, toast, restoreState, onProjectLoadComplete]);

    const getPoint = useCallback((e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent, canvasIndex: number): Point => {
      const canvas = drawingCanvasRefs.current[canvasIndex];
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const touch = 'touches' in e ? e.touches[0] : null;
      return {
        x: ((touch ? touch.clientX : e.clientX) - rect.left),
        y: ((touch ? touch.clientY : e.clientY) - rect.top),
      };
    }, []);

    const draw = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
      if (!isDrawingRef.current) return;
      if ('preventDefault' in e && e.cancelable) e.preventDefault();

      const pageIndex = lastActivePageRef.current;
      const point = getPoint(e, pageIndex);

      if((tool === 'snapshot' || tool === 'note') && selection){
        setSelection(prev => prev ? { ...prev, endX: point.x, endY: point.y } : null);
        return;
      }
      
      const context = contextRefs.current[pageIndex];
      if (!context || !lastPointRef.current) return;

      if (!hasMovedRef.current) {
        hasMovedRef.current = true;
      }
      
      if (tool === 'highlight' && preStrokeImageDataRef.current && currentPathRef.current) {
        context.putImageData(preStrokeImageDataRef.current, 0, 0);
        currentPathRef.current.lineTo(point.x, point.y);
        context.stroke(currentPathRef.current);
      } else {
        context.lineTo(point.x, point.y);
        context.stroke();
      }
      
      lastPointRef.current = point;
    };

    const stopDrawing = () => {
      if (!isDrawingRef.current) return;

      const pageIndex = lastActivePageRef.current;

      if(tool === 'snapshot' && selection) {
        const { pageIndex, startX, startY, endX, endY } = selection;
        const x = Math.min(startX, endX);
        const y = Math.min(startY, endY);
        const width = Math.abs(endX - startX);
        const height = Math.abs(endY - startY);

        if (width > 5 && height > 5 && onSnapshot) {
          const pageImageElement = pageContainerRef.current?.querySelectorAll('.page-image')[pageIndex] as HTMLImageElement;
          const drawingCanvas = drawingCanvasRefs.current[pageIndex];

          if (pageImageElement && drawingCanvas) {
            const { naturalWidth, naturalHeight } = pageImageElement;
            const { width: renderWidth, height: renderHeight } = pageImageElement.getBoundingClientRect();
            // Fallback to 1 to avoid division by zero if element is not rendered yet
            const scaleX = naturalWidth / (renderWidth || 1);
            const scaleY = naturalHeight / (renderHeight || 1);

            const snapshotWidth = width * scaleX;
            const snapshotHeight = height * scaleY;
            
            // Prevent creating empty or invalid canvas
            if (snapshotWidth > 0 && snapshotHeight > 0) {
              const tempCanvas = document.createElement('canvas');
              tempCanvas.width = snapshotWidth;
              tempCanvas.height = snapshotHeight;
              const tempCtx = tempCanvas.getContext('2d');

              if (tempCtx) {
                // Draw the high-resolution page content
                tempCtx.drawImage(
                  pageImageElement,
                  x * scaleX, y * scaleY, snapshotWidth, snapshotHeight,
                  0, 0, snapshotWidth, snapshotHeight
                );
                
                // Draw the annotations on top, scaled up
                tempCtx.drawImage(
                  drawingCanvas,
                  x, y, width, height,
                  0, 0, snapshotWidth, snapshotHeight
                );

                const dataUrl = tempCanvas.toDataURL('image/png');
                onSnapshot(dataUrl, pageIndex, { x, y, width, height });
              }
            }
          }
        }
        setSelection(null);
        isDrawingRef.current = false;
        return;
      }

      if (tool === 'note' && selection) {
        const { startX, startY, endX, endY } = selection;
        const x = Math.min(startX, endX);
        const y = Math.min(startY, endY);
        const width = Math.abs(endX - startX);
        const height = Math.abs(endY - startY);
        if (width > 20 && height > 20 && onNoteCreate) {
          onNoteCreate({ x, y, width, height });
        }
        setSelection(null);
        isDrawingRef.current = false;
        return;
      }
      
      const context = contextRefs.current[pageIndex];
      if (!context) return;
      
      if (!hasMovedRef.current && lastPointRef.current) {
        const point = lastPointRef.current;
        if (tool === 'highlight' && preStrokeImageDataRef.current) {
          context.putImageData(preStrokeImageDataRef.current, 0, 0);
        }

        const size = tool === 'draw' ? penSize : tool === 'highlight' ? highlighterSize : eraserSize;
        context.fillStyle = tool === 'highlight' ? highlighterColor : penColor;
        context.beginPath();
        context.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
        context.fill();
      }

      isDrawingRef.current = false;
      lastPointRef.current = null;
      preStrokeImageDataRef.current = null;
      currentPathRef.current = null;
      if (context.globalCompositeOperation !== 'source-over') {
        context.globalCompositeOperation = 'source-over';
      }
      context.globalAlpha = 1.0;
      saveState(pageIndex);
      updateHistoryButtons(pageIndex);
    };

    const stopDrawingRef = useRef(stopDrawing);
    stopDrawingRef.current = stopDrawing;

    useEffect(() => {
        const handleUp = () => {
            if (isDrawingRef.current) {
                stopDrawingRef.current();
            }
        };
        window.addEventListener('mouseup', handleUp);
        window.addEventListener('touchend', handleUp);
        return () => {
            window.removeEventListener('mouseup', handleUp);
            window.removeEventListener('touchend', handleUp);
        };
    }, []);

    const drawRef = useRef(draw);
    drawRef.current = draw;
    useEffect(() => {
        const handleMove = (e: MouseEvent | TouchEvent) => {
            if(isDrawingRef.current) {
                drawRef.current(e);
            }
        }
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('touchmove', handleMove, { passive: false });

        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('touchmove', handleMove);
        }
    }, []);

    const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent, pageIndex: number) => {
      if (!tool || ('button' in e && e.button !== 0)) return;

      if (tool === 'inkling') {
          if (onCanvasClick) {
              const point = getPoint(e, pageIndex);
              const canvas = drawingCanvasRefs.current[pageIndex];
              if (canvas) {
                onCanvasClick(pageIndex, point, canvas);
              }
          }
          return;
      }
      
      e.preventDefault();
      isDrawingRef.current = true;
      hasMovedRef.current = false;
      lastActivePageRef.current = pageIndex;
      const point = getPoint(e, pageIndex);
      
      if (tool === 'snapshot' || tool === 'note') {
        setSelection({ pageIndex, startX: point.x, startY: point.y, endX: point.x, endY: point.y });
        return;
      }
      
      const context = contextRefs.current[pageIndex];
      if (!context) return;
      lastPointRef.current = point;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      
      if (tool === 'draw') {
        context.strokeStyle = penColor;
        context.lineWidth = penSize;
        context.globalCompositeOperation = 'source-over';
        context.globalAlpha = 1.0;
      } else if (tool === 'erase') {
        context.lineWidth = eraserSize;
        context.globalCompositeOperation = 'destination-out';
      } else if (tool === 'highlight') {
        context.strokeStyle = highlighterColor;
        context.lineWidth = highlighterSize;
        context.globalCompositeOperation = 'source-over';
        context.globalAlpha = 0.2;
      }

      if (tool === 'highlight') {
        preStrokeImageDataRef.current = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
        currentPathRef.current = new Path2D();
        currentPathRef.current.moveTo(point.x, point.y);
      } else {
        context.beginPath();
        context.moveTo(point.x, point.y);
      }
    }, [tool, penColor, penSize, eraserSize, highlighterColor, highlighterSize, getPoint, onCanvasClick]);
    
    useImperativeHandle(ref, () => ({
      initializePages: (numPages: number) => {
        pageHistoryRef.current.clear();
        pageHistoryIndexRef.current.clear();
        for (let i = 0; i < numPages; i++) {
          // Initial blank state is saved when the Page component mounts and its canvas is sized
        }
      },
      exportAsDataURL: () => {
        const pageIndex = lastActivePageRef.current;
        const drawingCanvas = drawingCanvasRefs.current[pageIndex];
        if (!drawingCanvas) return;
        
        const pageImage = pageContainerRef.current?.querySelectorAll('.page-image')[pageIndex] as HTMLImageElement;
        
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = drawingCanvas.width;
        tempCanvas.height = drawingCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;

        if (pageImage) {
            tempCtx.drawImage(pageImage, 0, 0, tempCanvas.width, tempCanvas.height);
        } else {
            tempCtx.fillStyle = 'white';
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        }
        
        tempCtx.drawImage(drawingCanvas, 0, 0);

        return { 
          dataUrl: tempCanvas.toDataURL('image/png'),
          pageNum: pageIndex + 1
        };
      },
      clear: () => {
        contextRefs.current.forEach((context, index) => {
            if (context) {
              context.clearRect(0,0,context.canvas.width, context.canvas.height);
            }
        });
        
        pageHistoryRef.current.clear();
        pageHistoryIndexRef.current.clear();
        
        const activePage = lastActivePageRef.current;
        if (pages.length === 0) { // For pinup board
            if (!pageHistoryRef.current.has(0)) {
                pageHistoryRef.current.set(0, []);
                pageHistoryIndexRef.current.set(0, -1);
                saveState(0);
            }
        }
        updateHistoryButtons(activePage);
      },
      undo: () => {
        const page = lastActivePageRef.current;
        const index = pageHistoryIndexRef.current.get(page) ?? -1;
        if (index > 0) {
          const newIndex = index - 1;
          pageHistoryIndexRef.current.set(page, newIndex);
          restoreState(page, newIndex);
          updateHistoryButtons(page);
          preStrokeImageDataRef.current = null;
          currentPathRef.current = null;
        }
      },
      redo: () => {
        const page = lastActivePageRef.current;
        const history = pageHistoryRef.current.get(page) ?? [];
        const index = pageHistoryIndexRef.current.get(page) ?? -1;
        if (index < history.length - 1) {
          const newIndex = index + 1;
          pageHistoryIndexRef.current.set(page, newIndex);
          restoreState(page, newIndex);
          updateHistoryButtons(page);
          preStrokeImageDataRef.current = null;
          currentPathRef.current = null;
        }
      },
      getAnnotationData: () => {
        if (pageHistoryRef.current.size === 0) return undefined;

        const uint8ClampedArrayToBase64 = (arr: Uint8ClampedArray) => {
            const CHUNK_SIZE = 0x8000;
            let result = '';
            for (let i = 0; i < arr.length; i += CHUNK_SIZE) {
                const chunk = arr.subarray(i, i + CHUNK_SIZE);
                result += String.fromCharCode.apply(null, chunk as unknown as number[]);
            }
            return btoa(result);
        }

        const serializedHistory: [number, SerializableImageData[]][] = [];
        for (const [pageIndex, history] of pageHistoryRef.current.entries()) {
            if (history.length > 0) {
              const pageHistory = history.map(imageData => ({
                  width: imageData.width,
                  height: imageData.height,
                  data: uint8ClampedArrayToBase64(imageData.data),
              }));
              serializedHistory.push([pageIndex, pageHistory]);
            }
        }

        const serializedHistoryIndex = Array.from(pageHistoryIndexRef.current.entries());

        return {
            history: serializedHistory,
            historyIndex: serializedHistoryIndex,
        };
      },
      getPageElement: (pageIndex: number) => {
        const pageWrapper = pageContainerRef.current?.querySelectorAll('.page-wrapper')[pageIndex];
        return pageWrapper as HTMLDivElement | null;
      },
      getScrollContainer: () => pageContainerRef.current,
    }));

    useEffect(() => {
      if (pages.length === 0) { // Logic for the pinup board canvas
        const canvas = drawingCanvasRefs.current[0];
        const context = canvas?.getContext('2d', { willReadFrequently: true });
        const container = pageContainerRef.current;
        if(canvas && context && container) {
            contextRefs.current[0] = context;
            const resize = () => {
                const { width, height } = container.getBoundingClientRect();
                canvas.width = width;
                canvas.height = height;
                
                const history = pageHistoryRef.current.get(0) ?? [];
                const historyIdx = pageHistoryIndexRef.current.get(0) ?? -1;

                if (history.length > 0 && historyIdx > -1 && history[historyIdx]) {
                  restoreState(0, historyIdx);
                } else if (!isProjectLoading) {
                  if (!pageHistoryRef.current.has(0)) {
                    pageHistoryRef.current.set(0, []);
                    pageHistoryIndexRef.current.set(0, -1);
                    saveState(0);
                    updateHistoryButtons(0);
                  }
                }
            }
            const resizeObserver = new ResizeObserver(resize);
            resizeObserver.observe(container);
            resize();
            return () => resizeObserver.disconnect();
        }
      }
    }, [pages.length, saveState, restoreState, updateHistoryButtons, isProjectLoading]);

    if (pages.length === 0) {
        return (
          <div
            ref={pageContainerRef}
            className="w-full h-full"
          >
            <div className="relative w-full h-full">
              <canvas
                ref={el => { if(el) drawingCanvasRefs.current[0] = el}}
                onMouseDown={(e) => startDrawing(e, 0)}
                onTouchStart={(e) => startDrawing(e, 0)}
                className={cn(
                  'w-full h-full',
                  !tool && 'pointer-events-none',
                  tool === 'note' && 'cursor-crosshair'
                )}
                data-ai-hint="drawing layer"
              />
               {selection && (
                <div 
                    className="absolute border-2 border-dashed border-blue-500 bg-blue-500/20 pointer-events-none"
                    style={{
                        left: Math.min(selection.startX, selection.endX),
                        top: Math.min(selection.startY, selection.endY),
                        width: Math.abs(selection.endX - selection.startX),
                        height: Math.abs(selection.endY - selection.startY),
                    }}
                />
              )}
            </div>
          </div>
        )
    }

    return (
      <div 
        ref={pageContainerRef}
        className="w-full h-full overflow-y-auto bg-muted/20 p-4"
      >
        <div className="max-w-5xl mx-auto">
            {pages.map((pageDataUrl, index) => (
                <Page 
                  key={index} 
                  pageDataUrl={pageDataUrl} 
                  index={index} 
                  tool={tool}
                  currentSelection={selection}
                  drawingCanvasRefs={drawingCanvasRefs}
                  contextRefs={contextRefs}
                  pageContainerRef={pageContainerRef}
                  pageHistoryRef={pageHistoryRef}
                  pageHistoryIndexRef={pageHistoryIndexRef}
                  isProjectLoading={isProjectLoading}
                  startDrawing={startDrawing}
                  restoreState={restoreState}
                  saveState={saveState}
                />
            ))}
        </div>
      </div>
    );
  }
);

DrawingCanvas.displayName = 'DrawingCanvas';
