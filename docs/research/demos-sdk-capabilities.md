---
type: reference
status: current
verified_against_mcp: 2026-04-02
source: Demos SDK MCP (demosdk_references)
coverage: All SDK modules (344 entries, 421 pages)
mcp_commit: 55a8cbd4
sdk_version: 2.11.5
summary: "Full Demos SDK method signatures for all 12 modules — Demos class, Identities, Escrow, StorageProgram, XMCore, IPFS, Messaging. Replaces MCP lookups."
read_when: ["SDK", "method signature", "identity", "escrow", "storage program", "cross-chain", "xmcore", "IPFS", "messaging", "transfer", "getTransactions", "Demos class"]
use_when: "SDK method signatures, module capabilities, cross-chain, identity, escrow, storage, IPFS"
---

# Demos SDK Capabilities Reference

> **Authoritative local reference — consult this instead of querying MCP.**
> Verified against SDK MCP on 2026-04-02 (commit 55a8cbd4, 421 pages).
> Import: `import { Demos, DemosTransactions } from '@kynesyslabs/demosdk/websdk'`

---

## 1. websdk.Demos — Main SDK Class (33 methods)

### Wallet & Connection

| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| `connect` | `(rpcUrl: string)` | `Promise<boolean>` | Connect to RPC node |
| `connectWallet` | `(masterSeed: string\|Uint8Array, opts?: {algorithm?, dual_sign?})` | `Promise<string>` | Returns address |
| `disconnect` | `()` | `void` | Cleanup |
| `getAddress` | `()` | `string` | Current wallet address |
| `getEd25519Address` | `()` | `string` | Ed25519 address from keypair |
| `newMnemonic` | `()` | `string` | Generate new mnemonic |

### Transactions (3-step pipeline: sign → confirm → broadcast)

| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| `transfer` | `(to: string, amount: number)` | `Promise<Transaction>` | **Signed only.** No memo param |
| `pay` | `(to: string, amount: number)` | `Promise<Transaction>` | Alias for transfer |
| `store` | `(bytes: Uint8Array)` | `Promise<Transaction>` | Binary data storage |
| `sign` | `(tx: Transaction)` | `Promise<Transaction>` | Raw signing |
| `confirm` | `(tx: Transaction)` | `Promise<RPCResponseWithValidityData>` | Gas validation. **txHash is HERE** |
| `broadcast` | `(validityData: RPCResponseWithValidityData)` | `Promise<any>` | Actually submits to network |

**CRITICAL:** `transfer`/`pay`/`store` return signed-but-unsubmitted transactions. You MUST call `confirm()` then `broadcast()`. See `.ai/guides/sdk-interaction-guidelines.md` Rule 1.

### Queries

| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| `getTransactions` | `(start?: number\|"latest", limit?: number)` | `Promise<RawTransaction[]>` | **start = tx index (id), NOT blockNumber!** content is string |
| `getTransactionHistory` | `(address, type?, opts?: {start?, limit?})` | `Promise<Transaction[]>` | Per-address, type-filtered. content is parsed object |
| `getTxByHash` | `(hash: string)` | `Promise<Transaction>` | Single tx lookup, parsed content |
| `getAllTxs` | `()` | `Promise<RawTransaction[]>` | **Deprecated** — use getTransactions |
| `getMempool` | `()` | `Promise<Transaction[]>` | Pending unconfirmed |
| `getAddressInfo` | `(address: string)` | `Promise<AddressInfo>` | balance (BigInt), nonce, tx_list |
| `getAddressNonce` | `(address: string)` | `Promise<number>` | Current nonce for signing |

### Blocks

| Method | Signature | Returns |
|--------|-----------|---------|
| `getLastBlockNumber` | `()` | `Promise<number>` |
| `getLastBlockHash` | `()` | `Promise<string\|null>` |
| `getBlocks` | `(start?: number\|"latest", limit?: number)` | `Promise<Block[]>` |
| `getBlockByNumber` | `(blockNumber: number)` | `Promise<Block>` |
| `getBlockByHash` | `(blockHash: string)` | `Promise<Block>` |

