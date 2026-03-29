// HIVE post prefix (4 bytes: ASCII "HIVE")
export const HIVE_PREFIX = new Uint8Array([0x48, 0x49, 0x56, 0x45]);

const HIVE_PREFIX_HEX = "48495645";
const HIVE_PREFIX_STR = "HIVE";

/** Regex for base64 character set — skip Buffer.from on obvious non-base64 */
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

/** Check if bytes start with the 4-byte HIVE prefix */
export function hasHivePrefix(bytes: Uint8Array): boolean {
  return bytes.length >= 4 &&
    bytes[0] === HIVE_PREFIX[0] && bytes[1] === HIVE_PREFIX[1] &&
    bytes[2] === HIVE_PREFIX[2] && bytes[3] === HIVE_PREFIX[3];
}

/** Encode a JSON payload with HIVE 4-byte prefix for on-chain storage */
export function encodeHivePayload(payload: Record<string, unknown>): Uint8Array {
  const json = JSON.stringify(payload);
  const jsonBytes = new TextEncoder().encode(json);
  const encoded = new Uint8Array(HIVE_PREFIX.length + jsonBytes.length);
  encoded.set(HIVE_PREFIX, 0);
  encoded.set(jsonBytes, HIVE_PREFIX.length);
  return encoded;
}

/**
 * Decode HIVE data from a chain transaction's content.data field.
 * Handles multiple encodings: Uint8Array, hex string, base64, raw string with HIVE prefix.
 * Returns parsed JSON payload or null if not a HIVE transaction.
 */
export function decodeHiveData(data: unknown): Record<string, unknown> | null {
  if (!data) return null;

  let jsonStr: string | null = null;

  if (data instanceof Uint8Array || ArrayBuffer.isView(data)) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array((data as ArrayBufferView).buffer);
    if (bytes.length < 4) return null;
    if (hasHivePrefix(bytes)) {
      jsonStr = new TextDecoder().decode(bytes.slice(4));
    }
  } else if (typeof data === "string") {
    // Hex-encoded: "48495645..." — cap at 64KB to prevent OOM from malicious chain data
    if (data.toLowerCase().startsWith(HIVE_PREFIX_HEX)) {
      const hexPayload = data.slice(8);
      if (hexPayload.length > 128 * 1024) return null; // 64KB decoded limit
      const bytes = new Uint8Array(hexPayload.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? []);
      jsonStr = new TextDecoder().decode(bytes);
    }
    // Raw string with "HIVE" prefix
    else if (data.startsWith(HIVE_PREFIX_STR)) {
      jsonStr = data.slice(4);
    }
    // Base64-encoded HIVE data — only attempt if string matches base64 charset
    else if (BASE64_RE.test(data) && data.length >= 8) {
      try {
        const decoded = Buffer.from(data, "base64");
        if (hasHivePrefix(decoded)) {
          jsonStr = decoded.slice(4).toString("utf-8");
        }
      } catch {
        // Not valid base64
      }
    }
  }
  // TransactionContentData tuple: ["storage", payload] — extract payload
  else if (Array.isArray(data)) {
    if (data.length >= 2 && data[0] === "storage") {
      return decodeHiveData(data[1]); // recurse on the actual payload
    }
    return null;
  }
  // Already-parsed object (from Transaction.content.data that was pre-decoded)
  else if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    // SDK storage envelope: {"bytes":"SElWRXsi..."} — base64-encoded HIVE payload
    if (typeof obj.bytes === "string" && obj.bytes.length >= 8 && obj.bytes.length <= 172 * 1024) {
      // Size guard: base64 at 172KB → ~128KB decoded. Matches hex branch 64KB limit.
      try {
        const decoded = Buffer.from(obj.bytes, "base64");
        if (hasHivePrefix(decoded)) {
          jsonStr = decoded.slice(4).toString("utf-8");
        }
      } catch {
        // Not valid base64
      }
    }
    // Direct HIVE object (pre-decoded)
    else if (obj.v !== undefined && (obj.text !== undefined || obj.action !== undefined)) {
      return obj;
    }
    if (!jsonStr) return null;
  }

  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed === "object" && parsed !== null) return parsed;
    return null;
  } catch {
    return null;
  }
}
