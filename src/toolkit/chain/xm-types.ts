export type ChainFamily = "evm" | "solana" | "btc" | "ton" | "near" | "ibc";

export interface ChainId {
  family: ChainFamily;
  network: string;
  rpcUrl?: string;
}

export interface ChainProvenance {
  chainId: string;
  blockNumber: number | null;
  contractAddress: string | null;
  method: string;
  args: unknown[];
  timestamp: string;
}

export interface ChainReadResult {
  success: boolean;
  data: unknown;
  provenance: ChainProvenance | null;
  error?: string;
}

export interface ChainAdapter {
  family: ChainFamily;
  connect(rpcUrl: string): Promise<void>;
  readContract(address: string, abi: unknown, fn: string, args: unknown[]): Promise<unknown>;
  getBalance(address: string): Promise<string>;
  getBlockNumber(): Promise<number>;
  disconnect(): void;
}

export interface MockChainAdapterReadCall {
  address: string;
  abi: unknown;
  fn: string;
  args: unknown[];
}

export interface MockChainAdapterOptions {
  family?: ChainFamily;
  connectHandler?: (rpcUrl: string) => Promise<void> | void;
  readContractHandler?: (
    address: string,
    abi: unknown,
    fn: string,
    args: unknown[],
  ) => Promise<unknown> | unknown;
  readContractResult?: unknown;
  readContractError?: Error | string;
  getBalanceHandler?: (address: string) => Promise<string> | string;
  getBalanceResult?: string;
  getBalanceError?: Error | string;
  getBlockNumberHandler?: () => Promise<number> | number;
  getBlockNumberResult?: number;
  getBlockNumberError?: Error | string;
  disconnectHandler?: () => void;
}

function toError(error: Error | string): Error {
  return typeof error === "string" ? new Error(error) : error;
}

export class MockChainAdapter implements ChainAdapter {
  public readonly family: ChainFamily;
  public readonly connections: string[] = [];
  public readonly readContractCalls: MockChainAdapterReadCall[] = [];
  public readonly balanceCalls: string[] = [];
  public blockNumberCalls = 0;

  private connected = false;
  private readonly options: MockChainAdapterOptions;

  public constructor(options: MockChainAdapterOptions = {}) {
    this.family = options.family ?? "evm";
    this.options = options;
  }

  public get isConnected(): boolean {
    return this.connected;
  }

  public async connect(rpcUrl: string): Promise<void> {
    this.connected = true;
    this.connections.push(rpcUrl);
    await this.options.connectHandler?.(rpcUrl);
  }

  public async readContract(
    address: string,
    abi: unknown,
    fn: string,
    args: unknown[],
  ): Promise<unknown> {
    this.readContractCalls.push({ address, abi, fn, args });

    if (this.options.readContractError) {
      throw toError(this.options.readContractError);
    }

    if (this.options.readContractHandler) {
      return this.options.readContractHandler(address, abi, fn, args);
    }

    return this.options.readContractResult ?? null;
  }

  public async getBalance(address: string): Promise<string> {
    this.balanceCalls.push(address);

    if (this.options.getBalanceError) {
      throw toError(this.options.getBalanceError);
    }

    if (this.options.getBalanceHandler) {
      return this.options.getBalanceHandler(address);
    }

    return this.options.getBalanceResult ?? "0";
  }

  public async getBlockNumber(): Promise<number> {
    this.blockNumberCalls += 1;

    if (this.options.getBlockNumberError) {
      throw toError(this.options.getBlockNumberError);
    }

    if (this.options.getBlockNumberHandler) {
      return this.options.getBlockNumberHandler();
    }

    return this.options.getBlockNumberResult ?? 0;
  }

  public disconnect(): void {
    this.connected = false;
    this.options.disconnectHandler?.();
  }
}
