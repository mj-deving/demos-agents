/**
 * supercolony-toolkit — main entry point.
 *
 * Usage:
 *   import { connect } from "supercolony-toolkit";
 *   const colony = await connect();
 *   const feed = await colony.hive.getFeed({ limit: 10 });
 *   const signals = await colony.toolkit.intelligence.getSignals();
 */

export { connect } from "./colony.js";
export type { Colony, ConnectOptions } from "./colony.js";
export type { HiveAPI } from "./hive.js";
export type { Toolkit } from "../../../src/toolkit/primitives/types.js";
