/**
 * Connectors module — SDK isolation layer.
 *
 * Isolates the Demos SDK behind a typed interface so core/ modules
 * never depend on @kynesyslabs/demosdk directly. Platform modules
 * use these connectors to bridge core logic to the Demos chain.
 */

// Re-export SDK types that other modules need
export { Demos, DemosTransactions } from "@kynesyslabs/demosdk/websdk";

// SDK connection factory
export { connectWallet, loadMnemonic, getRpcUrl, getApiUrl } from "../src/lib/network/sdk.js";
