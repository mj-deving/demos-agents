---
summary: Catalog source coverage matrix — assets vs providers, domain tag gaps
read_when: [catalog, coverage, sources, gaps, attestation]
---

# Catalog Coverage Matrix

Snapshot date: 2026-04-08.

This audit uses the current repository state in `config/sources/catalog.json`, which contains **229** sources, not the 232-source planning number cited in Phase 13 notes.

Method:

- Top-50 asset ranks are taken from CoinGecko's market-cap page on 2026-04-08.
- Asset coverage counts only **explicit asset/topic metadata in the catalog**: source `name`, `url`, `topics`, `domainTags`, and `topicAliases`.
- Generic parameterized endpoints such as `coingecko-simple` or `cryptocompare-price` do **not** count as per-asset coverage unless the catalog also names the asset/topic explicitly.
- Coverage includes non-archived rows: `active`, `degraded`, `quarantined`, and `stale`. Provider labels show non-active status when relevant.
- This snapshot is stricter than raw provider capability on purpose; the goal is discoverable catalog coverage for attestation and publish-path routing.

Key findings:

- I found **50 explicit (provider, asset/topic)** pairs intersecting CoinGecko's 2026-04-08 top-50 crypto assets.
- Only **10 of 50** top-50 assets have multi-provider coverage.
- **36 of 50** top-50 assets have **0** explicit providers in the catalog: `BNB`, `TRX`, `FIGR_HELOC`, `USDS`, `WBT`, `HYPE`, `LEO`, `XMR`, `USDE`, `CC`, `XLM`, `ZEC`, `M`, `DAI`, `USD1`, `HBAR`, `PYUSD`, `SUI`, `SHIB`, `RAIN`, `TAO`, `TON`, `WLFI`, `CRO`, `USYC`, `XAUT`, `PAXG`, `BUIDL`, `MNT`, `USDG`, `SKY`, `OKB`, `USDF`, `PI`, `NEAR`, `ASTER`.
- **4 of 50** top-50 assets have only **1** provider: `USDT`, `DOGE`, `BCH`, `LTC`.
- The current top-50 snapshot does **not** include `MATIC` or `ATOM`; those examples are outside the April 8, 2026 market-cap top 50.

## Top 50 Asset Coverage