### Signing & Verification

| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| `signMessage` | `(message: string\|Buffer, opts?: {algorithm?})` | `Promise<{type, data}>` | algorithm: SigningAlgorithm |
| `verifyMessage` | `(message: string\|Buffer, signature: string, publicKey: string, opts?)` | `Promise<boolean>` | Verify signed message |
| `generateMuid` | `()` | `string` | Mutable unique ID |

### Network & RPC

| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| `rpcCall` | `(request, isAuth?, retries?, sleepTime?, allowedErrorCodes?)` | `Promise<RPCResponse>` | Direct JSON-RPC 2.0 |
| `nodeCall` | `(message, args?)` | `Promise<any>` | Low-level node communication |
| `call` | `(method, message, data?, extra?, sender?, receiver?)` | `Promise<any>` | Generic RPC method call |
| `getPeerIdentity` | `()` | `Promise<any>` | This node's peer identity |
| `getPeerlist` | `()` | `Promise<any>` | Connected network peers |

### Attestation

| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| `tlsnotary` | `(config?: TLSNotaryConfig)` | `Promise<TLSNotary>` | Discovers notary endpoints from node |

### Static Helpers (websdk.DemosTransactions)

| Method | Signature | Returns |
|--------|-----------|---------|
| `DemosTransactions.store` | `(bytes, demos)` | signed Transaction |
| `DemosTransactions.confirm` | `(tx, demos)` | validity data |
| `DemosTransactions.broadcast` | `(validity, demos)` | broadcast response |
| `DemosTransactions.pay` | `(to, amount, demos)` | signed Transaction |
| `DemosTransactions.empty` | `()` | empty Transaction |

---

## 2. abstraction.Identities (35 methods)

> **Import:** `import { Identities } from '@kynesyslabs/demosdk/abstraction'`
> **WARNING:** Barrel import causes SIGSEGV (NAPI crash). Use direct RPC for reads. Write methods need SDK instance.

### Add Identity

| Method | Signature | Notes |
|--------|-----------|-------|
| `addTwitterIdentity` | `(demos, tweetUrl: \`https://x.com/\${string}/\${string}\`, referralCode?)` | Tweet URL as proof |
| `addGithubIdentity` | `(demos, githubProof: GithubProof, referralCode?)` | |
| `addDiscordIdentity` | `(demos, discordProof: DiscordProof, referralCode?)` | |
| `addTelegramIdentity` | `(demos, telegramAttestation: TelegramSignedAttestation, referralCode?)` | Bot attestation |
| `addWeb2IdentityViaTLSN` | `(demos, context: "github"\|"discord"\|"telegram", proof, recvHash, proofRanges, revealedRecv, username, userId, referralCode?)` | Via TLSNotary |
| `addUnstoppableDomainIdentity` | `(demos, signingAddress, signature, challenge, resolutionData, referralCode?)` | UD domain proof |
| `addNomisIdentity` | `(demos, walletPayload: NomisWalletIdentity)` | Nomis reputation |
| `bindPqcIdentity` | `(demos, algorithms?: PQCAlgorithm[]\|"all")` | Default "all" |
| `inferWeb2Identity` | `(demos, payload: Web2CoreTargetIdentityPayload)` | Generic Web2 |
| `inferXmIdentity` | `(demos, payload: InferFromSignaturePayload, referralCode?)` | Cross-chain |
| `createWeb2ProofPayload` | `(demos)` → `Promise<string>` | Generates proof for web2 linking |

### Lookup Identity

