/** Read-only ReviewPort: 本轮变更 from the 主会话 log, staged/unstaged from cached git. */
import type { ReviewChange, ReviewPort } from './review.ts';
export declare function createHostReview(opts: {
    cwdOf: () => string;
    turnWrites: () => ReviewChange[];
    isBusy: () => boolean;
}): ReviewPort;
//# sourceMappingURL=host-review.d.ts.map