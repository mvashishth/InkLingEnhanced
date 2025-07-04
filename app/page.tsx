
"use client";

import * as React from 'react';
import {
  Pencil,
  Eraser,
  Undo,
  Redo,
  Trash2,
  Highlighter,
  FileUp,
  Save,
  Scissors,
  Link as LinkIcon,
  XCircle,
  StickyNote,
  Lock,
  Unlock,
  ArrowUp,
  FileImage,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { DrawingCanvas, type DrawingCanvasRef, type AnnotationData } from '@/components/drawing-canvas';
import { SnapshotItem, type Snapshot } from '@/components/snapshot-item';
import { NoteItem, type Note } from '@/components/note-item';
import { ImageItem, type UploadedImage } from '@/components/image-item';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from '@/lib/utils';
import { useToast } from "@/hooks/use-toast";
import { Progress } from '@/components/ui/progress';

if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
}

type Tool = 'draw' | 'erase' | 'highlight' | 'snapshot' | 'inkling' | 'note';
const COLORS = ['#1A1A1A', '#EF4444', '#3B82F6', '#22C55E', '#EAB308'];
const HIGHLIGHT_COLORS = ['#FEF3C7', '#FCA5A5', '#93C5FD', '#A7F3D0', '#FDE68A', '#D8B4FE', '#F9A8D4', '#FDBA74', '#CBD5E1', '#6EE7B7', '#A5B4FC'];

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

interface PdfPoint {
  pageIndex: number;
  relX: number;
  relY: number;
}
interface PinupPoint {
    targetId: string;
    targetType: 'snapshot' | 'note' | 'image';
    relX: number;
    relY: number;
}
export interface Inkling {
  id: string;
  pdfPoint: PdfPoint;
  pinupPoint: PinupPoint;
}

interface InklingRenderData {
  id: string;
  path: string;
  startCircle: { cx: number; cy: number };
  endCircle: { cx: number; cy: number };
}
interface PendingSnapshot {
  imageDataUrl: string;
  sourcePage: number;
  sourceRelRect: { relX: number; relY: number; relWidth: number; relHeight: number };
  aspectRatio: number;
  initialY: number;
}