| Method | Signature | Returns |
|--------|-----------|---------|
| `getIdentities` | `(demos, call?: string, address?: string)` | `Promise<RPCResponse>` — all identities |
| `getWeb2Identities` | `(demos, address?)` | `Promise<RPCResponse>` — web2 only |
| `getXmIdentities` | `(demos, address?)` | `Promise<RPCResponse>` — cross-chain only |
| `getUDIdentities` | `(demos, address?)` | `Promise<RPCResponse>` — UD domains |
| `getDemosIdsByTwitter` | `(demos, username, userId?)` | `Promise<Account[]>` |
| `getDemosIdsByGithub` | `(demos, username, userId?)` | `Promise<Account[]>` |
| `getDemosIdsByDiscord` | `(demos, username, userId?)` | `Promise<Account[]>` |
| `getDemosIdsByTelegram` | `(demos, username, userId?)` | `Promise<Account[]>` |
| `getDemosIdsByWeb2Identity` | `(demos, context: "github"\|"twitter"\|"telegram"\|"discord", username, userId?)` | `Promise<Account[]>` |
| `getDemosIdsByWeb3Identity` | `(demos, chain: \`\${string}.\${string}\`, address)` | `Promise<Account[]>` — chain format: "eth.mainnet" |
| `getDemosIdsByIdentity` | `(demos, identity: FindDemosIdByWeb2\|Web3IdentityQuery)` | `Promise<Account[]>` — generic |
| `getUserPoints` | `(demos, address?)` | `Promise<RPCResponseWithValidityData>` |
| `getNomisScore` | `(demos, walletAddress, chain?, subchain?, scoreType?)` | `Promise<RPCResponse>` |
| `getReferralInfo` | `(demos, address?)` | `Promise<RPCResponse>` |
| `resolveUDDomain` | `(demos, domain: string)` | `Promise<UnifiedDomainResolution>` |
| `validateReferralCode` | `(demos, referralCode: string)` | `Promise<RPCResponse>` |

### Remove Identity

| Method | Signature |
|--------|-----------|
| `removeWeb2Identity` | `(demos, {context, username})` |
| `removeWeb2IdentityViaTLSN` | `(demos, context: "github"\|"discord"\|"telegram", username)` |
| `removeXmIdentity` | `(demos, payload: XMCoreTargetIdentityPayload)` |
| `removeUnstoppableDomainIdentity` | `(demos, domain: string)` |
| `removeNomisIdentity` | `(demos, payload: NomisWalletIdentity)` |
| `removePqcIdentity` | `(demos, algorithms?: PQCAlgorithm[]\|"all")` |

---

## 3. escrow.EscrowTransaction (4 static methods)

> **Import:** `import { EscrowTransaction } from '@kynesyslabs/demosdk/escrow'`
> Enables trustless tipping to unclaimed social identities.

| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| `sendToIdentity` | `(demos, platform: "twitter"\|"github"\|"telegram", username, amount: number, opts?: {expiryDays?, message?})` | `Promise<Transaction>` | Creates escrow |
| `claimEscrow` | `(demos, platform, username)` | `Promise<Transaction>` | Recipient must link identity first |
| `refundExpiredEscrow` | `(demos, platform, username)` | `Promise<Transaction>` | Sender reclaims after expiry |
| `getEscrowAddress` | `(platform: string, username: string)` | `string` | Deterministic hex address |

**Flow:** Alice calls `sendToIdentity` → DEM held at deterministic escrow address → Bob calls `addTwitterIdentity` to prove ownership → Bob calls `claimEscrow` → DEM transferred. If unclaimed after `expiryDays` → Alice calls `refundExpiredEscrow`.

**Query escrows:**
- `EscrowQueries.getClaimable(rpcUrl, platform, username)` → `Promise<ClaimableEscrow[]>`
- `EscrowQueries.getSent(rpcUrl, senderAddress)` → `Promise<SentEscrow[]>`
- `EscrowQueries.getBalance(rpcUrl, platform, username)` → `Promise<EscrowBalance>`

---

## 4. storage.StorageProgram (32 static methods)

> **Import:** `import { StorageProgram } from '@kynesyslabs/demosdk/storage'`
> **Status:** RPC returns "Unknown message" / "GCREdit mismatch" on shared nodes (blocked).

### Create & Delete

