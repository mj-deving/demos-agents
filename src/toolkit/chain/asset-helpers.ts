/**
 * Pure asset and macro entity helpers shared across toolkit consumers.
 *
 * These functions intentionally depend only on local lookup tables so they can
 * be reused from provider adapters without reaching back into strategy code.
 */

export const ASSET_MAP: Array<[RegExp, string, string]> = [
  [/\bbitcoin\b|\bbtc\b/i, "bitcoin", "BTC"],
  [/\bethereum\b|\beth\b/i, "ethereum", "ETH"],
  [/\bsolana\b|\bSOL\b/, "solana", "SOL"],               // "sol" collides with Spanish word
  [/\bripple\b|\bxrp\b/i, "ripple", "XRP"],
  [/\bcardano\b|\bada\b/i, "cardano", "ADA"],
  [/\bdogecoin\b|\bdoge\b/i, "dogecoin", "DOGE"],
  [/\bpolkadot\b|\bDOT\b/, "polkadot", "DOT"],            // "dot" is common English
  [/\bavalanche\b|\bavax\b/i, "avalanche", "AVAX"],
  [/\bchainlink\b|\bLINK\b/, "chainlink", "LINK"],        // "link" is common English
  [/\bpolygon\b|\bmatic\b/i, "polygon", "MATIC"],
  [/\buniswap\b|\bUNI\b/, "uniswap", "UNI"],              // "uni" is common English
  [/\blitecoin\b|\bltc\b/i, "litecoin", "LTC"],
  [/\bcosmos\b|\bATOM\b/, "cosmos", "ATOM"],               // "atom" is common English
  [/\bnear\sprotocol\b|\bNEAR\b/, "near", "NEAR"],        // "near" is common English
  [/\barbitrum\b|\barb\b/i, "arbitrum", "ARB"],            // "arb" is not common English
  [/\boptimism\b|\bOP\b/, "optimism", "OP"],               // "op" is common English
  [/\baave\b/i, "aave", "AAVE"],
  [/\bmonero\b|\bxmr\b/i, "monero", "XMR"],
  [/\bfilecoin\b|\bfil\b/i, "filecoin", "FIL"],           // "fil" is uncommon enough
  [/\bsui\b/i, "sui", "SUI"],                             // "sui" is uncommon enough
  [/\baptos\b|\bapt\b/i, "aptos", "APT"],                 // "apt" could collide but rare in crypto context
  [/\bimmutable\b|\bimx\b/i, "immutable-x", "IMX"],
  [/\brender\b|\brndr\b/i, "render-token", "RNDR"],
  [/\bthe\ssandbox\b|\bsand\b/i, "the-sandbox", "SAND"],
  [/\bcurve\b|\bcrv\b/i, "curve-dao-token", "CRV"],
  [/\bmana\b|\bdecentraland\b/i, "decentraland", "MANA"],
  [/\bbinance\b|\bbnb\b/i, "binancecoin", "BNB"],
  [/\btron\b|\btrx\b/i, "tron", "TRX"],
  [/\bshiba\b|\bshib\b/i, "shiba-inu", "SHIB"],
  [/\btoncoin\b|\bton\b/i, "the-open-network", "TON"],
  [/\bhedera\b|\bhbar\b/i, "hedera-hashgraph", "HBAR"],
  [/\bbitcoin\scash\b|\bbch\b/i, "bitcoin-cash", "BCH"],
  [/\binternet\scomputer\b|\bicp\b/i, "internet-computer", "ICP"],
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
