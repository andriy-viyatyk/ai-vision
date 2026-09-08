export * from "./types.js";
export * from "./resolver.js";
export * from "./path-parser.js";
export * from "./hint.js";
export * from "./help-search.js";
export * from "./member-suggestion.js";
export * from "./result-shaper.js";
export * from "./argument-validation.js";
export * from "./events.js";
export { errMessage } from "./errors.js";
export * from "./remote-types.js";
export { createRemoteProxy, STALE_REMOTE_SHAPE_MESSAGE } from "./remote-proxy.js";
export type { IRemoteProxyOptions } from "./remote-proxy.js";
export { resolveTimeoutMs } from "./timeout.js";

export const AI_VISION_SCHEMA_VERSION = 1;
export const AI_VISION_VERSION = "1.1.0" as const;
