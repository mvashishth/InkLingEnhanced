
"use client";

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { X, Expand } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Snapshot {
    id: string;
    imageDataUrl: string;
    x: number;
    y: number;
    width: number;
    height: number;
    sourcePage: number;
    sourceRect: { x: number; y: number; width: number; height: number };
}
  
interface SnapshotItemProps {
    snapshot: Snapshot;
    onUpdate: (id: string, newProps: Partial<Omit<Snapshot, 'id'>>) => void;
    onDelete: (id:string) => void;
    onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
    isSelected: boolean;
    onSelect: () => void;
    containerRef: React.RefObject<HTMLDivElement>;
}

export const SnapshotItem: React.FC<SnapshotItemProps> = ({ snapshot, onUpdate, onDelete, onClick, isSelected, onSelect, containerRef }) => {
    const itemRef = useRef<HTMLDivElement>(null);
    const interactionRef = useRef<{
        type: 'drag' | 'resize';
        startX: number;
        startY: number;
        snapshotX: number;
        snapshotY: number;
        snapshotWidth: number;
        snapshotHeight: number;
    } | null>(null);
    const isInteractingRef = useRef(false);
    const hasMovedRef = useRef(false);
    const lastPointRef = useRef<{clientX: number, clientY: number} | null>(null);

    useEffect(() => {
        if (isInteractingRef.current || !containerRef.current) return;
      
        const { id, x, y, width, height } = snapshot;
        const container = containerRef.current;
      
        const padding = container.clientWidth * 0.01;
        const containerWidth = container.clientWidth - 2 * padding;
        const containerHeight = container.clientHeight - 2 * padding;
      
        let newX = x;
        let newY = y;
        let newWidth = width;
        let newHeight = height;
        
        const aspectRatio = width > 0 && height > 0 ? height / width : 1;
        
        if (newWidth > containerWidth) {
          newWidth = containerWidth * 0.7;
          newHeight = newWidth * aspectRatio;
        }

        if (newHeight > containerHeight) {
            newHeight = containerHeight;
            newWidth = newHeight / aspectRatio;
        }
      
        newX = Math.max(0, Math.min(newX, containerWidth - newWidth));
        newY = Math.max(0, Math.min(newY, containerHeight - newHeight));
      
        if (Math.abs(newX - x) > 1 || Math.abs(newY - y) > 1 || Math.abs(newWidth - width) > 1 || Math.abs(newHeight - height) > 1) {
          onUpdate(id, { x: newX, y: newY, width: newWidth, height: newHeight });
        }
      }, [snapshot, containerRef, onUpdate]);

    const getEventPoint = (e: MouseEvent | TouchEvent) => {
        const point = 'touches' in e ? (e.touches[0] || e.changedTouches[0]) : e;
        if (!point) return null;
        return { clientX: point.clientX, clientY: point.clientY };
    };

    const handleInteractionStart = useCallback((e: React.MouseEvent | React.TouchEvent, type: 'drag' | 'resize') => {
        if (!containerRef.current) return;
        e.stopPropagation();
        if ('button' in e && e.button !== 0) return;

        const point = getEventPoint(e.nativeEvent);
        if (!point) return;

        isInteractingRef.current = true;
        hasMovedRef.current = false;
        lastPointRef.current = point;
        
        const rect = itemRef.current!.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();

        interactionRef.current = {
            type: type,
            startX: point.clientX,
            startY: point.clientY,
            snapshotX: rect.left - containerRect.left,
            snapshotY: rect.top - containerRect.top,
            snapshotWidth: rect.width,
            snapshotHeight: rect.height,
        };
    }, [containerRef]);

    const handleBodyClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (hasMovedRef.current) return;
        
        if ((e.target as HTMLElement).closest('[aria-label="Resize snapshot"]') || (e.target as HTMLElement).closest('[aria-label="Delete snapshot"]')) {
            return;
        }

        onSelect();
        onClick(e);
    }, [onSelect, onClick]);

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
                    const x = interactionRef.current.snapshotX + dx;
                    const y = interactionRef.current.snapshotY + dy;
                    itemRef.current.style.transform = `translate(${x}px, ${y}px)`;
                } else if (interactionRef.current.type === 'resize') {
                    const { snapshotWidth, snapshotHeight } = interactionRef.current;
                    const aspectRatio = snapshotHeight > 0 && snapshotWidth > 0 ? snapshotHeight / snapshotWidth : 1;
                    const newWidth = Math.max(50, snapshotWidth + dx);
                    const newHeight = newWidth * aspectRatio;

                    const x = interactionRef.current.snapshotX;
                    const y = interactionRef.current.snapshotY;
                    itemRef.current.style.transform = `translate(${x}px, ${y}px)`;
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

                let newX = interaction.snapshotX;
                let newY = interaction.snapshotY;
                let newWidth = interaction.snapshotWidth;
                let newHeight = interaction.snapshotHeight;
                const aspectRatio = interaction.snapshotHeight > 0 && interaction.snapshotWidth > 0 
                        ? interaction.snapshotHeight / interaction.snapshotWidth 
                        : 1;

                if (interaction.type === 'drag') {
                    newX += dx;
                    newY += dy;
                } else if (interaction.type === 'resize') {
                    newWidth = Math.max(50, interaction.snapshotWidth + dx);
                    newHeight = newWidth * aspectRatio;
                }

                if (newWidth > containerWidth) {
                    newWidth = containerWidth * 0.7;
                    newHeight = newWidth * aspectRatio;
                }
                
                newX = Math.max(0, Math.min(newX, containerWidth - newWidth));
                newY = Math.max(0, Math.min(newY, containerHeight - newHeight));
                
                onUpdate(snapshot.id, { x: newX, y: newY, width: newWidth, height: newHeight });

            } else {
                if (interaction.type === 'resize') {
                    e.stopPropagation();
                }
            }

            if (itemRef.current) {
                itemRef.current.style.transform = `translate(${snapshot.x}px, ${snapshot.y}px)`;
                itemRef.current.style.width = `${snapshot.width}px`;
                itemRef.current.style.height = `${snapshot.height}px`;
            }

            isInteractingRef.current = false;
            interactionRef.current = null;
        };

        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleEnd);
        document.addEventListener('touchmove', handleMove, { passive: false });
        document.addEventListener('touchend', handleEnd, { passive: false });

        return () => {
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleEnd);
            document.removeEventListener('touchmove', handleMove);
            document.removeEventListener('touchend', handleEnd);
        };
    }, [snapshot, onUpdate, containerRef]);


    return (
        <div
            ref={itemRef}
            style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: snapshot.width,
                height: snapshot.height,
                transform: `translate(${snapshot.x}px, ${snapshot.y}px)`,
                touchAction: 'none'
            }}
            className={cn(
                "shadow-lg",
                isSelected ? "z-10" : "z-0",
            )}
            onMouseDown={(e) => handleInteractionStart(e, 'drag')}
            onTouchStart={(e) => handleInteractionStart(e, 'drag')}
            onClick={handleBodyClick}
            data-ai-hint="pdf snapshot"
            data-snapshot-id={snapshot.id}
        >
             <div className={cn(
                "w-full h-full border-2",
                isSelected ? "border-blue-500 ring-2 ring-blue-500" : "border-transparent hover:border-blue-500/50",
            )}>
                <img
                    src={snapshot.imageDataUrl}
                    alt="Snapshot from PDF"
                    className="w-full h-full object-cover pointer-events-none"
                    draggable="false"
                />
            </div>
            {isSelected && (
                <>
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(snapshot.id);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => { e.stopPropagation(); onDelete(snapshot.id); }}
                        className="absolute -top-3 -right-3 bg-destructive text-destructive-foreground rounded-full p-0.5 z-20 flex items-center justify-center hover:scale-110 transition-transform"
                        aria-label="Delete snapshot"
                    >
                        <X size={14} />
                    </button>
                    <div 
                        onMouseDown={(e) => handleInteractionStart(e, 'resize')}
                        onTouchStart={(e) => handleInteractionStart(e, 'resize')}
                        className={cn(
                            "absolute -bottom-2 -right-2 bg-blue-500 text-white rounded-full p-1 z-20 cursor-nwse-resize hover:scale-110 transition-transform"
                        )}
                        aria-label="Resize snapshot"
                    >
                        <Expand size={12} />
                    </div>
                </>
            )}
        </div>
    );
}
