/** Paint +N −M after the filename on each 主会话 edit/write tool row. */
import { type OpenHunk, type RowStat } from '../tool-open.ts';
export type ToolRowHunk = Pick<OpenHunk, 'before' | 'after'>;
/** Return the exact transcript hunk bound to one rendered host tool row. */
export declare function hunkForToolRow(row: HTMLElement): ToolRowHunk | undefined;
export declare function decorate(stats: readonly RowStat[], root?: ParentNode): void;
//# sourceMappingURL=tool-stats.d.ts.map