| Method | Signature | Notes |
|--------|-----------|-------|
| `createStorageProgram` | `(deployerAddress, programName, data: string\|Record, encoding?: "json"\|"binary", acl?: StorageProgramACL, opts?: {nonce, metadata?})` | Returns StorageProgramPayload |
| `deleteStorageProgram` | `(storageAddress)` | Returns payload |
| `deriveStorageAddress` | `(deployerAddress, programName, nonce)` | Deterministic `stor-{sha256}` |
| `calculateStorageFee` | `(data, encoding?)` | `bigint` — 1 DEM per 10KB, min 1 DEM |
| `validateSize` | `(data)` | `boolean` — max 1MB |
| `validateNestingDepth` | `(data, maxDepth?)` | `boolean` |

### Read

| Method | Signature | Notes |
|--------|-----------|-------|
| `readStorage` | `(storageAddress)` | Creates payload for RPC |
| `getValue` | `(rpcUrl, storageAddress, field, identity?)` | Single field value |
| `getItem` | `(rpcUrl, storageAddress, field, index, identity?)` | Array item by index (supports negative) |
| `getFields` | `(rpcUrl, storageAddress, identity?)` | All field names |
| `getFieldType` | `(rpcUrl, storageAddress, field, identity?)` | Field type |
| `hasField` | `(rpcUrl, storageAddress, field, identity?)` | Boolean |
| `getDataSize` | `(rpcUrl, storageAddress, identity?)` | Size in bytes |

### Write

| Method | Signature | Notes |
|--------|-----------|-------|
| `writeStorage` | `(storageAddress, data, encoding?)` | Full overwrite |
| `setField` | `(storageAddress, field, value)` | Set single field (JSON only) |
| `deleteField` | `(storageAddress, field)` | Remove field |
| `setItem` | `(storageAddress, field, index, value)` | Set array item |
| `appendItem` | `(storageAddress, field, value)` | Append to array |
| `deleteItem` | `(storageAddress, field, index)` | Remove array item |

### Discovery

| Method | Signature | Notes |
|--------|-----------|-------|
| `getAll` | `(rpcUrl, opts?)` | List all programs |
| `getByAddress` | `(rpcUrl, storageAddress)` | Single program |
| `getByOwner` | `(rpcUrl, ownerAddress, opts?)` | By owner |
| `searchByName` | `(rpcUrl, nameQuery, opts?: {exactMatch?, limit?, offset?, identity?})` | Partial match search |

### ACL (5 modes)

| Method | Signature | Description |
|--------|-----------|-------------|
| `publicACL` | `()` | Anyone reads, owner writes |
| `privateACL` | `()` | Owner only |
| `restrictedACL` | `(allowedAddresses: string[])` | Owner + approved list |
| `groupACL` | `(groups: Record<string, {members, permissions}>)` | Named groups: `['read','write','delete']` |
| `blacklistACL` | `(blacklistedAddresses: string[])` | Everyone EXCEPT listed |
| `updateAccessControl` | `(storageAddress, acl)` | Change ACL after creation |
| `checkPermission` | `(rpcUrl, storageAddress, address, permission?)` | Verify access |

**Example:**
```typescript
const payload = StorageProgram.createStorageProgram(
  'demos1abc...', 'myConfig',
  { apiKey: 'secret', settings: { theme: 'dark' } },
  'json',
  StorageProgram.groupACL({
    admins: { members: ['demos1admin...'], permissions: ['read', 'write', 'delete'] },
    viewers: { members: ['demos1view...'], permissions: ['read'] }
  }),
  { nonce: 42 }
)
```

---

## 5. XMCore — Cross-Chain Operations (9 chains)

> **Import:** `import { EVM, SOLANA, BTC, ... } from '@kynesyslabs/demosdk/xmcore'`

### Common Interface (all chains)

`connect`, `connectWallet`, `disconnect`, `getAddress`, `getPublicKey`, `getBalance`, `getEmptyTransaction`, `preparePay`, `preparePays`, `prepareTransfer`, `prepareTransfers`, `signMessage`, `verifyMessage`, `signTransaction`, `signTransactions`, `setRpc`

