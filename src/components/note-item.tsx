
"use client";

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { X, Expand } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Textarea } from './ui/textarea';

export interface Note {
    id: string;
    content: string;
    x: number;
    y: number;
    width: number;
    height: number;
}
  
interface NoteItemProps {
    note: Note;
    onUpdate: (id: string, newProps: Partial<Omit<Note, 'id'>>) => void;
    onDelete: (id:string) => void;
    onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
    isSelected: boolean;
    containerRef: React.RefObject<HTMLDivElement>;
}

export const NoteItem: React.FC<NoteItemProps> = ({ note, onUpdate, onDelete, onClick, isSelected, containerRef }) => {
    const itemRef = useRef<HTMLDivElement>(null);
    const interactionRef = useRef<{
        type: 'drag' | 'resize';
        startX: number;
        startY: number;
        noteX: number;
        noteY: number;
        noteWidth: number;
        noteHeight: number;
    } | null>(null);
    const isInteractingRef = useRef(false);
    const hasMovedRef = useRef(false);
    const lastPointRef = useRef<{clientX: number, clientY: number} | null>(null);
    
    useEffect(() => {
        if (isInteractingRef.current || !containerRef.current || !itemRef.current) return;
        
        const { id, x, y, width, height } = note;
        const container = containerRef.current;
        const padding = container.clientWidth * 0.01;
        const containerWidth = container.clientWidth - 2 * padding;
        const containerHeight = container.clientHeight - 2 * padding;

        let newX = x;
        let newY = y;
        let newWidth = Math.max(100, width);
        let newHeight = Math.max(100, height);

        if (newWidth > containerWidth) {
          newWidth = containerWidth;
        }
      
        newX = Math.max(0, Math.min(newX, containerWidth - newWidth));
        newY = Math.max(0, Math.min(newY, containerHeight - newHeight));
        
        if (Math.abs(newX - x) > 1 || Math.abs(newY - y) > 1 || Math.abs(newWidth - width) > 1 || Math.abs(newHeight - height) > 1) {
          onUpdate(id, { x: newX, y: newY, width: newWidth, height: newHeight });
        }
      }, [note, containerRef, onUpdate]);

    const getEventPoint = (e: MouseEvent | TouchEvent) => {
        const point = 'touches' in e ? (e.touches[0] || e.changedTouches[0]) : e;
        if (!point) return null;
        return { clientX: point.clientX, clientY: point.clientY };
    };

    const handleInteractionStart = useCallback((e: React.MouseEvent | React.TouchEvent, type: 'drag' | 'resize') => {
        e.stopPropagation();
        if ('button' in e && e.button !== 0) return;

        const point = getEventPoint(e.nativeEvent);
        if (!point || !containerRef.current) return;

        isInteractingRef.current = true;
        hasMovedRef.current = false;
        lastPointRef.current = point;
        
        if(itemRef.current) {
            const rect = itemRef.current.getBoundingClientRect();
            const containerRect = containerRef.current.getBoundingClientRect();
            interactionRef.current = {
                type: type,
                startX: point.clientX,
                startY: point.clientY,
                noteX: rect.left - containerRect.left,
                noteY: rect.top - containerRect.top,
                noteWidth: rect.width,
                noteHeight: rect.height,
            };
        }
    }, [containerRef]);

    const handleBodyClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (hasMovedRef.current) return;
        
        const target = e.target as HTMLElement;
        if(target.closest('[aria-label="Resize note"]') || target.closest('[aria-label="Delete note"]')) {
            return;
        }
        onClick(e);
    }, [onClick]);


    useEffect(() => {
        const handleMove = (e: MouseEvent | TouchEvent) => {
            if (!isInteractingRef.current) return;

            const point = getEventPoint(e);
            if (!point || !interactionRef.current) return;
            
            if (e.cancelable) e.preventDefault();

            if (!hasMovedRef.current) {
                const dx = Math.abs(point.clientX - interactionRef.current.startX);
                const dy = Math.abs(point.clientY - interactionRef.current.startY);
                if (dx > 3 || dy > 3) {
                    hasMovedRef.current = true;
                }
            }

            if (itemRef.current) {
                const dx = point.clientX - interactionRef.current.startX;
                const dy = point.clientY - interactionRef.current.startY;

                if (interactionRef.current.type === 'drag') {
                    const x = interactionRef.current.noteX + dx;
                    const y = interactionRef.current.noteY + dy;
                    itemRef.current.style.transform = `translate(${x}px, ${y}px)`;
                } else if (interactionRef.current.type === 'resize') {
                    const { noteX, noteY, noteWidth, noteHeight } = interactionRef.current;
                    const newWidth = Math.max(100, noteWidth + dx);
                    const newHeight = Math.max(100, noteHeight + dy);

                    itemRef.current.style.transform = `translate(${noteX}px, ${noteY}px)`;
                    itemRef.current.style.width = `${newWidth}px`;
                    itemRef.current.style.height = `${newHeight}px`;
                }
            }
            lastPointRef.current = point;
        };

        const handleEnd = (e: MouseEvent | TouchEvent) => {
            if (!isInteractingRef.current) return;

            const interaction = interactionRef.current;
            if (!interaction) return;

            if (hasMovedRef.current) {
                e.stopPropagation();
                
                const point = lastPointRef.current ?? getEventPoint(e);
                if (!point || !containerRef.current) return;
                
                const dx = point.clientX - interaction.startX;
                const dy = point.clientY - interaction.startY;
                
                const container = containerRef.current;
                const padding = container.clientWidth * 0.01;
                const containerWidth = container.clientWidth - 2 * padding;
                const containerHeight = container.clientHeight - 2 * padding;

                let newX = interaction.noteX;
                let newY = interaction.noteY;
                let newWidth = interaction.noteWidth;
                let newHeight = interaction.noteHeight;

                if (interaction.type === 'drag') {
                    newX += dx;
                    newY += dy;
                } else if (interaction.type === 'resize') {
                    newWidth = Math.max(100, interaction.noteWidth + dx);
                    newHeight = Math.max(100, interaction.noteHeight + dy);
                }
                
                newX = Math.max(0, Math.min(newX, containerWidth - newWidth));
                newY = Math.max(0, Math.min(newY, containerHeight - newHeight));
                
                onUpdate(note.id, { x: newX, y: newY, width: newWidth, height: newHeight });

            } else {
                 if (interaction.type === 'resize') {
                    e.stopPropagation();
                }
            }
            
            if (itemRef.current) {
                itemRef.current.style.transform = `translate(${note.x}px, ${note.y}px)`;
                itemRef.current.style.width = `${note.width}px`;
                itemRef.current.style.height = `${note.height}px`;
            }

            isInteractingRef.current = false;
            interactionRef.current = null;
        };

        document.addEventListener('mousemove', handleMove, { passive: false });
        document.addEventListener('mouseup', handleEnd);
        document.addEventListener('touchmove', handleMove, { passive: false });
        document.addEventListener('touchend', handleEnd, { passive: false });

        return () => {
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleEnd);
            document.removeEventListener('touchmove', handleMove);
            document.removeEventListener('touchend', handleEnd);
        };
    }, [note, onUpdate, containerRef]);


    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onUpdate(note.id, { content: e.target.value });
    };

    return (
        <div
            ref={itemRef}
            style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: note.width,
                height: note.height,
                transform: `translate(${note.x}px, ${note.y}px)`,
                touchAction: 'none'
            }}
            className={cn(
                "shadow-lg bg-yellow-200 rounded-md flex flex-col",
                isSelected ? "z-10" : "z-0",
            )}
            onClick={handleBodyClick}
            data-ai-hint="sticky note"
            data-note-id={note.id}
        >
            <div
                data-drag-handle="true"
                onMouseDown={(e) => handleInteractionStart(e, 'drag')}
                onTouchStart={(e) => handleInteractionStart(e, 'drag')}
                className="h-6 bg-yellow-300 rounded-t-md flex items-center justify-center text-gray-600/70 cursor-grab active:cursor-grabbing"
            >
            </div>
             <div className={cn(
                "w-full h-full flex-grow border-2 rounded-b-md flex flex-col border-t-0 relative",
                isSelected ? "border-blue-500 ring-2 ring-blue-500 ring-inset" : "border-transparent",
            )}>
                <Textarea
                    value={note.content}
                    onChange={handleTextChange}
                    placeholder="Type your note..."
                    className="flex-grow w-full h-full bg-transparent border-0 focus-visible:ring-0 resize-none p-1 text-sm"
                    onMouseDown={(e) => {
                        if (!isSelected) {
                          onClick(e as unknown as React.MouseEvent<HTMLDivElement>);
                        }
                        e.stopPropagation();
                    }}
                    onTouchStart={(e) => {
                        if (!isSelected) {
                            onClick(e as unknown as React.MouseEvent<HTMLDivElement>);
                        }
                        e.stopPropagation();
                    }}
                />
            </div>
            {isSelected && (
                <>
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(note.id);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => { e.stopPropagation(); onDelete(note.id); }}
                        className="absolute -top-3 -right-3 bg-destructive text-destructive-foreground rounded-full p-0.5 z-20 flex items-center justify-center hover:scale-110 transition-transform"
                        aria-label="Delete note"
                    >
                        <X size={14} />
                    </button>
                    <div 
                        onMouseDown={(e) => handleInteractionStart(e, 'resize')}
                        onTouchStart={(e) => handleInteractionStart(e, 'resize')}
                        className={cn(
                            "absolute -bottom-2 -right-2 bg-blue-500 text-white rounded-full p-1 z-20 cursor-se-resize hover:scale-110 transition-transform"
                        )}
                        aria-label="Resize note"
                    >
                        <Expand size={12} />
                    </div>
                </>
            )}
        </div>
    );
}
