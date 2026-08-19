/** Turn stacked 批注 into human-facing prompt text and model-facing evidence. */
import type { Annotation } from './session.ts';
export declare function formatHumanSend(text: string, attachments: readonly Annotation[]): string;
export declare const formatSend: typeof formatHumanSend;
export declare function formatEvidenceSend(attachments: readonly Annotation[], snippets?: Readonly<Record<string, string>>): string;
export declare function formatDelivery(text: string, sourceTab: string, sourceSession: string): string;
//# sourceMappingURL=send-text.d.ts.map