| Rank | Asset | Symbol | Providers | Provider coverage | Gap |
| --- | --- | --- | --- | --- | --- |
| 1 | Bitcoin | BTC | 8 | `binance-futures`, `blockchain-info`, `blockchair`, `blockstream`, `coinbase`, `cryptocompare`, `deribit`, `mempool (active/degraded)` |  |
| 2 | Ethereum | ETH | 7 | `binance-futures`, `blockchair`, `coinbase`, `coingecko`, `cryptocompare`, `deribit`, `etherscan` |  |
| 3 | Tether | USDT | 1 | `defillama` | **1 provider** |
| 4 | XRP | XRP | 3 | `binance`, `blockchair`, `coingecko (quarantined)` |  |
| 5 | BNB | BNB | 0 | — | **0 providers** |
| 6 | USDC | USDC | 2 | `defillama`, `dexscreener` |  |
| 7 | Solana | SOL | 8 | `binance`, `binance-futures`, `blockchair (degraded)`, `coinbase`, `coingecko (active/quarantined)`, `cryptocompare`, `deribit (degraded)`, `kraken` |  |
| 8 | TRON | TRX | 0 | — | **0 providers** |
| 9 | Figure Heloc | FIGR_HELOC | 0 | — | **0 providers** |
| 10 | Dogecoin | DOGE | 1 | `blockchair` | **1 provider** |
| 11 | USDS | USDS | 0 | — | **0 providers** |
| 12 | WhiteBIT Coin | WBT | 0 | — | **0 providers** |
| 13 | Cardano | ADA | 5 | `binance`, `coinbase`, `coingecko`, `cryptocompare`, `kraken` |  |
| 14 | Hyperliquid | HYPE | 0 | — | **0 providers** |
| 15 | LEO Token | LEO | 0 | — | **0 providers** |
| 16 | Bitcoin Cash | BCH | 1 | `blockchair` | **1 provider** |
| 17 | Chainlink | LINK | 3 | `binance`, `coinbase`, `coingecko (quarantined)` |  |
| 18 | Monero | XMR | 0 | — | **0 providers** |
| 19 | Ethena USDe | USDE | 0 | — | **0 providers** |
| 20 | Canton | CC | 0 | — | **0 providers** |
| 21 | Stellar | XLM | 0 | — | **0 providers** |
| 22 | Zcash | ZEC | 0 | — | **0 providers** |
| 23 | MemeCore | M | 0 | — | **0 providers** |
| 24 | Dai | DAI | 0 | — | **0 providers** |
| 25 | USD1 | USD1 | 0 | — | **0 providers** |
| 26 | Litecoin | LTC | 1 | `blockchair` | **1 provider** |
| 27 | Hedera | HBAR | 0 | — | **0 providers** |
| 28 | Avalanche | AVAX | 3 | `binance`, `coinbase`, `coingecko (quarantined)` |  |
| 29 | PayPal USD | PYUSD | 0 | — | **0 providers** |
| 30 | Sui | SUI | 0 | — | **0 providers** |
| 31 | Shiba Inu | SHIB | 0 | — | **0 providers** |
| 32 | Rain | RAIN | 0 | — | **0 providers** |
| 33 | Bittensor | TAO | 0 | — | **0 providers** |
| 34 | Toncoin | TON | 0 | — | **0 providers** |
| 35 | World Liberty Financial | WLFI | 0 | — | **0 providers** |
| 36 | Cronos | CRO | 0 | — | **0 providers** |
| 37 | Circle USYC | USYC | 0 | — | **0 providers** |
| 38 | Tether Gold | XAUT | 0 | — | **0 providers** |
| 39 | PAX Gold | PAXG | 0 | — | **0 providers** |
| 40 | BlackRock USD Institutional Digital Liquidity Fund | BUIDL | 0 | — | **0 providers** |
| 41 | Mantle | MNT | 0 | — | **0 providers** |
| 42 | Polkadot | DOT | 5 | `binance`, `coinbase`, `coingecko (quarantined)`, `cryptocompare`, `kraken` |  |
| 43 | Uniswap | UNI | 2 | `coinbase`, `defillama` |  |
| 44 | Global Dollar | USDG | 0 | — | **0 providers** |
| 45 | Sky | SKY | 0 | — | **0 providers** |
| 46 | OKB | OKB | 0 | — | **0 providers** |
| 47 | Falcon USD | USDF | 0 | — | **0 providers** |
| 48 | Pi Network | PI | 0 | — | **0 providers** |
| 49 | NEAR Protocol | NEAR | 0 | — | **0 providers** |
| 50 | Aster | ASTER | 0 | — | **0 providers** |

## Domain Coverage vs Session 84-88 Gap Areas

| Gap area | Matching catalog domain tags | Non-archived sources | Providers | Coverage | Notes |
| --- | --- | --- | --- | --- | --- |
| crypto | `bitcoin`, `blockchain`, `crypto`, `derivatives`, `ethereum`, `exchange`, `on-chain`, `prices`, `solana`, `stablecoins` | 89 | 16 | Good | Deepest area by source count and provider diversity, but still sparse across many top-50 assets. |
| defi | `defi`, `dex`, `l2`, `protocol-analysis`, `stablecoins`, `tvl`, `yields` | 18 | 2 | Moderate | Strong protocol/TVL coverage but concentrated in DefiLlama and DEX data; weak long-tail token coverage. |
| macro | `currency`, `economics`, `financial-markets`, `forex`, `government`, `labor`, `macro` | 10 | 5 | Moderate | Enough for headline macro posts, but provider diversity is much thinner than crypto. |
| governance | `government`, `regulatory-shifts`, `trade-sanctions` | 3 | 2 | Bare | No explicit `governance` tag; surviving coverage is mostly indirect government or sanctions news. |
| ai | `ai`, `ai-policy`, `ai-tools`, `emerging-tech`, `frontier-science`, `research` | 14 | 4 | Moderate | Discovery coverage exists through HN, GitHub, arXiv, and PubMed, but primary-source policy coverage is thin. |
| regulatory | `government`, `regulatory-shifts`, `trade-sanctions` | 3 | 2 | Bare | Exact `regulatory` coverage is archived; active rows are mostly HN-derived shift signals, not primary regulators. |

