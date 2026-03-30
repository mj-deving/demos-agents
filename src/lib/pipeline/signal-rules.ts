/**
 * Compatibility entrypoint for signal rules after extracting toolkit math.
 *
 * The implementation remains in signal-detection.ts for now so existing
 * callers and tests keep working through the legacy path.
 */

export * from "./signal-detection.js";
