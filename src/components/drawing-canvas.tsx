
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
import { type Snapshot } from './snapshot-item';
import type { PDFDocumentProxy } from 'pdfjs-dist';

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
  onSnapshot?: (imageDataUrl: string, pageIndex: number, rect: { relX: number; relY: number; relWidth: number; relHeight: number }, aspectRatio: number) => void;
  onNoteCreate?: (rect: { x: number; y: number; width: number; height: number }) => void;
  onCanvasClick?: (pageIndex: number, point: Point, canvas: HTMLCanvasElement) => void;
  snapshotHighlights?: Snapshot[];
  pdfDoc: PDFDocumentProxy | null;
}

interface PageProps {
  pageDataUrl: string;
  index: number;
  tool: DrawingCanvasProps['tool'];
  currentSelection: { pageIndex: number; startX: number; startY: number; endX: number; endY: number} | null;
  displayCanvasRefs: React.MutableRefObject<(HTMLCanvasElement | null)[]>;
  pageContainerRef: React.RefObject<HTMLDivElement>;
  isProjectLoading: boolean;
  startDrawing: (e: React.MouseEvent | React.TouchEvent, pageIndex: number) => void;
  setupCanvases: (img: HTMLImageElement, index: number) => void;
  snapshotHighlights?: Snapshot[];
}

const Page = React.memo(({ 
  pageDataUrl, 
  index, 
  tool,
  currentSelection, 
  displayCanvasRefs, 
  pageContainerRef,
  isProjectLoading,
  startDrawing,
  setupCanvases,
  snapshotHighlights,
}: PageProps) => {
    const imgRef = useRef<HTMLImageElement>(null);
    
    useEffect(() => {
        const image = imgRef.current;
        if (!image) return;

        const setCanvasSize = () => {
          if (image.naturalWidth > 0 && pageContainerRef.current) {
            setupCanvases(image, index);
          }
        }

        if(image.complete && image.naturalWidth > 0) {
          setCanvasSize();
        } else {
          image.onload = setCanvasSize;
        }

        const resizeObserver = new ResizeObserver(setCanvasSize);
        if(pageContainerRef.current) {
            resizeObserver.observe(pageContainerRef.current);
        }
        return () => resizeObserver.disconnect();
        
    }, [index, setupCanvases, pageContainerRef, pageDataUrl]);

    return (
        <div className="relative shadow-lg my-4 mx-auto w-fit page-wrapper">
            <img ref={imgRef} src={pageDataUrl} alt={`Page ${index + 1}`} className="block pointer-events-none w-full h-auto max-w-[calc(100vw-2rem)] page-image" data-ai-hint="pdf page" />
            <canvas
                ref={(el) => (displayCanvasRefs.current[index] = el)}
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
            {snapshotHighlights
              ?.filter(h => h.sourcePage === index && h.highlightColor)
              .map(highlight => {
                const canvas = displayCanvasRefs.current[highlight.sourcePage];
                if (!canvas) return null;
                const { width: canvasWidth, height: canvasHeight } = canvas;
                const { relX, relY, relWidth, relHeight } = highlight.sourceRelRect;

                return (
                  <div
                    key={`highlight-${highlight.id}`}
                    className="absolute pointer-events-none rounded-sm"
                    style={{
                      left: relX * canvasWidth,
                      top: relY * canvasHeight,
                      width: relWidth * canvasWidth,
                      height: relHeight * canvasHeight,
                      backgroundColor: `${highlight.highlightColor}4D`,
                      border: `2px solid ${highlight.highlightColor}`,
                    }}
                  />
                )
            })}
        </div>
    )
});
Page.displayName = 'Page';