## All Unique domainTags

| domainTag | Catalog rows | Non-archived rows |
| --- | --- | --- |
| `abuse` | 1 | 0 |
| `activity` | 1 | 1 |
| `address` | 2 | 1 |
| `ai` | 2 | 2 |
| `ai-policy` | 3 | 3 |
| `ai-tools` | 1 | 1 |
| `air-quality` | 1 | 0 |
| `alerts` | 1 | 0 |
| `apps` | 1 | 0 |
| `asteroids` | 1 | 0 |
| `balance` | 1 | 1 |
| `bgp` | 2 | 0 |
| `biology` | 1 | 0 |
| `biotech` | 1 | 1 |
| `bitcoin` | 10 | 6 |
| `blockchain` | 6 | 6 |
| `blocks` | 1 | 1 |
| `bls` | 1 | 0 |
| `bonds` | 1 | 0 |
| `books` | 2 | 1 |
| `breaches` | 1 | 0 |
| `census` | 1 | 0 |
| `chains` | 1 | 1 |
| `charts` | 1 | 1 |
| `chemicals` | 1 | 1 |
| `citations` | 2 | 0 |
| `climate` | 4 | 0 |
| `collectibles` | 2 | 2 |
| `community` | 1 | 0 |
| `company` | 1 | 0 |
| `containers` | 2 | 0 |
| `copernicus` | 1 | 0 |
| `cross-domain` | 5 | 5 |
| `crypto` | 90 | 81 |
| `currency` | 2 | 2 |
| `data` | 1 | 0 |
| `defi` | 19 | 18 |
| `demographics` | 1 | 0 |
| `derivatives` | 9 | 9 |
| `derivatives-expert` | 1 | 1 |
| `derivatives-market` | 1 | 1 |
| `development` | 2 | 2 |
| `dex` | 9 | 3 |
| `discussions` | 1 | 1 |
| `dns` | 2 | 0 |
| `docker` | 2 | 0 |
| `downloads` | 2 | 0 |
| `earthquakes` | 2 | 2 |
| `ecb` | 1 | 0 |
| `economics` | 13 | 6 |
| `emerging-tech` | 9 | 8 |
| `employment` | 1 | 0 |
| `energy-transition` | 1 | 1 |
| `environment` | 2 | 0 |
| `epa` | 1 | 0 |
| `ethereum` | 4 | 3 |
| `eu` | 2 | 0 |
| `exchange` | 23 | 23 |
| `exchange-rates` | 1 | 0 |
| `fed` | 2 | 0 |
| `fees` | 1 | 1 |
| `filings` | 2 | 0 |
| `finance` | 6 | 2 |
| `financial-markets` | 2 | 2 |
| `forecast` | 1 | 0 |
| `forex` | 4 | 2 |
| `frontier-science` | 4 | 4 |
| `fundamentals` | 1 | 1 |
| `futures` | 7 | 7 |
| `gas` | 1 | 1 |
| `geography` | 2 | 1 |
| `geolocation` | 3 | 1 |
| `geophysics` | 2 | 2 |
| `geopolitical` | 1 | 1 |
| `geopolitics` | 1 | 1 |
| `github` | 5 | 5 |
| `global` | 2 | 0 |
| `golang` | 1 | 0 |
| `government` | 3 | 1 |
| `historical` | 2 | 1 |
| `hn` | 5 | 5 |
| `homebrew` | 2 | 0 |
| `imf` | 1 | 0 |
| `infrastructure` | 11 | 3 |
| `intraday` | 1 | 1 |
| `java` | 1 | 0 |
| `javascript` | 3 | 1 |
| `knowledge` | 3 | 3 |
| `l2` | 1 | 1 |
| `labor` | 3 | 2 |
| `legislation` | 1 | 0 |
| `lobsters` | 2 | 0 |
| `macos` | 2 | 0 |
| `macro` | 14 | 9 |
| `market-overview` | 1 | 1 |
| `markets` | 1 | 1 |
| `medical` | 2 | 1 |
| `mempool` | 2 | 1 |
| `mining` | 2 | 1 |
| `nasa` | 2 | 1 |
| `network` | 2 | 1 |
| `networking` | 2 | 0 |
| `news` | 7 | 5 |
| `nft` | 2 | 2 |
| `noaa` | 1 | 0 |
| `npm` | 3 | 1 |
| `oecd` | 1 | 0 |
| `oil` | 1 | 1 |
| `on-chain` | 7 | 7 |
| `open-access` | 1 | 0 |
| `packages` | 5 | 0 |
| `population` | 1 | 0 |
| `prediction` | 1 | 1 |
| `preprints` | 1 | 0 |
| `prices` | 51 | 51 |
| `privacy` | 1 | 0 |
| `products` | 1 | 0 |
| `projects` | 1 | 1 |
| `protocol-analysis` | 1 | 1 |
| `publications` | 1 | 0 |
| `pulse` | 1 | 1 |
| `pypi` | 1 | 1 |
| `python` | 2 | 1 |
| `q-and-a` | 1 | 1 |
| `quantum` | 3 | 3 |
| `reddit` | 4 | 1 |
| `reference` | 9 | 5 |
| `regulatory` | 1 | 0 |
| `regulatory-shifts` | 2 | 2 |
| `releases` | 1 | 1 |
| `remx` | 1 | 1 |
| `research` | 7 | 2 |
| `risk` | 1 | 1 |
| `robotics` | 1 | 1 |
| `rust` | 2 | 0 |
| `scanning` | 1 | 0 |
| `science` | 12 | 5 |
| `search` | 4 | 2 |
| `sec` | 2 | 0 |
| `security` | 3 | 0 |
| `sentiment` | 4 | 2 |
| `social` | 4 | 1 |
| `software` | 21 | 8 |
| `solana` | 4 | 2 |
| `space` | 3 | 2 |
| `stablecoins` | 2 | 2 |
| `stackoverflow` | 2 | 1 |
| `statistics` | 1 | 0 |
| `stocks` | 2 | 2 |
| `story` | 2 | 2 |
| `structured-data` | 1 | 1 |
| `supply` | 1 | 0 |
| `swap` | 2 | 0 |
| `tech` | 8 | 5 |
| `testing` | 1 | 0 |
| `time` | 2 | 0 |
| `timezone` | 2 | 0 |
| `tokens` | 4 | 3 |
| `trade-sanctions` | 1 | 1 |
| `trading` | 3 | 0 |
| `transactions` | 1 | 0 |
| `transfers` | 1 | 1 |
| `treasury` | 1 | 0 |
| `trending` | 3 | 2 |
| `trends` | 1 | 0 |
| `trivia` | 1 | 0 |
| `tvl` | 6 | 6 |
| `twitter` | 1 | 1 |
| `twitter-pulse` | 1 | 1 |
| `uk` | 1 | 0 |
| `uptime` | 1 | 1 |
| `us` | 1 | 0 |
| `usds` | 1 | 1 |
| `versions` | 1 | 0 |
| `volume` | 2 | 2 |
| `weather` | 4 | 0 |
| `windows` | 1 | 0 |
| `yields` | 1 | 1 |
