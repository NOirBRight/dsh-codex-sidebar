/** Keep IME composition off the async 批注/draft RPC. */
import { isImeKey } from '../ime-key.ts';
export { isImeKey };
export declare function useImeSafeDraft(value: string, onCommit: (text: string) => void): {
    value: string;
    onChange: (text: string) => void;
    onCompositionStart: () => void;
    onCompositionEnd: (text: string) => void;
    flush: () => string;
};
//# sourceMappingURL=ime-draft.d.ts.map