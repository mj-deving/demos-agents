/**
 * Pure asset and macro entity helpers shared across toolkit consumers.
 *
 * These functions intentionally depend only on local lookup tables so they can
 * be reused from provider adapters without reaching back into strategy code.
 */

export const ASSET_MAP: Array<[RegExp, string, string]> = [
  [/\bbitcoin|\bbtc\b/i, "bitcoin", "BTC"],
  [/\bethereum|\beth\b/i, "ethereum", "ETH"],
  [/\bsolana\b|\bSOL\b/, "solana", "SOL"],
  [/\bripple|\bxrp\b/i, "ripple", "XRP"],
  [/\bcardano|\bada\b/i, "cardano", "ADA"],
  [/\bdogecoin|\bdoge\b/i, "dogecoin", "DOGE"],
  [/\bpolkadot\b|\bDOT\b/, "polkadot", "DOT"],
  [/\bavalanche|\bavax\b/i, "avalanche", "AVAX"],
  [/\bchainlink\b|\bLINK\b/, "chainlink", "LINK"],
  [/\bpolygon|\bmatic\b/i, "polygon", "MATIC"],
  [/\buniswap\b|\bUNI\b/, "uniswap", "UNI"],
  [/\blitecoin|\bltc\b/i, "litecoin", "LTC"],
  [/\bcosmos\b|\bATOM\b/, "cosmos", "ATOM"],
  [/\bnear\sprotocol\b|\bNEAR\b/, "near", "NEAR"],
  [/\barbitrum\b|\bARB\b/, "arbitrum", "ARB"],
  [/\boptimism\b|\bOP\b/, "optimism", "OP"],
  [/\baave\b/i, "aave", "AAVE"],
  [/\bmonero|\bxmr\b/i, "monero", "XMR"],
  [/\bfilecoin\b|\bFIL\b/, "filecoin", "FIL"],
  [/\bSUI\b|\bsui\b(?=\s+(?:network|protocol|token|chain|price|trading))/, "sui", "SUI"],
  [/\baptos\b|\bAPT\b/, "aptos", "APT"],
  [/\bimmutable\b|\bimx\b/i, "immutable-x", "IMX"],
  [/\brender\b|\bRNDR\b/, "render-token", "RNDR"],
  [/\bthe\ssandbox\b|\bsand\b/i, "the-sandbox", "SAND"],
  [/\bcurve\b|\bcrv\b/i, "curve-dao-token", "CRV"],
  [/\bmana\b|\bdecentraland\b/i, "decentraland", "MANA"],
];

export const MACRO_ENTITY_MAP: Array<[RegExp, Record<string, string>]> = [
  [/\bgdp\b/i, { series: "GDP", indicator: "NY.GDP.MKTP.CD", asset: "gdp" }],
  [/\bunemployment\b/i, { series: "UNRATE", indicator: "SL.UEM.TOTL.ZS", asset: "unemployment" }],
  [/\binflation\b|\bcpi\b/i, { series: "CPIAUCSL", indicator: "FP.CPI.TOTL.ZG", asset: "inflation" }],
  [/\binterest.?rate\b|\bfed.?funds?\b/i, { series: "FEDFUNDS", asset: "interest-rate" }],
  [/\bmoney.?supply\b|\bm2\b/i, { series: "M2SL", asset: "money-supply" }],
  [/\bnational.?debt\b|\bpublic.?debt\b|\bdebt\b/i, { asset: "debt" }],
  [/\bearthquake\b|\bseismic\b|\bmagnitude\b/i, { asset: "earthquake" }],
  [/\bhousing\b|\bhousing.?starts\b/i, { series: "HOUST", asset: "housing" }],
  [/\bretail.?sales\b/i, { series: "RSXFS", asset: "retail-sales" }],
  [/\bindustrial.?production\b/i, { series: "INDPRO", asset: "industrial-production" }],
  [/\bpopulation\b/i, { indicator: "SP.POP.TOTL", asset: "population" }],
  [/\blife.?expectancy\b/i, { indicator: "SP.DYN.LE00.IN", asset: "life-expectancy" }],
  [/\bco2\b|\bemissions?\b/i, { indicator: "EN.ATM.CO2E.PC", asset: "co2-emissions" }],
  [/\bgini\b|\binequality\b/i, { indicator: "SI.POV.GINI", asset: "gini" }],
  [/\bpoverty\b/i, { indicator: "SI.POV.DDAY", asset: "poverty" }],
];

export function inferMacroEntity(text: string): Record<string, string> | null {
  const normalized = text.toLowerCase();
  for (const [rx, vars] of MACRO_ENTITY_MAP) {
    if (rx.test(normalized)) return vars;
  }
  return null;
}

export function inferAssetAlias(topic: string): { asset: string; symbol: string } | null {
  const normalized = topic.toLowerCase();
  for (const [rx, asset, symbol] of ASSET_MAP) {
    if (rx.test(normalized)) return { asset, symbol };
  }
  return null;
}
