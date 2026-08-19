/** 本轮变更 from a 主会话 log: current or latest unfinished turn's tool writes. */
import type { ReviewChange } from './review.ts';
import type { LogEvent } from './side-chat.ts';
export declare function turnWritesFromSession(snapshot: unknown): ReviewChange[];
export declare function turnWritesFromLog(events: readonly LogEvent[]): ReviewChange[];
export declare function logEventsFromSession(snapshot: unknown): LogEvent[];
//# sourceMappingURL=turn-writes.d.ts.map