### EVM (27 methods) — Ethereum, Polygon, etc.

| Method | Signature | Notes |
|--------|-----------|-------|
| `readFromContract` | `(contractAddress, abi, method, params?)` | Read smart contract state |
| `writeToContract` | `(contractAddress, abi, method, params?, value?)` | Write to contract |
| `getContractInstance` | `(contractAddress, abi)` | Get ethers.js contract |
| `getTokenBalance` | `(tokenAddress, ownerAddress?)` | ERC-20 balance |
| `isAddress` | `(address)` | Validate EVM address |
| `listenForEvent` | `(contractAddress, abi, eventName, callback)` | Single event listener |
| `listenForAllEvents` | `(contractAddress, abi, callback)` | All events |
| `waitForReceipt` | `(txHash, confirmations?)` | Wait for tx confirmation |
| `createRawTransaction` | `(to, value, data?)` | Raw tx creation |
| `prepareBaseTxWithType` | `(to, value, type?)` | Type 0/2 tx |

### Solana (24 methods)

| Method | Signature | Notes |
|--------|-----------|-------|
| `fetchAccount` | `(publicKey)` | Read account data |
| `runAnchorProgram` | `(programId, idl, method, params?)` | Execute Anchor program |
| `runRawProgram` | `(programId, data, accounts)` | Execute raw program |
| `getProgramIdl` | `(programId)` | Fetch program IDL |
| `createWallet` | `()` | Generate new Solana wallet |

### Bitcoin (BTC)

| Method | Signature | Notes |
|--------|-----------|-------|
| `fetchUTXOs` | `(address)` | Unspent outputs |
| `fetchAllUTXOs` | `(address)` | All UTXOs including spent |
| `getFeeRate` | `()` | Current fee rate |
| `getTxHex` | `(txHash)` | Raw transaction hex |
| `getLegacyAddress` | `()` | Legacy format address |

### Other Chains

| Chain | Unique Methods |
|-------|---------------|
| **TON** | `estimateFee`, `cellsToSendableFile` |
| **NEAR** | `createAccount`, `deleteAccount` |
| **MultiversX** | `getTokenBalance`, `getNFTs`, `connectKeyFileWallet` |
| **TRON** | Basic operations only |
| **XRPL** | Basic operations only |
| **IBC** | Chain-specific via `IBCDefaultChain` |

---

## 6. ipfs.IPFSOperations (14 static methods)

> **Import:** `import { IPFSOperations } from '@kynesyslabs/demosdk/ipfs'`

| Method | Signature | Notes |
|--------|-----------|-------|
| `createAddPayload` | `(content: string\|Buffer\|Uint8Array, opts?: {filename?, metadata?, customCharges?})` | Upload + auto-pin |
| `createPinPayload` | `(cid: string, opts?: {duration?, metadata?, fileSize?, customCharges?})` | Pin existing CID |
| `createUnpinPayload` | `(cid: string)` | Remove pin |
| `encodeContent` | `(content)` → `string` | Base64 encode |
| `decodeContent` | `(base64)` → `Buffer` | Decode |
| `decodeContentAsString` | `(base64, encoding?)` → `string` | Decode to UTF-8 |
| `getContentSize` | `(content)` → `number` | Size in bytes |
| `isValidCID` | `(cid)` → `boolean` | CIDv0 (Qm...) and CIDv1 (bafy...) |
| `isValidContentSize` | `(content)` → `boolean` | Under 2GB limit |
| `isAddPayload` / `isPinPayload` / `isUnpinPayload` | `(payload)` | Type guards |
| `createCustomCharges` | `(quote, operation, durationBlocks?)` | From ipfsQuote response |
| `quoteToCustomCharges` | `(quote)` | Convenience converter |

**Pricing:** Max 2GB per content. Use `customCharges` for cost control.

---

## 7. instantMessaging.MessagingPeer (19 methods)