export const DrawingCanvas = forwardRef<DrawingCanvasRef, DrawingCanvasProps>(
  ({ pages, tool, penColor, penSize, eraserSize, highlighterSize, highlighterColor, onHistoryChange, initialAnnotations, isProjectLoading, onProjectLoadComplete, toast, onSnapshot, onNoteCreate, onCanvasClick, snapshotHighlights, pdfDoc }, ref) => {
    const isDrawingRef = useRef(false);
    const hasMovedRef = useRef(false);

    const pageContainerRef = useRef<HTMLDivElement>(null);
    const displayCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
    const masterCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
    const masterContextRefs = useRef<(CanvasRenderingContext2D | null)[]>([]);
    
    const lastActivePageRef = useRef<number>(0);
    const pageHistoryRef = useRef(new Map<number, ImageData[]>());
    const pageHistoryIndexRef = useRef(new Map<number, number>());

    const preStrokeImageDataRef = useRef<ImageData | null>(null);
    const currentPathRef = useRef<Path2D | null>(null);
    const lastPointRef = useRef<Point | null>(null);

    const [selection, setSelection] = useState<{ pageIndex: number; startX: number; startY: number; endX: number; endY: number} | null>(null);


    useEffect(() => {
        const len = pages.length || 1;
        displayCanvasRefs.current = displayCanvasRefs.current.slice(0, len);
        masterCanvasRefs.current = masterCanvasRefs.current.slice(0, len);
        masterContextRefs.current = masterContextRefs.current.slice(0, len);
    }, [pages]);
    
    useEffect(() => {
        const container = pageContainerRef.current;
        if (container) {
            container.style.touchAction = tool ? 'none' : 'auto';
        }
    }, [tool]);

    const updateDisplayCanvas = useCallback((pageIndex: number) => {
        const masterCanvas = masterCanvasRefs.current[pageIndex];
        const displayCanvas = displayCanvasRefs.current[pageIndex];
        if (!masterCanvas || !displayCanvas) return;

        const displayCtx = displayCanvas.getContext('2d');
        if (!displayCtx) return;

        displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
        displayCtx.drawImage(masterCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
    }, []);

    const updateHistoryButtons = useCallback((page: number) => {
        const history = pageHistoryRef.current.get(page) ?? [];
        const index = pageHistoryIndexRef.current.get(page) ?? -1;
        onHistoryChange(index > 0, index < history.length - 1);
    }, [onHistoryChange]);

    const saveState = useCallback((pageIndex: number) => {
      const masterCanvas = masterCanvasRefs.current[pageIndex];
      const context = masterContextRefs.current[pageIndex];
      if (!masterCanvas || !context) return;

      const imageData = context.getImageData(0, 0, masterCanvas.width, masterCanvas.height);
      
      const history = pageHistoryRef.current.get(pageIndex) ?? [];
      const currentIndex = pageHistoryIndexRef.current.get(pageIndex) ?? -1;

      const newHistory = history.slice(0, currentIndex + 1);
      newHistory.push(imageData);
      
      pageHistoryRef.current.set(pageIndex, newHistory);
      pageHistoryIndexRef.current.set(pageIndex, newHistory.length - 1);
    }, []);

    const restoreState = useCallback((pageIndex: number, historyIndex: number) => {
        const history = pageHistoryRef.current.get(pageIndex);
        const context = masterContextRefs.current[pageIndex];
        if (!context || !history || !history[historyIndex]) return;
        context.putImageData(history[historyIndex], 0, 0);
        updateDisplayCanvas(pageIndex);
    }, [updateDisplayCanvas]);

    const setupCanvases = useCallback((imageOrContainer: HTMLImageElement | HTMLDivElement, index: number) => {
        const isImage = imageOrContainer instanceof HTMLImageElement;
        const displayCanvas = displayCanvasRefs.current[index];
        if (!displayCanvas) return;
        
        let displayWidth, displayHeight;
        if (isImage) {
            const pageContainer = pageContainerRef.current;
            if (!pageContainer) return;
            const containerWidth = pageContainer.clientWidth;
            const scale = (containerWidth - 32) / imageOrContainer.naturalWidth;
            displayWidth = imageOrContainer.naturalWidth * scale;
            displayHeight = imageOrContainer.naturalHeight * scale;
        } else {
            const { width, height } = imageOrContainer.getBoundingClientRect();
            displayWidth = width;
            displayHeight = height;
        }
        
        displayCanvas.width = displayWidth;
        displayCanvas.height = displayHeight;

        const masterCanvas = masterCanvasRefs.current[index] || document.createElement('canvas');
        masterCanvasRefs.current[index] = masterCanvas;
        
        const masterWidth = isImage ? imageOrContainer.naturalWidth : displayWidth;
        const masterHeight = isImage ? imageOrContainer.naturalHeight : displayHeight;
        masterCanvas.width = masterWidth;
        masterCanvas.height = masterHeight;

        const masterContext = masterCanvas.getContext('2d', { willReadFrequently: true });
        if (!masterContext) return;
        masterContextRefs.current[index] = masterContext;

        const history = pageHistoryRef.current.get(index) ?? [];
        const historyIdx = pageHistoryIndexRef.current.get(index) ?? -1;

        if (history.length > 0 && historyIdx > -1) {
            restoreState(index, historyIdx);
        } else if (!isProjectLoading) {
            if (!pageHistoryRef.current.has(index)) {
                masterContext.clearRect(0, 0, masterCanvas.width, masterCanvas.height);
                const blankState = masterContext.getImageData(0, 0, masterCanvas.width, masterCanvas.height);
                pageHistoryRef.current.set(index, [blankState]);
                pageHistoryIndexRef.current.set(index, 0);
            } else {
                masterContext.clearRect(0, 0, masterCanvas.width, masterCanvas.height);
                saveState(index);
            }
        }
        updateHistoryButtons(index);
    }, [restoreState, saveState, isProjectLoading, updateHistoryButtons]);


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

            masterCanvasRefs.current.forEach((canvas, pageIndex) => {
                if (canvas) {
                    const historyIdx = pageHistoryIndexRef.current.get(pageIndex) ?? -1;
                    if (historyIdx > -1) {
                         restoreState(pageIndex, historyIdx);
                    } else {
                        const context = masterContextRefs.current[pageIndex];
                        if (context) {
                            context.clearRect(0, 0, canvas.width, canvas.height);
                            const blankState = context.getImageData(0, 0, canvas.width, canvas.height);
                            pageHistoryRef.current.set(pageIndex, [blankState]);
                            pageHistoryIndexRef.current.set(pageIndex, 0);
                            updateDisplayCanvas(pageIndex);
                        }
                    }
                    updateHistoryButtons(pageIndex);
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
    }, [initialAnnotations, isProjectLoading, restoreState, toast, onProjectLoadComplete, updateHistoryButtons, updateDisplayCanvas]);

    const getPoint = useCallback((e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent, canvasIndex: number): Point => {
      const canvas = displayCanvasRefs.current[canvasIndex];
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
      
      const masterContext = masterContextRefs.current[pageIndex];
      const masterCanvas = masterCanvasRefs.current[pageIndex];
      const displayCanvas = displayCanvasRefs.current[pageIndex];

      if (!masterContext || !lastPointRef.current || !masterCanvas || !displayCanvas) return;
      
      const scaleX = masterCanvas.width / displayCanvas.width;
      const scaleY = masterCanvas.height / displayCanvas.height;

      const scaledPoint = { x: point.x * scaleX, y: point.y * scaleY };

      if (!hasMovedRef.current) {
        hasMovedRef.current = true;
      }
      
      if (tool === 'highlight' && preStrokeImageDataRef.current && currentPathRef.current) {
        masterContext.putImageData(preStrokeImageDataRef.current, 0, 0);
        currentPathRef.current.lineTo(scaledPoint.x, scaledPoint.y);
        masterContext.stroke(currentPathRef.current);
      } else {
        masterContext.lineTo(scaledPoint.x, scaledPoint.y);
        masterContext.stroke();
      }
      
      updateDisplayCanvas(pageIndex);
      lastPointRef.current = point;
    };

    const stopDrawing = async () => {
      if (!isDrawingRef.current) return;

      const pageIndex = lastActivePageRef.current;

      if (tool === 'snapshot' && selection) {
        const { pageIndex, startX, startY, endX, endY } = selection;
        const x = Math.min(startX, endX);
        const y = Math.min(startY, endY);
        const width = Math.abs(endX - startX);
        const height = Math.abs(endY - startY);

        if (width > 5 && height > 5 && onSnapshot && pdfDoc) {
          try {
            const page = await pdfDoc.getPage(pageIndex + 1);
            const displayCanvas = displayCanvasRefs.current[pageIndex];
            if (!displayCanvas) {
              setSelection(null);
              isDrawingRef.current = false;
              return;
            }

            const snapshotScale = 2.0;
            const viewport = page.getViewport({ scale: snapshotScale });
            const { width: renderWidth, height: renderHeight } = displayCanvas;
            const cropWidth = width * (viewport.width / renderWidth);
            const cropHeight = height * (viewport.height / renderHeight);

            if (cropWidth <= 0 || cropHeight <= 0) {
                setSelection(null);
                isDrawingRef.current = false;
                return;
            }

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = cropWidth;
            tempCanvas.height = cropHeight;
            const tempCtx = tempCanvas.getContext('2d');

            if (tempCtx) {
              const cropX = x * (viewport.width / renderWidth);
              const cropY = y * (viewport.height / renderHeight);
              
              tempCtx.save();
              tempCtx.fillStyle = 'white';
              tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
              tempCtx.translate(-cropX, -cropY);
              await page.render({ canvasContext: tempCtx, viewport: viewport }).promise;
              tempCtx.restore();
              
              const masterCanvas = masterCanvasRefs.current[pageIndex];
              if (masterCanvas) {
                  const masterViewport = page.getViewport({ scale: 1.0 });
                  const sx = x * (masterViewport.width / renderWidth);
                  const sy = y * (masterViewport.height / renderHeight);
                  const sWidth = width * (masterViewport.width / renderWidth);
                  const sHeight = height * (masterViewport.height / renderHeight);

                  tempCtx.drawImage(
                      masterCanvas,
                      sx, sy, sWidth, sHeight,
                      0, 0, cropWidth, cropHeight
                  );
              }

              const dataUrl = tempCanvas.toDataURL('image/png');
              const aspectRatio = cropWidth > 0 ? cropHeight / cropWidth : 1;
              const sourceRelRect = {
                relX: x / renderWidth,
                relY: y / renderHeight,
                relWidth: width / renderWidth,
                relHeight: height / renderHeight,
              };

              onSnapshot(dataUrl, pageIndex, sourceRelRect, aspectRatio);
            }
          } catch (error) {
            console.error("Failed to create snapshot:", error);
            toast({
              title: "Snapshot Failed",
              description: "Could not create the snapshot. Please try again.",
              variant: "destructive",
            });
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
      
      const masterContext = masterContextRefs.current[pageIndex];
      const masterCanvas = masterCanvasRefs.current[pageIndex];
      const displayCanvas = displayCanvasRefs.current[pageIndex];
      if (!masterContext || !masterCanvas || !displayCanvas) return;
      
      const scaleX = masterCanvas.width / displayCanvas.width;
      
      if (!hasMovedRef.current && lastPointRef.current) {
        const point = lastPointRef.current;
        const scaledPoint = { x: point.x * scaleX, y: point.y * scaleX };

        if (tool === 'highlight' && preStrokeImageDataRef.current) {
          masterContext.putImageData(preStrokeImageDataRef.current, 0, 0);
        }

        const size = (tool === 'draw' ? penSize : tool === 'highlight' ? highlighterSize : eraserSize) * scaleX;
        masterContext.fillStyle = tool === 'highlight' ? highlighterColor : penColor;
        masterContext.beginPath();
        masterContext.arc(scaledPoint.x, scaledPoint.y, size / 2, 0, Math.PI * 2);
        masterContext.fill();
        updateDisplayCanvas(pageIndex);
      }

      isDrawingRef.current = false;
      lastPointRef.current = null;
      preStrokeImageDataRef.current = null;
      currentPathRef.current = null;
      if (masterContext.globalCompositeOperation !== 'source-over') {
        masterContext.globalCompositeOperation = 'source-over';
      }
      masterContext.globalAlpha = 1.0;
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
              const canvas = displayCanvasRefs.current[pageIndex];
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
      lastPointRef.current = point;
      
      if (tool === 'snapshot' || tool === 'note') {
        setSelection({ pageIndex, startX: point.x, startY: point.y, endX: point.x, endY: point.y });
        return;
      }
      
      const masterContext = masterContextRefs.current[pageIndex];
      const masterCanvas = masterCanvasRefs.current[pageIndex];
      const displayCanvas = displayCanvasRefs.current[pageIndex];
      if (!masterContext || !masterCanvas || !displayCanvas) return;

      const scale = masterCanvas.width / displayCanvas.width;
      const scaledPoint = { x: point.x * scale, y: point.y * scale };
      
      masterContext.lineCap = 'round';
      masterContext.lineJoin = 'round';
      
      if (tool === 'draw') {
        masterContext.strokeStyle = penColor;
        masterContext.lineWidth = penSize * scale;
        masterContext.globalCompositeOperation = 'source-over';
        masterContext.globalAlpha = 1.0;
      } else if (tool === 'erase') {
        masterContext.lineWidth = eraserSize * scale;
        masterContext.globalCompositeOperation = 'destination-out';
      } else if (tool === 'highlight') {
        masterContext.strokeStyle = highlighterColor;
        masterContext.lineWidth = highlighterSize * scale;
        masterContext.globalCompositeOperation = 'source-over';
        masterContext.globalAlpha = 0.2;
      }

      if (tool === 'highlight') {
        preStrokeImageDataRef.current = masterContext.getImageData(0, 0, masterCanvas.width, masterCanvas.height);
        currentPathRef.current = new Path2D();
        currentPathRef.current.moveTo(scaledPoint.x, scaledPoint.y);
      } else {
        masterContext.beginPath();
        masterContext.moveTo(scaledPoint.x, scaledPoint.y);
      }
    }, [tool, penColor, penSize, eraserSize, highlighterColor, highlighterSize, getPoint, onCanvasClick]);
    
    useImperativeHandle(ref, () => ({
      initializePages: (numPages: number) => {
        pageHistoryRef.current.clear();
        pageHistoryIndexRef.current.clear();
        for (let i = 0; i < numPages; i++) {
          pageHistoryRef.current.set(i, []);
          pageHistoryIndexRef.current.set(i, -1);
        }
      },
      exportAsDataURL: () => {
        const pageIndex = lastActivePageRef.current;
        const displayCanvas = displayCanvasRefs.current[pageIndex];
        const masterCanvas = masterCanvasRefs.current[pageIndex];
        if (!displayCanvas || !masterCanvas) return;
        
        const pageImage = pageContainerRef.current?.querySelectorAll('.page-image')[pageIndex] as HTMLImageElement;
        
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = displayCanvas.width;
        tempCanvas.height = displayCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;

        if (pageImage) {
            tempCtx.drawImage(pageImage, 0, 0, tempCanvas.width, tempCanvas.height);
        } else {
            tempCtx.fillStyle = 'white';
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        }
        
        tempCtx.drawImage(masterCanvas, 0, 0, tempCanvas.width, tempCanvas.height);

        return { 
          dataUrl: tempCanvas.toDataURL('image/png'),
          pageNum: pageIndex + 1
        };
      },
      clear: () => {
        const activePage = lastActivePageRef.current;
        
        const clearAndReset = (index: number) => {
          const masterContext = masterContextRefs.current[index];
          const masterCanvas = masterCanvasRefs.current[index];
          if (masterContext && masterCanvas) {
              masterContext.clearRect(0, 0, masterCanvas.width, masterCanvas.height);
              
              const blankState = masterContext.getImageData(0, 0, masterCanvas.width, masterCanvas.height);
              pageHistoryRef.current.set(index, [blankState]);
              pageHistoryIndexRef.current.set(index, 0);
              
              updateDisplayCanvas(index);
          }
        };

        if (pages.length === 0) {
            clearAndReset(0);
        } else {
            masterContextRefs.current.forEach((context, index) => {
              if (context) {
                clearAndReset(index);
              }
            });
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
        const newHistoryIndex: [number, number][] = [];

        for (const [pageIndex, history] of pageHistoryRef.current.entries()) {
            const currentHistoryIndex = pageHistoryIndexRef.current.get(pageIndex);
            
            if (history.length > 0 && currentHistoryIndex !== undefined && currentHistoryIndex > 0) {
              const validHistory = history.slice(0, currentHistoryIndex + 1);

              const pageHistory = validHistory.map(imageData => ({
                  width: imageData.width,
                  height: imageData.height,
                  data: uint8ClampedArrayToBase64(imageData.data),
              }));
              
              serializedHistory.push([pageIndex, pageHistory]);
              newHistoryIndex.push([pageIndex, validHistory.length - 1]);
            }
        }
        
        if (serializedHistory.length === 0) return undefined;

        return {
            history: serializedHistory,
            historyIndex: newHistoryIndex,
        };
      },
      getPageElement: (pageIndex: number) => {
        const pageWrapper = pageContainerRef.current?.querySelectorAll('.page-wrapper')[pageIndex];
        return pageWrapper as HTMLDivElement | null;
      },
      getScrollContainer: () => pageContainerRef.current,
    }));

    useEffect(() => {
      if (pages.length === 0) {
        const container = pageContainerRef.current;
        if(container) {
            const resize = () => setupCanvases(container, 0);
            const resizeObserver = new ResizeObserver(resize);
            resizeObserver.observe(container);
            resize();
            return () => resizeObserver.disconnect();
        }
      }
    }, [pages.length, setupCanvases]);

    if (pages.length === 0) {
        return (
          <div
            ref={pageContainerRef}
            className="w-full h-full"
            onMouseDownCapture={() => lastActivePageRef.current = 0}
          >
            <div className="relative w-full h-full">
              <canvas
                ref={el => { if(el) displayCanvasRefs.current[0] = el}}
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
        onMouseDownCapture={() => {
            if (pageContainerRef.current) {
                const pageElements = pageContainerRef.current.querySelectorAll('.page-wrapper');
                let bestVisiblePage = 0;
                let maxVisibleHeight = 0;

                pageElements.forEach((el, index) => {
                    const rect = el.getBoundingClientRect();
                    const containerRect = pageContainerRef.current!.getBoundingClientRect();
                    const visibleTop = Math.max(rect.top, containerRect.top);
                    const visibleBottom = Math.min(rect.bottom, containerRect.bottom);
                    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
                    
                    if (visibleHeight > maxVisibleHeight) {
                        maxVisibleHeight = visibleHeight;
                        bestVisiblePage = index;
                    }
                });
                lastActivePageRef.current = bestVisiblePage;
                updateHistoryButtons(bestVisiblePage);
            }
        }}
      >
        <div className="max-w-5xl mx-auto">
            {pages.map((pageDataUrl, index) => (
                <Page 
                  key={index} 
                  pageDataUrl={pageDataUrl} 
                  index={index} 
                  tool={tool}
                  currentSelection={selection}
                  displayCanvasRefs={displayCanvasRefs}
                  pageContainerRef={pageContainerRef}
                  isProjectLoading={isProjectLoading}
                  startDrawing={startDrawing}
                  setupCanvases={setupCanvases}
                  snapshotHighlights={snapshotHighlights}
                />
            ))}
        </div>
      </div>
    );
  }
);

DrawingCanvas.displayName = 'DrawingCanvas';
