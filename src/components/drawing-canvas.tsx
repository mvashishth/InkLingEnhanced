
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

interface Path {
  tool: 'draw' | 'erase' | 'highlight';
  color: string;
  size: number;
  points: Point[];
  compositeOperation: GlobalCompositeOperation;
  globalAlpha: number;
}

export interface AnnotationData {
  history: [number, Path[][]][];
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
  onSnapshot?: (imageDataUrl: string, pageIndex: number, rect: { relX: number; relY: number; relWidth: number; relHeight: number }, aspectRatio: number, initialY: number) => void;
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
                const { relX, relY, relWidth, relHeight } = highlight.sourceRelRect;

                return (
                  <div
                    key={`highlight-${highlight.id}`}
                    className="absolute pointer-events-none rounded-sm"
                    style={{
                      left: `${relX * 100}%`,
                      top: `${relY * 100}%`,
                      width: `${relWidth * 100}%`,
                      height: `${relHeight * 100}%`,
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
    
    const lastActivePageRef = useRef<number>(0);

    const pageHistoryRef = useRef(new Map<number, Path[][]>());
    const pageHistoryIndexRef = useRef(new Map<number, number>());
    
    const currentPathRef = useRef<Path | null>(null);

    const [selection, setSelection] = useState<{ pageIndex: number; startX: number; startY: number; endX: number; endY: number} | null>(null);

    useEffect(() => {
        const len = pages.length || 1;
        displayCanvasRefs.current = displayCanvasRefs.current.slice(0, len);
    }, [pages]);
    
    useEffect(() => {
        const container = pageContainerRef.current;
        if (container) {
            container.style.touchAction = tool ? 'none' : 'auto';
        }
    }, [tool]);

    const getPathAsSVG = useCallback((path: Path): Path2D => {
        const p = new Path2D();
        if (path.points.length === 0) return p;

        let points = path.points;

        if (points.length < 2) {
            if (points.length === 1) p.rect(points[0].x - 0.5, points[0].y - 0.5, 1, 1);
            return p;
        }
        
        p.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length - 1; i++) {
            const c = (points[i].x + points[i+1].x) / 2;
            const d = (points[i].y + points[i+1].y) / 2;
            p.quadraticCurveTo(points[i].x, points[i].y, c, d);
        }
        p.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        return p;
    }, []);
    
    const renderPaths = useCallback((context: CanvasRenderingContext2D, paths: Path[]) => {
      const { width, height } = context.canvas;
      if (width === 0 || height === 0) return;

      paths.forEach(path => {
        const absolutePoints = path.points.map(p => ({ x: p.x * width, y: p.y * height }));
        const absoluteSize = path.size * width;

        context.strokeStyle = path.color;
        context.lineWidth = absoluteSize;
        context.globalCompositeOperation = path.compositeOperation;
        context.globalAlpha = path.globalAlpha;
        context.lineCap = 'round';
        context.lineJoin = 'round';
    
        const absolutePath: Path = { ...path, points: absolutePoints };
        const p = getPathAsSVG(absolutePath);
        context.stroke(p);
      });

      context.globalCompositeOperation = 'source-over';
      context.globalAlpha = 1.0;
    }, [getPathAsSVG]);

    const redrawCanvas = useCallback((pageIndex: number) => {
      const canvas = displayCanvasRefs.current[pageIndex];
      if (!canvas) {
        return;
      }

      const context = canvas.getContext('2d');
      if (!context) return;
  
      context.clearRect(0, 0, canvas.width, canvas.height);
  
      const historyStack = pageHistoryRef.current.get(pageIndex);
      const historyIdx = pageHistoryIndexRef.current.get(pageIndex);
  
      if (historyStack && historyIdx !== undefined && historyIdx > -1) {
        const pathsToDraw = historyStack[historyIdx];
        if (pathsToDraw) {
            renderPaths(context, pathsToDraw);
        }
      }
    }, [renderPaths]);

    const updateHistoryButtons = useCallback((page: number) => {
        const history = pageHistoryRef.current.get(page) ?? [];
        const index = pageHistoryIndexRef.current.get(page) ?? -1;
        onHistoryChange(index > 0, index < history.length - 1);
    }, [onHistoryChange]);

    const commitHistory = useCallback((pageIndex: number, newPath: Path) => {
        const canvas = displayCanvasRefs.current[pageIndex];
        if (!canvas || canvas.width === 0) return;

        const { width, height } = canvas;
        const relativePath: Path = {
            ...newPath,
            points: newPath.points.map(p => ({ x: p.x / width, y: p.y / height })),
            size: newPath.size / width,
        };

        const historyStack = pageHistoryRef.current.get(pageIndex) ?? [];
        const currentIndex = pageHistoryIndexRef.current.get(pageIndex) ?? -1;
    
        const currentPaths = historyStack[currentIndex] ?? [];
        const newPaths = [...currentPaths, relativePath];
    
        const newHistoryStack = historyStack.slice(0, currentIndex + 1);
        newHistoryStack.push(newPaths);
    
        pageHistoryRef.current.set(pageIndex, newHistoryStack);
        pageHistoryIndexRef.current.set(pageIndex, newHistoryStack.length - 1);
    }, []);

    const setupCanvases = useCallback((container: HTMLDivElement | HTMLImageElement, index: number) => {
        const displayCanvas = displayCanvasRefs.current[index];
        if (!displayCanvas) return;
        
        const { width, height } = container.getBoundingClientRect();
        
        displayCanvas.width = width;
        displayCanvas.height = height;

        if (!pageHistoryRef.current.has(index)) {
            pageHistoryRef.current.set(index, [[]]);
            pageHistoryIndexRef.current.set(index, 0);
        }
        
        redrawCanvas(index);
        updateHistoryButtons(index);
    }, [redrawCanvas, updateHistoryButtons]);


    useEffect(() => {
      if (initialAnnotations && isProjectLoading) {
        if (!initialAnnotations.history || !initialAnnotations.historyIndex) {
            onProjectLoadComplete();
            return;
        }
        try {
            const pageHistoryMap = new Map(initialAnnotations.history);
            const pageHistoryIndexMap = new Map(initialAnnotations.historyIndex);

            pageHistoryRef.current = pageHistoryMap;
            pageHistoryIndexRef.current = pageHistoryIndexMap;

            const restorePromises = Array.from(pageHistoryMap.keys()).map(async (pageIndex) => {
                if (displayCanvasRefs.current[pageIndex]) {
                  return new Promise<void>((resolve) => {
                      setTimeout(() => {
                          redrawCanvas(pageIndex);
                          updateHistoryButtons(pageIndex);
                          resolve();
                      }, 0);
                  });
                }
            });

            Promise.all(restorePromises).then(() => {
                onProjectLoadComplete();
            });

        } catch(e) {
            console.error("Failed to load annotations, file may be corrupt.", e);
            toast({
                title: "Error loading project",
                description: "The project file may be corrupt. Loading PDF without annotations.",
                variant: "destructive",
            });
            pageHistoryRef.current.clear();
            pageHistoryIndexRef.current.clear();
            onProjectLoadComplete();
        }
      }
    }, [initialAnnotations, isProjectLoading, toast, onProjectLoadComplete, updateHistoryButtons, redrawCanvas, pages]);

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

      if((tool === 'snapshot' || tool === 'note') && selection){
        const pageIndex = lastActivePageRef.current;
        const point = getPoint(e, pageIndex);
        setSelection(prev => prev ? { ...prev, endX: point.x, endY: point.y } : null);
        return;
      }

      if (!currentPathRef.current) return;
      
      const pageIndex = lastActivePageRef.current;
      const point = getPoint(e, pageIndex);
      currentPathRef.current.points.push(point);

      if (!hasMovedRef.current) {
        const p1 = currentPathRef.current.points[0];
        const p2 = currentPathRef.current.points[currentPathRef.current.points.length - 1];
        if (p1 && p2 && (Math.abs(p1.x - p2.x) > 2 || Math.abs(p1.y - p2.y) > 2)) {
          hasMovedRef.current = true;
        }
      }
      
      const canvas = displayCanvasRefs.current[pageIndex];
      const context = canvas?.getContext('2d');
      if (!context) return;
  
      redrawCanvas(pageIndex);
      
      const livePath = currentPathRef.current;
      if (livePath && livePath.points.length > 0) {
        context.strokeStyle = livePath.color;
        context.lineWidth = livePath.size;
        context.globalCompositeOperation = livePath.compositeOperation;
        context.globalAlpha = livePath.globalAlpha;
        context.lineCap = 'round';
        context.lineJoin = 'round';

        const p = getPathAsSVG(livePath);
        context.stroke(p);
        
        context.globalCompositeOperation = 'source-over';
        context.globalAlpha = 1.0;
      }
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
            const pageElement = pageContainerRef.current?.querySelectorAll('.page-wrapper')[pageIndex] as (HTMLDivElement | undefined);
            const pageImage = pageElement?.querySelector('.page-image') as (HTMLImageElement | undefined);

            if (!pageElement || !pageImage) {
              setSelection(null);
              isDrawingRef.current = false;
              return;
            }
            
            const scrollContainer = pageContainerRef.current;
            if (!scrollContainer) {
              setSelection(null);
              isDrawingRef.current = false;
              return;
            }

            const pageRect = pageElement.getBoundingClientRect();
            const containerRect = scrollContainer.getBoundingClientRect();
            const initialY = pageRect.top - containerRect.top + y;
            
            const { width: renderWidth, height: renderHeight } = pageImage.getBoundingClientRect();
            const viewport = page.getViewport({ scale: 1.0 });
            const masterWidth = viewport.width;
            const pdfScale = masterWidth / renderWidth;
            
            const sx = Math.round(x * pdfScale);
            const sy = Math.round(y * pdfScale);
            const sWidth = Math.round(width * pdfScale);
            const sHeight = Math.round(height * pdfScale);

            if (sWidth <= 0 || sHeight <= 0) {
              setSelection(null);
              isDrawingRef.current = false;
              return;
            }

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = sWidth;
            tempCanvas.height = sHeight;
            const tempCtx = tempCanvas.getContext('2d');

            if (tempCtx) {
                tempCtx.fillStyle = '#FFFFFF';
                tempCtx.fillRect(0, 0, sWidth, sHeight);

                const baseLayerCanvas = document.createElement('canvas');
                baseLayerCanvas.width = viewport.width;
                baseLayerCanvas.height = viewport.height;
                const baseLayerCtx = baseLayerCanvas.getContext('2d');
                
                if (baseLayerCtx) {
                    await page.render({ canvasContext: baseLayerCtx, viewport }).promise;
                    tempCtx.drawImage(
                        baseLayerCanvas,
                        sx, sy, sWidth, sHeight,
                        0, 0, sWidth, sHeight
                    );
                }

                const historyStack = pageHistoryRef.current.get(pageIndex);
                const historyIdx = pageHistoryIndexRef.current.get(pageIndex);
                const pathsToDraw = historyStack?.[historyIdx ?? -1] ?? [];
              
                if(pathsToDraw.length > 0) {
                    const annotationCanvas = document.createElement('canvas');
                    annotationCanvas.width = viewport.width;
                    annotationCanvas.height = viewport.height;
                    const annotationCtx = annotationCanvas.getContext('2d');
                    
                    if (annotationCtx) {
                        const scaledPaths = pathsToDraw.map(path => {
                            const newPoints = path.points.map(p => ({
                                x: p.x * viewport.width,
                                y: p.y * viewport.height
                            }));
                            const newSize = path.size * viewport.width;
                            return { ...path, points: newPoints, size: newSize };
                        });
                        
                        // We must create a new renderPaths function here because the one in the component scope
                        // is bound to useCallback with dependencies that might not be right for this high-res render.
                        scaledPaths.forEach(path => {
                            annotationCtx.strokeStyle = path.color;
                            annotationCtx.lineWidth = path.size;
                            annotationCtx.globalCompositeOperation = path.compositeOperation;
                            annotationCtx.globalAlpha = path.globalAlpha;
                            annotationCtx.lineCap = 'round';
                            annotationCtx.lineJoin = 'round';
                            const p = getPathAsSVG(path);
                            annotationCtx.stroke(p);
                        });

                        tempCtx.drawImage(
                            annotationCanvas,
                            sx, sy, sWidth, sHeight,
                            0, 0, sWidth, sHeight
                        );
                    }
                }
              
              const dataUrl = tempCanvas.toDataURL('image/png');
              const aspectRatio = sWidth > 0 ? sHeight / sWidth : 1;
              const sourceRelRect = {
                relX: x / renderWidth,
                relY: y / renderHeight,
                relWidth: width / renderWidth,
                relHeight: height / renderHeight,
              };

              onSnapshot(dataUrl, pageIndex, sourceRelRect, aspectRatio, initialY);
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

      if (currentPathRef.current && hasMovedRef.current) {
        commitHistory(pageIndex, currentPathRef.current);
      }

      isDrawingRef.current = false;
      currentPathRef.current = null;
      
      redrawCanvas(pageIndex);
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

      const canvas = displayCanvasRefs.current[pageIndex];
      if (!canvas) return;

      if (tool === 'inkling') {
          if (onCanvasClick) {
              const point = getPoint(e, pageIndex);
              onCanvasClick(pageIndex, point, canvas);
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
      
      const newPath: Path = {
        tool,
        points: [point],
        color: tool === 'draw' ? penColor : tool === 'highlight' ? highlighterColor : '#000000',
        size: tool === 'draw' ? penSize : tool === 'highlight' ? highlighterSize : eraserSize,
        globalAlpha: tool === 'highlight' ? 0.3 : 1.0,
        compositeOperation: tool === 'erase' ? 'destination-out' : 'source-over',
      };
      currentPathRef.current = newPath;
      
    }, [tool, penColor, penSize, eraserSize, highlighterColor, highlighterSize, getPoint, onCanvasClick]);
    
    useImperativeHandle(ref, () => ({
      initializePages: (numPages: number) => {
        pageHistoryRef.current.clear();
        pageHistoryIndexRef.current.clear();
        for (let i = 0; i < numPages; i++) {
          pageHistoryRef.current.set(i, [[]]);
          pageHistoryIndexRef.current.set(i, 0);
        }
      },
      exportAsDataURL: () => {
        const pageIndex = lastActivePageRef.current;
        const displayCanvas = displayCanvasRefs.current[pageIndex];
        if (!displayCanvas) return;
        
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
        
        tempCtx.drawImage(displayCanvas, 0, 0, tempCanvas.width, tempCanvas.height);

        return { 
          dataUrl: tempCanvas.toDataURL('image/png'),
          pageNum: pageIndex + 1
        };
      },
      clear: () => {
        const activePage = lastActivePageRef.current;
        
        const clearAndReset = (index: number) => {
            pageHistoryRef.current.set(index, [[]]);
            pageHistoryIndexRef.current.set(index, 0);
            redrawCanvas(index);
        };

        if (pages.length === 0) {
            clearAndReset(0);
        } else {
            pageHistoryRef.current.forEach((_, index) => {
                clearAndReset(index);
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
          redrawCanvas(page);
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
          redrawCanvas(page);
          updateHistoryButtons(page);
        }
      },
      getAnnotationData: () => {
        if (pageHistoryRef.current.size === 0) return undefined;

        const historyToSave = new Map<number, Path[][]>();
        pageHistoryRef.current.forEach((stack, pageIndex) => {
            const idx = pageHistoryIndexRef.current.get(pageIndex);
            if (idx !== undefined && idx > -1 && stack[idx]?.length > 0) {
                historyToSave.set(pageIndex, stack.slice(0, idx + 1));
            }
        });

        if (historyToSave.size === 0) return undefined;

        const indexToSave = new Map<number, number>();
        historyToSave.forEach((_, pageIndex) => {
            const idx = pageHistoryIndexRef.current.get(pageIndex);
            if (idx !== undefined) {
                indexToSave.set(pageIndex, idx);
            }
        });
        
        return {
            history: Array.from(historyToSave.entries()),
            historyIndex: Array.from(indexToSave.entries()),
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