> **Import:** `import { MessagingPeer } from '@kynesyslabs/demosdk/instant-messaging'`
> E2E encrypted via ml-kem-aes. WebSocket-based P2P.

| Method | Signature | Notes |
|--------|-----------|-------|
| `constructor` | `(config: MessagingPeerConfig)` | Config includes keypair, serverUrl |
| `connect` | `()` → `Promise<void>` | Connect + register |
| `disconnect` | `()` → `void` | Close connection |
| `register` / `registerAndWait` | `()` | Register with signaling server |
| `sendMessage` | `(targetId: string, message: string)` → `Promise<void>` | Send to specific peer |
| `discoverPeers` | `()` → `Promise<string[]>` | List connected peers |
| `requestPublicKey` | `(peerId)` → `Promise<Uint8Array>` | Get peer's public key |
| `awaitResponse` | `(messageType, filterFn?, timeout?: 10000)` → `Promise<T>` | Wait for specific response |
| `sendToServerAndWait` | `(message, expectedType, opts?: {timeout?, retryCount?, filterFn?, errorHandler?})` | Send + await |
| `respondToServer` | `(questionId, response)` | Answer server question |
| `onMessage` | `(handler: MessageHandler)` | Subscribe to messages |
| `onError` | `(handler: ErrorHandler)` | Subscribe to errors |
| `onPeerDisconnected` | `(handler)` | Peer disconnect events |
| `onConnectionStateChange` | `(handler)` | Connection state events |
| `onServerQuestion` | `(handler: (question, questionId) => void)` | Server question events |
| `removeMessageHandler` / `removeErrorHandler` / etc. | `(handler)` | Unsubscribe |

**Message types:** `"message"`, `"error"`, `"register"`, `"discover"`, `"peer_disconnected"`, `"request_public_key"`, `"public_key_response"`, `"server_question"`, `"peer_response"`, `"debug_question"`

---

## 8. Other Modules (summary)

### encryption

| Class | Methods | Use |
|-------|---------|-----|
| `Cryptography` | Key derivation (HKDF), hashing | General crypto |
| `FHE.default` | Fully homomorphic encryption | Compute on encrypted data |
| `PQC.Enigma` | Post-quantum crypto | Quantum-resistant signing |
| `Hashing` | Hash utilities | |
| `UnifiedCrypto` | `getUnifiedCryptoInstance()` | Singleton crypto provider |
| `zK.identity.ZKIdentity` | ZK identity management | Privacy-preserving attestation |
| `zK.identity.CommitmentService` | `generateCommitment`, `generateNullifier`, `generateSecret` | ZK proof prep |
| `zK.identity.ProofGenerator` | `generateIdentityProof`, `verifyProof` | Groth16 ZK-SNARKs |
| `zK.interactive.Prover` / `Verifier` | Interactive ZK proofs | |

### bridge.RubicBridge

`getTrade(params)`, `executeTrade(trade, demos)`, `executeMockTrade(trade)` + `validateChain(chain)`

### demoswork.DemosWork

`DemosWork`, `BaseOperation`, `ConditionalOperation`, `Condition`, `WorkStep`, `NativeWorkStep`, `Web2WorkStep`, `XmWorkStep` + helpers: `prepareDemosWorkPayload`, `prepareNativeStep`, `prepareWeb2Step`, `prepareXMStep`, `runSanityChecks`

### l2ps.L2PS

`L2PS(config: L2PSConfig)` — Layer 2 privacy. **Blocked:** `encryptTx` uses Browser Buffer.

---

## Key Constants

| Constant | Value |
|----------|-------|
| Storage fee | 1 DEM per 10KB, min 1 DEM, max 1MB |
| IPFS max content | 2GB |
| TLSNotary cost | 1 DEM base + 1 DEM/KB |
| Transfer | No memo param. Attribution via SuperColony API |
| Escrow platforms | twitter, github, telegram |
| Escrow options | expiryDays (number), message (string) |
| IM default timeout | 10,000ms |
| Transaction types | 21 types (see `.ai/guides/sdk-rpc-reference.md`) |
