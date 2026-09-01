import { type ReactElement, type ReactNode, type RefObject } from 'react';
import { type BrowserLayout } from '../managed-browser-protocol.ts';
import type { BrowserDevice } from '../browser.ts';
import type { AnnotationRect } from '../session.ts';
type StreamTicket = {
    path: string;
    expiresAt: number;
};
type ManagedProjection = {
    url: string;
    title: string;
    documentId: string;
    status: 'idle' | 'loading' | 'ready' | 'error' | 'crashed';
    error?: string;
};
type ManagedBrowserCanvasProps = {
    tabId: string;
    active: boolean;
    device: BrowserDevice;
    annotate: boolean;
    selectedRect: AnnotationRect | null;
    selectedSelector: string | null;
    fitContainerRef: RefObject<HTMLElement>;
    requestTicket: (tabId: string) => Promise<StreamTicket | undefined>;
    onPick: (rect: AnnotationRect, anchor: Point, layout: Pick<BrowserLayout, 'revision' | 'mediaGeneration'>) => void | Promise<void>;
    onState: (projection: ManagedProjection) => void;
    children?: ReactNode;
};
type Point = {
    x: number;
    y: number;
};
export declare function ManagedBrowserCanvas({ tabId, active, device, annotate, selectedRect, selectedSelector, fitContainerRef, requestTicket, onPick, onState, children }: ManagedBrowserCanvasProps): ReactElement;
export {};
//# sourceMappingURL=ManagedBrowserCanvas.d.ts.map