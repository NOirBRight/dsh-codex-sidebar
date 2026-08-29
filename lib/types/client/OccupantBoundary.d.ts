import { Component, type ErrorInfo, type ReactNode } from 'react';
type OccupantBoundaryProps = {
    children: ReactNode;
    label: string;
    retryLabel: string;
    onRetry?: () => void;
};
type OccupantBoundaryState = {
    message: string | null;
};
/** Catch tool-pane crashes so the details slot does not abdicate to DetailsPanel. */
export declare class OccupantBoundary extends Component<OccupantBoundaryProps, OccupantBoundaryState> {
    state: OccupantBoundaryState;
    static getDerivedStateFromError(error: unknown): OccupantBoundaryState;
    componentDidCatch(error: unknown, info: ErrorInfo): void;
    render(): ReactNode;
}
export {};
//# sourceMappingURL=OccupantBoundary.d.ts.map