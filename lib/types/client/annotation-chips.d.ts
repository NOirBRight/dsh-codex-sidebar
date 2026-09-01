/** Paint 批注 chips under the official user bubble. Does not replace the node renderer. */
import type { Annotation } from '../session.ts';
export type AnnotationChipPorts = {
    sessionId: () => string | undefined;
    nodeSource: (key: string) => unknown;
    reveal: (sessionId: string, mark: Annotation) => void;
    label: (n: number, from: string) => string;
};
export declare function sourceForFlowKey(snapshot: unknown, key: string): unknown;
export declare function decorate(ports: AnnotationChipPorts, root?: ParentNode): void;
//# sourceMappingURL=annotation-chips.d.ts.map