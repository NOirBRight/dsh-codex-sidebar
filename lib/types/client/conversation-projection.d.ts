/** Official Alpha4 Chat projection for sidebar transcript consumers. */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client';
import type { ReviewChange } from '../review.ts';
import type { LogEvent } from '../side-chat.ts';
import { type RowHunkStat } from '../tool-open.ts';
export interface ConversationProjection {
    subscribe(listener: () => void): () => void;
    sourceForFlowKey(key: string): unknown;
    rowHunks(): readonly RowHunkStat[];
    turnWrites(): readonly ReviewChange[];
    logEvents(): readonly LogEvent[];
    hunkForOpen(path: string, tool?: string, hunkId?: string): {
        before: string;
        after: string;
    } | undefined;
}
type ConversationProjectionContext = Pick<Context, 'uiConversation'>;
/**
 * Create lazy, independently cached views over one Chat binding.
 * @param ctx - Client context that resolves Chat targets.
 * @param binding - Session binding whose Chat target supplies the snapshot.
 * @returns a projection with semantic invalidation and lazy derived views.
 */
export declare function createConversationProjection(ctx: ConversationProjectionContext, binding: SessionBinding): ConversationProjection;
export {};
//# sourceMappingURL=conversation-projection.d.ts.map