/**
 * Plugin barrel export — all 20 FrameworkPlugin factory functions.
 *
 * Each plugin wraps an existing extension or capability from the
 * tools/lib layer, exposing it through the FrameworkPlugin interface
 * for registry-based discovery and lifecycle management.
 */

export { createSourcesPlugin } from "./sources-plugin.js";
export { createLifecyclePlugin } from "./lifecycle-plugin.js";
export { createSignalsPlugin } from "./signals-plugin.js";
export { createPredictionsPlugin } from "./predictions-plugin.js";
export { createTipsPlugin } from "./tips-plugin.js";
export { createCalibratePlugin } from "./calibrate-plugin.js";
export { createObservePlugin } from "./observe-plugin.js";
export { createDefiMarketsPlugin } from "./defi-markets-plugin.js";
export { createInfraOpsPlugin } from "./infra-ops-plugin.js";
export { createSCPricesPlugin } from "./sc-prices-plugin.js";
export type { SCDataPluginConfig } from "./sc-prices-plugin.js";
export { createSCOraclePlugin } from "./sc-oracle-plugin.js";
export { createSCPredictionsMarketsPlugin } from "./sc-predictions-markets-plugin.js";
export { createNetworkHealthPlugin } from "./network-health-plugin.js";
export type { NetworkHealthPluginConfig } from "./network-health-plugin.js";
export { createTlsnAttestPlugin } from "./tlsn-attest-plugin.js";
export type { TlsnAttestPluginConfig } from "./tlsn-attest-plugin.js";
export { createChainQueryPlugin } from "./chain-query-plugin.js";
export type { ChainQueryPluginConfig } from "./chain-query-plugin.js";
export { createAddressWatchPlugin } from "./address-watch-plugin.js";
export type { AddressWatchPluginConfig } from "./address-watch-plugin.js";
export { createCCIIdentityPlugin } from "./cci-identity-plugin.js";
export type { CCIIdentityPluginConfig } from "./cci-identity-plugin.js";
export { createDemosWorkPlugin } from "./demoswork-plugin.js";
export type { DemosWorkPluginConfig } from "./demoswork-plugin.js";
export { createSdkSetupPlugin } from "./sdk-setup-plugin.js";
export type { SdkSetupPluginConfig } from "./sdk-setup-plugin.js";
export { createDemosWalletPlugin } from "./demos-wallet-plugin.js";
export type { DemosWalletPluginConfig } from "./demos-wallet-plugin.js";
