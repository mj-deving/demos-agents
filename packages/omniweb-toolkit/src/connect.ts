import type { ConnectOptions, OmniWeb } from "./colony.js";

/**
 * Load the heavy runtime only when connect() is called.
 *
 * This keeps the package barrel importable in plain Node ESM even when the
 * Demos SDK's websdk entrypoint is not.
 */
export async function connect(opts?: ConnectOptions): Promise<OmniWeb> {
  try {
    const mod = await import("./colony.js");
    return mod.connect(opts);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_UNSUPPORTED_DIR_IMPORT" &&
      error.message.includes("@kynesyslabs/demosdk")
    ) {
      throw new Error(
        "connect() reached an incompatible @kynesyslabs/demosdk ESM import path. " +
          "Importing omniweb-toolkit itself is safe, but running wallet-backed runtime code " +
          "currently requires tsx or another loader/bundler that can resolve the SDK correctly.",
        { cause: error },
      );
    }
    throw error;
  }
}

export type { ConnectOptions, OmniWeb } from "./colony.js";
