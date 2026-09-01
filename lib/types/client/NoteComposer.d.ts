/** Floating 批注 chip: flip/shift so it stays fully inside the pane. */
import { type ReactElement, type RefObject } from 'react';
export declare function NoteComposer({ containerRef, viewportRef, anchor, value, objectText, placeholder, sendLabel, addLabel, deleteLabel, editing, onChange, onAdd, onSend, onDelete, onDismiss, }: {
    containerRef: RefObject<HTMLElement | null>;
    viewportRef?: RefObject<HTMLElement | null>;
    anchor: {
        x: number;
        y: number;
    };
    value: string;
    objectText?: string;
    placeholder: string;
    sendLabel: string;
    addLabel: string;
    deleteLabel: string;
    editing?: boolean;
    onChange: (text: string) => void;
    onAdd: () => void;
    onSend: () => void;
    onDelete?: () => void;
    onDismiss: () => void;
}): ReactElement;
//# sourceMappingURL=NoteComposer.d.ts.map