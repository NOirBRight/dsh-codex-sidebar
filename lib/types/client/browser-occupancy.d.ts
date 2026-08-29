/** Select every mounted Browser surface and mark only the active Tab as interactive. */
import type { Tab } from '../session.ts';
export type BrowserSurfaceOccupant = {
    tabId: string;
    active: boolean;
};
/** Keep Browser surfaces mounted across tool Tab switches without retaining closed Tabs. */
export declare function browserSurfaceOccupants(tabs: ReadonlyArray<Pick<Tab, 'id' | 'kind'>>, activeTabId: string | null): BrowserSurfaceOccupant[];
//# sourceMappingURL=browser-occupancy.d.ts.map