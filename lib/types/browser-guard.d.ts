/** Cheap URL/title checks so the managed Browser cannot nest DSH Web or sit on Cloudflare PoW. */
export declare const HARNESS_SELF_BLOCK_MESSAGE = "\u62D2\u7EDD\u5728\u6258\u7BA1 Browser \u6253\u5F00 DSH Web \u81EA\u8EAB\uFF0C\u907F\u514D GUI \u5957\u5A03\u7A7A\u8F6C";
export declare const CHALLENGE_BLOCK_MESSAGE = "Cloudflare \u6311\u6218\u9875\u4F1A\u6253\u6EE1 CPU\uFF0C\u5DF2\u505C\u6B62\u52A0\u8F7D";
export declare function harnessSelfBlockReason(url: string): string | undefined;
export declare function isChallengePage(url: string, title: string): boolean;
//# sourceMappingURL=browser-guard.d.ts.map