export default function Home() {
  const [tool, setTool] = React.useState<Tool | null>(null);
  const [penSize, setPenSize] = React.useState(5);
  const [penColor, setPenColor] = React.useState(COLORS[0]);
  const [highlighterColor, setHighlighterColor] = React.useState(HIGHLIGHT_COLORS[3]);
  const [eraserSize, setEraserSize] = React.useState(20);
  const [highlighterSize, setHighlighterSize] = React.useState(20);
  
  const [pageImages, setPageImages] = React.useState<string[]>([]);
  const [pdfDoc, setPdfDoc] = React.useState<PDFDocumentProxy | null>(null);
  
  const [isPdfLoading, setIsPdfLoading] = React.useState(false);
  const [isProjectLoading, setIsProjectLoading] = React.useState(false);
  const [pdfLoadProgress, setPdfLoadProgress] = React.useState(0);
  const [originalPdfFile, setOriginalPdfFile] = React.useState<ArrayBuffer | null>(null);
  const [originalPdfFileName, setOriginalPdfFileName] = React.useState<string | null>(null);
  const [annotationDataToLoad, setAnnotationDataToLoad] = React.useState<AnnotationData | null>(null);
  const [pinupAnnotationDataToLoad, setPinupAnnotationDataToLoad] = React.useState<AnnotationData | null>(null);

  const pdfCanvasRef = React.useRef<DrawingCanvasRef>(null);
  const pinupCanvasRef = React.useRef<DrawingCanvasRef>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const mainContainerRef = React.useRef<HTMLDivElement>(null);
  const pdfContainerRef = React.useRef<HTMLDivElement>(null);
  const pinupContainerRef = React.useRef<HTMLDivElement>(null);
  const pinupScrollContainerRef = React.useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const [activeCanvas, setActiveCanvas] = React.useState<'pdf' | 'pinup'>('pdf');
  
  const [pdfCanUndo, setPdfCanUndo] = React.useState(false);
  const [pdfCanRedo, setPdfCanRedo] = React.useState(false);
  const [pinupCanUndo, setPinupCanUndo] = React.useState(false);
  const [pinupCanRedo, setPinupCanRedo] = React.useState(false);

  const [snapshots, setSnapshots] = React.useState<Snapshot[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = React.useState<string | null>(null);

  const [notes, setNotes] = React.useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = React.useState<string | null>(null);

  const [uploadedImages, setUploadedImages] = React.useState<UploadedImage[]>([]);
  const [selectedImage, setSelectedImage] = React.useState<string | null>(null);

  const [inklings, setInklings] = React.useState<Inkling[]>([]);
  const [pendingInkling, setPendingInkling] = React.useState<PdfPoint | null>(null);
  const [inklingRenderData, setInklingRenderData] = React.useState<InklingRenderData[]>([]);
  const [pendingInklingRenderPoint, setPendingInklingRenderPoint] = React.useState<{cx: number, cy: number} | null>(null);
  const [hoveredInkling, setHoveredInkling] = React.useState<string | null>(null);
  const [pendingSnapshot, setPendingSnapshot] = React.useState<PendingSnapshot | null>(null);

  const [isClearConfirmOpen, setIsClearConfirmOpen] = React.useState(false);
  const [viewerWidth, setViewerWidth] = React.useState(40);
  const [pinupBgColor, setPinupBgColor] = React.useState('#ffffff');
  const [isPinupScrollLocked, setIsPinupScrollLocked] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [overwriteCount, setOverwriteCount] = React.useState(0);

  const [fileHandle, setFileHandle] = React.useState<FileSystemFileHandle | null>(null);
  const [canUseFSApi, setCanUseFSApi] = React.useState(false);

  const canUndo = activeCanvas === 'pdf' ? pdfCanUndo : pinupCanUndo;
  const canRedo = activeCanvas === 'pdf' ? pdfCanRedo : pinupCanRedo;
  const activeCanvasRef = activeCanvas === 'pdf' ? pdfCanvasRef : pinupCanvasRef;
  
  const pdfTool = ['draw', 'erase', 'highlight', 'snapshot', 'inkling'].includes(tool || '') ? tool : null;
  const pinupTool = ['draw', 'erase', 'highlight', 'note'].includes(tool || '') ? tool : null;

  React.useEffect(() => {
    setCanUseFSApi(
      typeof window !== 'undefined' &&
      'showOpenFilePicker' in window &&
      'showSaveFilePicker' in window
    );
  }, []);

  React.useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!originalPdfFile) {
        return;
      }
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [originalPdfFile]);

  const handleToolClick = (selectedTool: Tool) => {
    setTool((currentTool) => (currentTool === selectedTool ? null : selectedTool));
    if (selectedTool !== 'inkling') {
      setPendingInkling(null);
    }
  };

  const legacySave = (jsonString: string) => {
    const defaultFileName = originalPdfFileName ? originalPdfFileName.replace(/\.pdf$/i, '') : 'annotated-project';
    const chosenFileName = window.prompt("Enter filename for your project:", defaultFileName);

    if (!chosenFileName) {
        return;
    }

    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonString);
    const link = document.createElement('a');
    link.href = dataUri;
    const downloadFileName = chosenFileName.endsWith('.json') ? chosenFileName : `${chosenFileName}.json`;
    link.download = downloadFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      if (!originalPdfFile) {
          toast({
              title: "Cannot Save",
              description: "Please upload a PDF before saving.",
              variant: "destructive",
          });
          return;
      }

      const pdfAnnotationData = pdfCanvasRef.current?.getAnnotationData();
      const pinupAnnotationData = pinupCanvasRef.current?.getAnnotationData();
      
      const pdfDataBase64 = arrayBufferToBase64(originalPdfFile.slice(0));

      const nextOverwriteCount = fileHandle ? overwriteCount + 1 : 1;

      const projectData = {
          originalPdfFileName: originalPdfFileName,
          pdfDataBase64: pdfDataBase64,
          pdfAnnotations: pdfAnnotationData,
          pinupAnnotations: pinupAnnotationData,
          snapshots: snapshots,
          inklings: inklings,
          notes: notes,
          uploadedImages: uploadedImages,
          pinupBgColor: pinupBgColor,
          viewerWidth: viewerWidth,
          overwriteCount: nextOverwriteCount,
          fileType: 'inkling-project'
      };
      
      let jsonString;
      try {
          jsonString = JSON.stringify(projectData);
          JSON.parse(jsonString);
      } catch (error) {
          console.error("Data validation failed before saving:", error);
          toast({
              title: "Save Failed",
              description: "Could not save project due to an internal data validation error. Your file has not been changed.",
              variant: "destructive",
          });
          return;
      }

      if (canUseFSApi) {
          try {
              let handle = fileHandle;
              if (!handle) { // Save As
                  const suggestedName = originalPdfFileName ? originalPdfFileName.replace(/\.pdf$/i, '.json') : 'annotated-project.json';
                  handle = await window.showSaveFilePicker({
                      suggestedName,
                      types: [{
                          description: 'Inkling Project File',
                          accept: { 'application/json': ['.json'] },
                      }],
                  });
                  setFileHandle(handle);
              }

              const writable = await handle.createWritable();
              const blob = new Blob([jsonString], {type: 'application/json'});
              await writable.write(blob);
              await writable.close();
              toast({ title: "Project Saved", description: `Saved to ${handle.name}` });
              setOverwriteCount(nextOverwriteCount);

          } catch (error) {
              const err = error as Error;
              if (err.name === 'AbortError') {
                  // User cancelled the picker. Do nothing.
              } else if (err.name === 'SecurityError') {
                  // The API is blocked by the environment. Fallback to legacy download.
                  console.warn("File System Access API for saving is blocked. Falling back to legacy download.");
                  legacySave(jsonString);
              } else {
                  console.error('Error saving file:', err);
                  toast({
                      title: "Save Failed",
                      description: "Could not save the project file.",
                      variant: "destructive",
                  });
              }
          }
      } else {
          legacySave(jsonString);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handlePdfHistoryChange = React.useCallback((canUndo: boolean, canRedo: boolean) => {
    setPdfCanUndo(canUndo);
    setPdfCanRedo(canRedo);
  }, []);

  const handlePinupHistoryChange = React.useCallback((canUndo: boolean, canRedo: boolean) => {
    setPinupCanUndo(canUndo);
    setPinupCanRedo(canRedo);
  }, []);

  const handleSliderChange = (value: number[]) => {
    if (tool === 'draw') {
      setPenSize(value[0]);
    } else if (tool === 'highlight') {
      setHighlighterSize(value[0]);
    } else {
      setEraserSize(value[0]);
    }
  };
  
  const handleUploadImageClick = () => {
    imageInputRef.current?.click();
  };
  
  const loadPdf = async (arrayBuffer: ArrayBuffer, isProjectLoad = false) => {
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      toast({
        title: "Cannot load PDF",
        description: "The provided file is empty or invalid.",
        variant: "destructive",
      });
      setIsPdfLoading(false);
      return;
    }

    setIsPdfLoading(true);
    setPdfLoadProgress(0);
    
    if (!isProjectLoad) {
      setPageImages([]);
      pdfCanvasRef.current?.clear();
      pinupCanvasRef.current?.clear();
      
      setSnapshots([]);
      setUploadedImages([]);

      setInklings([]);
      setNotes([]);
      setAnnotationDataToLoad(null);
      setPinupAnnotationDataToLoad(null);
      setPdfDoc(null);
    }

    try {
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
      loadingTask.onProgress = (progressData) => {};
      
      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      const numPages = pdf.numPages;
      
      if (!isProjectLoad) {
        pdfCanvasRef.current?.initializePages(numPages);
      }

      const newPageImages: string[] = [];
      
      for (let i = 1; i <= numPages; i++) {
        setPdfLoadProgress(Math.round((i / numPages) * 100));
        const page = await pdf.getPage(i);
        
        const originalViewport = page.getViewport({ scale: 1.0 });
        const scale = 2000 / originalViewport.width;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        if (!context) continue;

        await page.render({ canvasContext: context, viewport: viewport }).promise;
        newPageImages.push(canvas.toDataURL('image/png'));
      }
      setPageImages(newPageImages);

    } catch (error) {
      console.error('Failed to render PDF:', error);
      toast({
        title: "Error loading PDF",
        description: "There was a problem rendering the PDF file. Please try another file.",
        variant: "destructive",
      });
      setPageImages([]);
      setPdfDoc(null);
    } finally {
      setIsPdfLoading(false);
    }
  }

  const loadProjectData = async (projectJson: any, fileName: string) => {
    if (projectJson.fileType !== 'inkling-project' || !projectJson.pdfDataBase64) {
        throw new Error("Invalid project file format.");
    }
    setIsProjectLoading(true);
    const byteCharacters = window.atob(projectJson.pdfDataBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const arrayBuffer = byteArray.buffer;
    
    pdfCanvasRef.current?.clear();
    pinupCanvasRef.current?.clear();

    setOriginalPdfFile(arrayBuffer.slice(0));
    setOriginalPdfFileName(projectJson.originalPdfFileName || fileName.replace(/\.json$/i, ".pdf"));
    setSnapshots(projectJson.snapshots || []);
    setInklings(projectJson.inklings || []);
    setNotes(projectJson.notes || []);
    setUploadedImages(projectJson.uploadedImages || []);
    setAnnotationDataToLoad(projectJson.pdfAnnotations || null);
    setPinupAnnotationDataToLoad(projectJson.pinupAnnotations || null);
    setPinupBgColor(projectJson.pinupBgColor || '#ffffff');
    setViewerWidth(projectJson.viewerWidth || 40);
    setOverwriteCount(projectJson.overwriteCount || 0);
    
    await loadPdf(arrayBuffer.slice(0), true);
  };

  const handleFSApiOpen = async () => {
    try {
        const [handle] = await window.showOpenFilePicker({
            types: [
                {
                    description: 'Inkling Project or PDF',
                    accept: {
                        'application/json': ['.json'],
                        'application/pdf': ['.pdf'],
                    },
                },
            ],
            multiple: false,
        });

        const file = await handle.getFile();
        if (file.type === 'application/json') {
            const jsonString = await file.text();
            if (!jsonString) {
                toast({ title: "Error", description: "File is empty.", variant: "destructive" });
                return;
            }
            const projectData = JSON.parse(jsonString);
            await loadProjectData(projectData, file.name);
            setFileHandle(handle);
        } else if (file.type === 'application/pdf') {
            setFileHandle(null);
            const arrayBuffer = await file.arrayBuffer();
            setOriginalPdfFile(arrayBuffer.slice(0));
            setOriginalPdfFileName(file.name);
            setOverwriteCount(0);
            await loadPdf(arrayBuffer.slice(0), false);
        }
    } catch (error) {
        const err = error as Error;
        if (err.name === 'AbortError') {
          // User cancelled the picker. Do nothing.
        } else if (err.name === 'SecurityError') {
          // The API is blocked by the environment (e.g., cross-origin iframe).
          // Fall back to the legacy file input.
          console.warn("File System Access API for opening is blocked. Falling back to legacy input.");
          fileInputRef.current?.click();
        } else {
          console.error('Failed to open file with File System Access API:', err);
          toast({
              title: "Error Opening File",
              description: "Could not open the selected file.",
              variant: "destructive",
          });
        }
    }
  };

  const handleUploadClick = () => {
    if (canUseFSApi) {
        handleFSApiOpen();
    } else {
        fileInputRef.current?.click();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileHandle(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type === 'application/json') {
      const reader = new FileReader();
      reader.onload = async (event) => {
          try {
              const projectData = JSON.parse(event.target?.result as string);
              await loadProjectData(projectData, file.name);
          } catch (error) {
              console.error('Failed to load project file:', error);
              toast({
                  title: "Error loading project",
                  description: "The selected file is not a valid project file.",
                  variant: "destructive",
              });
              setIsProjectLoading(false);
          }
      };
      reader.readAsText(file);
    } else if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        setOriginalPdfFile(arrayBuffer.slice(0));
        setOriginalPdfFileName(file.name);
        setOverwriteCount(0);
        await loadPdf(arrayBuffer.slice(0), false);
    } else {
        toast({
            title: "Unsupported File Type",
            description: "Please upload a PDF or a saved .json project file.",
            variant: "destructive",
        });
    }

    if (e.target) e.target.value = '';
  };
  
  const handleImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
        toast({
            title: "Unsupported File Type",
            description: "Please upload a PNG, JPG, or JPEG file.",
            variant: "destructive",
        });
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        const img = new Image();
        img.onload = () => {
            const maxWidth = 300;
            const scale = Math.min(1, maxWidth / img.width);
            const newImage: UploadedImage = {
                id: `image_${Date.now()}`,
                imageDataUrl: dataUrl,
                x: 50,
                y: 50,
                width: img.width * scale,
                height: img.height * scale,
            };
            setUploadedImages(prev => [...prev, newImage]);
            toast({
                title: "Image Added",
                description: "The image has been added to your pinup board.",
            });
        };
        img.src = dataUrl;
    };
    reader.readAsDataURL(file);

    if (e.target) e.target.value = '';
  };

  const handleClear = () => {
    setIsClearConfirmOpen(true);
  };
  
  const handleConfirmClear = () => {
    pdfCanvasRef.current?.clear();
    setPageImages([]);
    setOriginalPdfFile(null);
    setOriginalPdfFileName(null);
    setAnnotationDataToLoad(null);
    setPdfDoc(null);
    
    pinupCanvasRef.current?.clear();

    setSnapshots([]);
    setNotes([]);
    setUploadedImages([]);

    setInklings([]);
    setPinupAnnotationDataToLoad(null);
    setFileHandle(null);
    setOverwriteCount(0);

    setIsClearConfirmOpen(false);
  };

  const handleSnapshot = React.useCallback((
    imageDataUrl: string,
    sourcePage: number,
    sourceRelRect: { relX: number; relY: number; relWidth: number; relHeight: number },
    aspectRatio: number,
    initialY: number
  ) => {
    setPendingSnapshot({
      imageDataUrl,
      sourcePage,
      sourceRelRect,
      aspectRatio,
      initialY
    });
    setTool(null);
  }, []);

  const handleColorSelect = (color: string | null) => {
    if (!pendingSnapshot) return;

    const pinupScrollTop = pinupScrollContainerRef.current?.scrollTop || 0;

    const newSnapshot: Snapshot = {
      id: `snapshot_${Date.now()}`,
      imageDataUrl: pendingSnapshot.imageDataUrl,
      x: 50,
      y: pendingSnapshot.initialY + pinupScrollTop,
      width: 250,
      height: 250 * pendingSnapshot.aspectRatio,
      sourcePage: pendingSnapshot.sourcePage,
      sourceRelRect: pendingSnapshot.sourceRelRect,
      aspectRatio: pendingSnapshot.aspectRatio,
      highlightColor: color,
    };
    setSnapshots((prev) => [...prev, newSnapshot]);
    setPendingSnapshot(null);
  };

  const updateSnapshot = React.useCallback((id: string, newProps: Partial<Omit<Snapshot, 'id'>>) => {
    setSnapshots(snapshots => snapshots.map(s => {
      if (s.id === id) {
        const updatedSnapshot = {...s, ...newProps};
        if (newProps.width && s.aspectRatio) {
          updatedSnapshot.height = newProps.width * s.aspectRatio;
        }
        return updatedSnapshot;
      }
      return s;
    }));
  }, []);

  const deleteSnapshot = React.useCallback((id: string) => {
    setSnapshots(snapshots => snapshots.filter(s => s.id !== id));
    setInklings(inklings => inklings.filter(i => !(i.pinupPoint.targetType === 'snapshot' && i.pinupPoint.targetId === id)));
  }, []);

  const handleNoteCreate = React.useCallback((rect: { x: number; y: number; width: number; height: number }) => {
    const newNote: Note = {
      id: `note_${Date.now()}`,
      content: '',
      color: HIGHLIGHT_COLORS[0],
      ...rect,
    };
    setNotes(prev => [...prev, newNote]);
    setTool(null);
  }, []);

  const updateNote = React.useCallback((id: string, newProps: Partial<Omit<Note, 'id'>>) => {
    setNotes(notes => notes.map(n => n.id === id ? {...n, ...newProps} : n));
  }, []);

  const deleteNote = React.useCallback((id: string) => {
    setNotes(notes => notes.filter(n => n.id !== id));
    setInklings(inklings => inklings.filter(i => !(i.pinupPoint.targetType === 'note' && i.pinupPoint.targetId === id)));
  }, []);

  const updateUploadedImage = React.useCallback((id: string, newProps: Partial<Omit<UploadedImage, 'id'>>) => {
    setUploadedImages(images => images.map(i => i.id === id ? {...i, ...newProps} : i));
  }, []);

  const deleteUploadedImage = React.useCallback((id: string) => {
    setUploadedImages(images => images.filter(i => i.id !== id));
    setInklings(inklings => inklings.filter(i => !(i.pinupPoint.targetType === 'image' && i.pinupPoint.targetId === id)));
  }, []);


  const handleSnapshotClick = React.useCallback((snapshot: Snapshot, e: React.MouseEvent<HTMLDivElement>) => {
    if (pendingInkling) {
        const target = e.currentTarget;
        const rect = target.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const newInkling: Inkling = {
            id: `inkling_${Date.now()}`,
            pdfPoint: pendingInkling,
            pinupPoint: { 
                targetId: snapshot.id, 
                targetType: 'snapshot', 
                relX: x / rect.width,
                relY: y / rect.height
            },
        };
        setInklings(prev => [...prev, newInkling]);
        setPendingInkling(null);
        setTool(null);
        toast({
            title: "Link Created!",
            description: "A new link between the PDF and the snapshot has been created.",
        });
        e.stopPropagation();
        return;
    }
    
    setSelectedSnapshot(snapshot.id);
    setSelectedNote(null);
    setSelectedImage(null);
    const scrollContainer = pdfCanvasRef.current?.getScrollContainer();
    const pageElement = pdfCanvasRef.current?.getPageElement(snapshot.sourcePage);
    if (pageElement && scrollContainer) {
      const pageCanvas = pageElement.querySelector('canvas');
      if (!pageCanvas) return;

      const containerRect = scrollContainer.getBoundingClientRect();
      const pageCanvasHeight = pageCanvas.getBoundingClientRect().height;
      
      const { relY, relHeight } = snapshot.sourceRelRect;

      const rectY_pixels = relY * pageCanvasHeight;
      const rectHeight_pixels = relHeight * pageCanvasHeight;
      const rectCenterY_pixels = rectY_pixels + (rectHeight_pixels / 2);

      const pointY_absolute = pageElement.offsetTop + rectCenterY_pixels;
      const targetScrollTop = pointY_absolute - (containerRect.height / 2);

      scrollContainer.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth'
      });
    }
  }, [pendingInkling, toast]);

  const handleNoteClick = React.useCallback((note: Note, e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    if (pendingInkling) {
      const isHeaderClick = !!target.closest('[data-drag-handle="true"]');
      if (isHeaderClick) {
        const noteElement = e.currentTarget;
        const rect = noteElement.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
  
        const newInkling: Inkling = {
          id: `inkling_${Date.now()}`,
          pdfPoint: pendingInkling,
          pinupPoint: { 
              targetId: note.id, 
              targetType: 'note', 
              relX: x / rect.width,
              relY: y / rect.height
          },
        };
        setInklings(prev => [...prev, newInkling]);
        setPendingInkling(null);
        setTool(null);
        toast({
          title: "Link Created!",
          description: "A new link between the PDF and the note has been created.",
        });
        e.stopPropagation();
      }
      return;
    }
    
    setSelectedNote(note.id);
    setSelectedSnapshot(null);
    setSelectedImage(null);
  }, [pendingInkling, toast]);

  const handleImageClick = React.useCallback((image: UploadedImage, e: React.MouseEvent<HTMLDivElement>) => {
    if (pendingInkling) {
        const target = e.currentTarget;
        const rect = target.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const newInkling: Inkling = {
            id: `inkling_${Date.now()}`,
            pdfPoint: pendingInkling,
            pinupPoint: { 
                targetId: image.id, 
                targetType: 'image', 
                relX: x / rect.width,
                relY: y / rect.height
            },
        };
        setInklings(prev => [...prev, newInkling]);
        setPendingInkling(null);
        setTool(null);
        toast({
            title: "Link Created!",
            description: "A new link between the PDF and the image has been created.",
        });
        e.stopPropagation();
        return;
    }
    
    setSelectedImage(image.id);
    setSelectedSnapshot(null);
    setSelectedNote(null);
  }, [pendingInkling, toast]);

  const handleCanvasClick = (pageIndex: number, point: { x: number; y: number; }, canvas: HTMLCanvasElement) => {
    if (tool !== 'inkling') return;
    setPendingInkling({ 
        pageIndex, 
        relX: point.x / canvas.width, 
        relY: point.y / canvas.height,
    });
    toast({
        title: "Link Started",
        description: "Click on a snapshot, a note's header, or an image in the pinup board to complete the link.",
    });
  };
  
  const handleInklingEndpointClick = (inklingId: string, endpoint: 'pdf' | 'pinup') => {
    const inkling = inklings.find(i => i.id === inklingId);
    if (!inkling) return;

    if (endpoint === 'pinup') {
      const scrollContainer = pdfCanvasRef.current?.getScrollContainer();
      const pageElement = pdfCanvasRef.current?.getPageElement(inkling.pdfPoint.pageIndex);
      if (pageElement && scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const pageRect = pageElement.getBoundingClientRect();
        
        const pointY_relative_pixels = inkling.pdfPoint.relY * pageRect.height; 
        const pointY_absolute = pageElement.offsetTop + pointY_relative_pixels;
        const targetScrollTop = pointY_absolute - (containerRect.height / 2);

        scrollContainer.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
      }
    } else {
      const { targetId, targetType, relY } = inkling.pinupPoint;

      const pinupScrollContainer = pinupScrollContainerRef.current;
      if (!pinupScrollContainer) return;

      const containerRect = pinupScrollContainer.getBoundingClientRect();

      let targetItem: Snapshot | Note | UploadedImage | undefined;
      if (targetType === 'snapshot') {
        targetItem = snapshots.find(s => s.id === targetId);
      } else if (targetType === 'note') {
        targetItem = notes.find(n => n.id === targetId);
      } else if (targetType === 'image') {
        targetItem = uploadedImages.find(i => i.id === targetId);
      }

      if (targetItem) {
        const itemY = targetItem.y;
        const itemHeight = targetItem.height;

        const pointY_relative_pixels = relY * itemHeight;
        const pointY_absolute = itemY + pointY_relative_pixels;
        const targetScrollTop = pointY_absolute - (containerRect.height / 2);

        pinupScrollContainer.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
        
        if (targetType === 'snapshot') {
          setSelectedSnapshot(targetId);
          setSelectedNote(null);
          setSelectedImage(null);
        } else if (targetType === 'note') {
          setSelectedNote(targetId);
          setSelectedSnapshot(null);
          setSelectedImage(null);
        } else if (targetType === 'image') {
          setSelectedImage(targetId);
          setSelectedSnapshot(null);
          setSelectedNote(null);
        }
      }
    }
  };

  const handleDeleteInkling = (id: string) => {
    setInklings(prev => prev.filter(ink => ink.id !== id));
  };

  const handleScrollToTop = () => {
    pinupScrollContainerRef.current?.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  React.useEffect(() => {
    const mainContainer = mainContainerRef.current;
    if (!mainContainer) return;

    const pdfView = pdfContainerRef.current?.querySelector('.overflow-y-auto');
    const pinupView = pinupScrollContainerRef.current;

    const updatePaths = () => {
        if (!mainContainer) return;
        const mainRect = mainContainer.getBoundingClientRect();
        
        const newRenderData: InklingRenderData[] = [];
        inklings.forEach(inkling => {
            const pdfPageElement = pdfCanvasRef.current?.getPageElement(inkling.pdfPoint.pageIndex)?.querySelector('canvas');
            const { targetId, targetType, relX: pinupRelX, relY: pinupRelY } = inkling.pinupPoint;
            
            let pinupElement: HTMLDivElement | null = null;
            let targetItem: Snapshot | Note | UploadedImage | undefined;

            if (targetType === 'snapshot') {
                targetItem = snapshots.find(s => s.id === targetId);
            } else if (targetType === 'note') {
                targetItem = notes.find(n => n.id === targetId);
            } else if (targetType === 'image') {
                targetItem = uploadedImages.find(i => i.id === targetId);
            }
            
            if (targetItem) {
                const selector = targetType === 'snapshot'
                    ? `[data-snapshot-id="${targetId}"]`
                    : targetType === 'note' 
                    ? `[data-note-id="${targetId}"]`
                    : `[data-image-id="${targetId}"]`;
                pinupElement = pinupContainerRef.current?.querySelector(selector) as HTMLDivElement;
            }

            if (pdfPageElement && pinupElement && targetItem) {
                const pdfRect = pdfPageElement.getBoundingClientRect();
                const pinupRect = pinupElement.getBoundingClientRect();

                const startX_abs = inkling.pdfPoint.relX * pdfRect.width;
                const startY_abs = inkling.pdfPoint.relY * pdfRect.height;

                const endX_abs = pinupRelX * pinupRect.width;
                const endY_abs = pinupRelY * pinupRect.height;

                const startX = pdfRect.left - mainRect.left + startX_abs;
                const startY = pdfRect.top - mainRect.top + startY_abs;
                const endX = pinupRect.left - mainRect.left + endX_abs;
                const endY = pinupRect.top - mainRect.top + endY_abs;
                
                const pathD = `M ${startX} ${startY} C ${startX + 50} ${startY}, ${endX - 50} ${endY}, ${endX} ${endY}`;
                newRenderData.push({
                    id: inkling.id,
                    path: pathD,
                    startCircle: { cx: startX, cy: startY },
                    endCircle: { cx: endX, cy: endY },
                });
            }
        });
        setInklingRenderData(newRenderData);

        if (pendingInkling) {
            const pdfPageElement = pdfCanvasRef.current?.getPageElement(pendingInkling.pageIndex)?.querySelector('canvas');
            if (pdfPageElement) {
                const pdfRect = pdfPageElement.getBoundingClientRect();
                
                const pendingX_abs = pendingInkling.relX * pdfRect.width;
                const pendingY_abs = pendingInkling.relY * pdfRect.height;

                const startX = pdfRect.left - mainRect.left + pendingX_abs;
                const startY = pdfRect.top - mainRect.top + pendingY_abs;
                setPendingInklingRenderPoint({ cx: startX, cy: startY });
            }
        } else {
            setPendingInklingRenderPoint(null);
        }
    };

    const throttledUpdate = () => requestAnimationFrame(updatePaths);
    throttledUpdate();

    window.addEventListener('resize', throttledUpdate);
    pdfView?.addEventListener('scroll', throttledUpdate);
    pinupView?.addEventListener('scroll', throttledUpdate);
    
    const observer = new MutationObserver(throttledUpdate);
    if(pinupContainerRef.current) {
        observer.observe(pinupContainerRef.current, { childList: true, subtree: true, attributes: true });
    }
    
    return () => {
      window.removeEventListener('resize', throttledUpdate);
      pdfView?.removeEventListener('scroll', throttledUpdate);
      pinupView?.removeEventListener('scroll', throttledUpdate);
      observer.disconnect();
    };
  }, [inklings, snapshots, pageImages, pendingInkling, notes, uploadedImages, viewerWidth]);

  const sliderValue = tool === 'draw' ? penSize : tool === 'highlight' ? highlighterSize : eraserSize;
  const sliderMin = tool === 'draw' ? 1 : tool === 'highlight' ? 10 : 2;
  const sliderMax = tool === 'draw' ? 20 : tool === 'highlight' ? 50 : 100;

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex h-dvh w-full flex-col bg-background text-foreground">
        <aside className="flex flex-row items-center justify-between gap-4 p-2 border-b bg-card shadow-md z-30">
            <div className="flex items-center gap-x-2 sm:gap-x-4">
                <h1 className="font-headline text-xl font-bold px-2 hidden sm:block">Inkling</h1>
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={tool === 'draw' ? 'secondary' : 'ghost'}
                        size="icon"
                        onClick={() => handleToolClick('draw')}
                        className="h-10 w-10 rounded-lg"
                      >
                        <Pencil className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom"><p>Draw</p></TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={tool === 'erase' ? 'secondary' : 'ghost'}
                        size="icon"
                        onClick={() => handleToolClick('erase')}
                        className="h-10 w-10 rounded-lg"
                      >
                        <Eraser className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom"><p>Eraser</p></TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={tool === 'highlight' ? 'secondary' : 'ghost'}
                        size="icon"
                        onClick={() => handleToolClick('highlight')}
                        className="h-10 w-10 rounded-lg"
                      >
                        <Highlighter className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom"><p>Highlight</p></TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={tool === 'snapshot' ? 'secondary' : 'ghost'}
                        size="icon"
                        onClick={() => handleToolClick('snapshot')}
                        className="h-10 w-10 rounded-lg"
                        disabled={pageImages.length === 0}
                      >
                        <Scissors className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom"><p>Snapshot</p></TooltipContent>
                  </Tooltip>
                   <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={tool === 'inkling' ? 'secondary' : 'ghost'}
                        size="icon"
                        onClick={() => handleToolClick('inkling')}
                        className="h-10 w-10 rounded-lg"
                        disabled={pageImages.length === 0}
                      >
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 15 15"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path d="M4 4C4 11 11 4 11 11" stroke="currentColor" strokeWidth="1.5" fill="none" />
                          <circle cx="4" cy="4" r="1.5" fill="currentColor" />
                          <circle cx="11" cy="11" r="1.5" fill="currentColor" />
                        </svg>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom"><p>Create Link</p></TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={tool === 'note' ? 'secondary' : 'ghost'}
                        size="icon"
                        onClick={() => handleToolClick('note')}
                        className="h-10 w-10 rounded-lg"
                      >
                        <StickyNote className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom"><p>Add Note</p></TooltipContent>
                  </Tooltip>
                  <Tooltip>
                      <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={handleUploadImageClick} className="h-10 w-10 rounded-lg">
                              <FileImage className="h-5 w-5" />
                          </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom"><p>Add Image to Pinup</p></TooltipContent>
                  </Tooltip>
                </div>
            </div>

            <div className="flex items-center gap-x-2 sm:gap-x-4">
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={() => activeCanvasRef.current?.undo()} disabled={!canUndo} className="h-10 w-10 rounded-lg">
                        <Undo className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom"><p>Undo</p></TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={() => activeCanvasRef.current?.redo()} disabled={!canRedo} className="h-10 w-10 rounded-lg">
                        <Redo className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom"><p>Redo</p></TooltipContent>
                  </Tooltip>
                </div>
                
                <Separator orientation="vertical" className="h-8 mx-2" />

                <div className="flex items-center gap-1">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={handleUploadClick} className="h-10 w-10 rounded-lg" disabled={isPdfLoading}>
                            <FileUp className="h-5 w-5" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom"><p>Open PDF or Project</p></TooltipContent>
                    </Tooltip>
                    <div className="relative flex items-center">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={handleSave} className="h-10 w-10 rounded-lg" disabled={!originalPdfFile || isSaving}>
                                <Save className="h-5 w-5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom"><p>{fileHandle ? `Save to ${fileHandle.name}` : 'Save Project'}</p></TooltipContent>
                        </Tooltip>
                        {fileHandle && overwriteCount > 0 && (
                            <div className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs font-bold rounded-full h-4 w-4 flex items-center justify-center pointer-events-none"
                                title={`${overwriteCount} overwrite${overwriteCount > 1 ? 's' : ''}`}>
                                {overwriteCount}
                            </div>
                        )}
                    </div>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={handleClear} className="h-10 w-10 rounded-lg">
                            <Trash2 className="h-5 w-5 text-destructive" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom"><p>Clear Canvas</p></TooltipContent>
                    </Tooltip>
                </div>
            </div>
        </aside>

        <div className="flex items-center justify-center px-4 py-1 border-b bg-card shadow-sm z-20 h-[52px]">
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className="w-full max-w-xs flex items-center gap-2">
                         <span className="text-sm text-muted-foreground">PDF</span>
                         <Slider
                             value={[viewerWidth]}
                             onValueChange={(val) => setViewerWidth(val[0])}
                             min={20}
                             max={80}
                             step={1}
                             className="w-full"
                         />
                         <span className="text-sm text-muted-foreground">Pinup</span>
                    </div>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>Adjust Panel Split</p></TooltipContent>
            </Tooltip>
        </div>

        {(tool && ['draw', 'erase', 'highlight'].includes(tool)) && (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-x-8 px-4 py-2 border-b bg-card shadow-sm z-10">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                        {tool === 'erase' ? 'Size' : 'Width'}:
                    </span>
                    <Slider
                        value={[sliderValue]}
                        max={sliderMax}
                        min={sliderMin}
                        step={1}
                        onValueChange={handleSliderChange}
                        className="w-32"
                    />
                    <span className="text-sm font-mono w-8 text-center bg-muted/50 rounded-md py-0.5">
                        {sliderValue}
                    </span>
                </div>

                {(tool === 'draw' || tool === 'highlight') && (
                    <>
                        <Separator orientation="vertical" className="h-8 hidden sm:block" />
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-muted-foreground">Color:</span>
                            <div className="flex flex-row flex-wrap justify-center gap-2">
                                {(tool === 'draw' ? COLORS : HIGHLIGHT_COLORS).map((color) => (
                                    <Tooltip key={color}>
                                        <TooltipTrigger asChild>
                                            <button
                                                onClick={() => {
                                                    if (tool === 'draw') {
                                                        setPenColor(color);
                                                    } else if (tool === 'highlight') {
                                                        setHighlighterColor(color);
                                                    }
                                                }}
                                                className={cn(
                                                    'h-6 w-6 rounded-full border-2 transition-all hover:scale-110',
                                                    (tool === 'draw' && penColor === color) || (tool === 'highlight' && highlighterColor === color)
                                                        ? 'border-primary'
                                                        : 'border-muted-foreground/20'
                                                )}
                                                style={{ backgroundColor: color }}
                                                aria-label={`Set color to ${color}`}
                                            />
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom">
                                            <p>{color.toUpperCase()}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>
        )}

        <main ref={mainContainerRef} className="flex-1 flex flex-row overflow-hidden relative">
          <div 
            ref={pdfContainerRef}
            className="flex flex-col"
            style={{ width: `${viewerWidth}%` }}
            onMouseDownCapture={() => {
              setActiveCanvas('pdf');
              setSelectedSnapshot(null);
              setSelectedNote(null);
              setSelectedImage(null);
            }}
          >
            <div 
              className="flex-1 relative bg-background overflow-auto"
            >
              {isPdfLoading && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
                    <p className="mb-4 text-lg font-medium">{'Loading PDF...'}</p>
                    <Progress value={pdfLoadProgress} className="w-1/2 max-w-sm" />
                    <p className="mt-2 text-sm text-muted-foreground">{pdfLoadProgress}%</p>
                </div>
              )}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept="application/pdf,application/json"
                className="hidden"
              />
              <input
                  type="file"
                  ref={imageInputRef}
                  onChange={handleImageFileSelect}
                  accept="image/png,image/jpeg,image/jpg"
                  className="hidden"
              />
              <DrawingCanvas
                ref={pdfCanvasRef}
                pages={pageImages}
                tool={pdfTool}
                penColor={penColor}
                penSize={penSize}
                eraserSize={eraserSize}
                highlighterSize={highlighterSize}
                highlighterColor={highlighterColor}
                onHistoryChange={handlePdfHistoryChange}
                initialAnnotations={annotationDataToLoad}
                isProjectLoading={isProjectLoading}
                onProjectLoadComplete={() => setIsProjectLoading(false)}
                toast={toast}
                onSnapshot={handleSnapshot}
                onCanvasClick={handleCanvasClick}
                snapshotHighlights={snapshots}
                pdfDoc={pdfDoc}
              />
            </div>
          </div>
          <Separator orientation="vertical" className="h-full" />
          <div 
            className="flex flex-col"
            style={{ width: `${100 - viewerWidth}%` }}
          >
              <header className="p-2 flex items-center justify-center gap-4 font-semibold bg-card border-b">
                  <span className="text-center">Pinup Board</span>
                  <div className="flex items-center gap-2">
                      {Object.entries({
                          'White': '#ffffff',
                          'Lavender': '#e6e6fa',
                          'Dark Grey': '#4a4a4a'
                      }).map(([name, color]) => (
                          <Tooltip key={name}>
                              <TooltipTrigger asChild>
                                  <button
                                      onClick={() => setPinupBgColor(color)}
                                      className={cn(
                                          'h-5 w-5 rounded-full border-2 transition-all hover:scale-110',
                                          pinupBgColor === color
                                              ? 'border-primary'
                                              : 'border-muted-foreground/20'
                                      )}
                                      style={{ backgroundColor: color }}
                                      aria-label={`Set pinup background to ${name}`}
                                  />
                              </TooltipTrigger>
                              <TooltipContent side="bottom">
                                  <p>{name}</p>
                              </TooltipContent>
                          </Tooltip>
                      ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <Tooltip>
                          <TooltipTrigger asChild>
                              <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setIsPinupScrollLocked(prev => !prev)}
                                  className="h-8 w-8 rounded-lg"
                              >
                                  {isPinupScrollLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                              </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                              <p>{isPinupScrollLocked ? 'Unlock Scroll' : 'Lock Scroll'}</p>
                          </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                          <TooltipTrigger asChild>
                              <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={handleScrollToTop}
                                  className="h-8 w-8 rounded-lg"
                              >
                                  <ArrowUp className="h-4 w-4" />
                              </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                              <p>Scroll to Top</p>
                          </TooltipContent>
                      </Tooltip>
                    </div>
              </header>
              <div 
                ref={pinupScrollContainerRef}
                className={cn(
                  "flex-1 relative",
                  isPinupScrollLocked ? 'overflow-y-hidden' : 'overflow-y-auto overflow-x-hidden'
                )}
                style={{ backgroundColor: pinupBgColor }}
                onMouseDownCapture={(e) => {
                  if (e.target === e.currentTarget) {
                    setActiveCanvas('pinup');
                    setSelectedSnapshot(null);
                    setSelectedNote(null);
                    setSelectedImage(null);
                  }
                }}
              >
                <div
                    ref={pinupContainerRef}
                    className="relative w-full h-[200%] p-[1%]"
                    onMouseDownCapture={() => {
                        setActiveCanvas('pinup');
                    }}
                >
                    <DrawingCanvas
                        ref={pinupCanvasRef}
                        pages={[]}
                        tool={pinupTool}
                        penColor={penColor}
                        penSize={penSize}
                        eraserSize={eraserSize}
                        highlighterSize={highlighterSize}
                        highlighterColor={highlighterColor}
                        onHistoryChange={handlePinupHistoryChange}
                        initialAnnotations={pinupAnnotationDataToLoad}
                        isProjectLoading={isProjectLoading}
                        onProjectLoadComplete={() => setIsProjectLoading(false)}
                        toast={toast}
                        onNoteCreate={handleNoteCreate}
                        pdfDoc={null}
                    />
                    {snapshots.map(snapshot => (
                      <SnapshotItem 
                        key={snapshot.id}
                        snapshot={snapshot}
                        onUpdate={updateSnapshot}
                        onDelete={deleteSnapshot}
                        onClick={(e) => handleSnapshotClick(snapshot, e)}
                        isSelected={selectedSnapshot === snapshot.id}
                        onSelect={() => {
                            setSelectedSnapshot(snapshot.id);
                            setSelectedNote(null);
                            setSelectedImage(null);
                        }}
                        containerRef={pinupContainerRef}
                      />
                    ))}
                    {notes.map(note => (
                      <NoteItem
                        key={note.id}
                        note={note}
                        onUpdate={updateNote}
                        onDelete={deleteNote}
                        onClick={(e) => handleNoteClick(note, e)}
                        isSelected={selectedNote === note.id}
                        containerRef={pinupContainerRef}
                        availableColors={HIGHLIGHT_COLORS}
                      />
                    ))}
                    {uploadedImages.map(image => (
                      <ImageItem 
                        key={image.id}
                        image={image}
                        onUpdate={updateUploadedImage}
                        onDelete={deleteUploadedImage}
                        onClick={(e) => handleImageClick(image, e)}
                        isSelected={selectedImage === image.id}
                        onSelect={() => {
                            setSelectedImage(image.id);
                            setSelectedSnapshot(null);
                            setSelectedNote(null);
                        }}
                        containerRef={pinupContainerRef}
                      />
                    ))}
                </div>
              </div>
          </div>
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-20">
            {inklingRenderData.map(data => (
                <g key={data.id} onMouseEnter={() => setHoveredInkling(data.id)} onMouseLeave={() => setHoveredInkling(null)}>
                    <path d={data.path} stroke="transparent" strokeWidth="15" fill="none" className="pointer-events-auto" />
                    <path 
                        d={data.path} 
                        stroke={hoveredInkling === data.id ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'} 
                        strokeWidth="2" 
                        fill="none" 
                        className="transition-all pointer-events-none"
                    />

                    <circle cx={data.startCircle.cx} cy={data.startCircle.cy} r="4" fill={hoveredInkling === data.id ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'} className="transition-all pointer-events-none"/>
                    <circle cx={data.endCircle.cx} cy={data.endCircle.cy} r="4" fill={hoveredInkling === data.id ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'} className="transition-all pointer-events-none"/>

                    <circle cx={data.startCircle.cx} cy={data.startCircle.cy} r="10" fill="transparent" className="pointer-events-auto cursor-pointer" onClick={() => handleInklingEndpointClick(data.id, 'pdf')} />
                    <circle cx={data.endCircle.cx} cy={data.endCircle.cy} r="10" fill="transparent" className="pointer-events-auto cursor-pointer" onClick={() => handleInklingEndpointClick(data.id, 'pinup')} />

                    {hoveredInkling === data.id && (
                      <g className="pointer-events-auto cursor-pointer" onClick={() => handleDeleteInkling(data.id)}>
                          <circle cx={(data.startCircle.cx + data.endCircle.cx) / 2} cy={(data.startCircle.cy + data.endCircle.cy) / 2} r="10" fill="white" stroke="hsl(var(--destructive))" />
                          <XCircle x={(data.startCircle.cx + data.endCircle.cx) / 2 - 8} y={(data.startCircle.cy + data.endCircle.cy) / 2 - 8} size={16} className="text-destructive" />
                      </g>
                    )}
                </g>
            ))}
            {pendingInklingRenderPoint && (
                <circle 
                    cx={pendingInklingRenderPoint.cx} 
                    cy={pendingInklingRenderPoint.cy} 
                    r="5" 
                    fill="hsl(var(--primary))" 
                    stroke="white"
                    strokeWidth="2"
                    className="animate-pulse" 
                />
            )}
          </svg>
        </main>

        <AlertDialog open={isClearConfirmOpen} onOpenChange={setIsClearConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action will clear the entire canvas, including the loaded PDF, all annotations, snapshots, notes, and links. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleConfirmClear}
              >
                Yes, Clear All
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={!!pendingSnapshot} onOpenChange={(isOpen) => { if (!isOpen) setPendingSnapshot(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Choose a Highlight Color</DialogTitle>
              <DialogDescription>
                Select a color for the snapshot's side-bar, or choose no color.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
              {HIGHLIGHT_COLORS.map((color) => (
                <Tooltip key={color}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleColorSelect(color)}
                      className="h-8 w-8 rounded-full border-2 border-transparent transition-all hover:scale-110 hover:border-primary focus:border-primary focus:outline-none"
                      style={{ backgroundColor: color }}
                      aria-label={`Select color ${color}`}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{color.toUpperCase()}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
              <Button variant="outline" onClick={() => handleColorSelect(null)}>
                No Color
              </Button>
            </div>
          </DialogContent>
        </Dialog>

      </div>
    </TooltipProvider>
  );
}
