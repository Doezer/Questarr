import { XMLParser } from "fast-xml-parser";
import type { XMLValue } from "./types.js";
import { escapeXml } from "./utils.js";

/**
 * Shared XML-RPC plumbing for the clients that speak the protocol (NZBGet, rTorrent).
 *
 * Both clients used to carry their own near-identical copy of the value
 * serializer/parser and the methodResponse envelope handling. Keeping one copy
 * means a fix (e.g. a new XML-RPC type) lands in both at once instead of drifting.
 */

/**
 * Parser config for XML-RPC responses: attribute-free parsing, raw text values
 * (no tag-value coercion), `_text` as the text-node name, and the structural
 * elements materialized as arrays so a single-element `<array>`/`<struct>`
 * parses identically to a multi-element one.
 */
export const xmlRpcParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  textNodeName: "_text",
  isArray: (name) => ["member", "data", "value", "param"].includes(name),
});

/** Serializes a JS value into the `<value>` body for an XML-RPC method parameter. */
export function serializeXmlRpcValue(param: unknown): string {
  if (typeof param === "boolean") {
    return `<boolean>${param ? 1 : 0}</boolean>`;
  }
  if (typeof param === "number") {
    return Number.isInteger(param) ? `<int>${param}</int>` : `<double>${param}</double>`;
  }
  if (typeof param === "string") {
    return `<string>${escapeXml(param)}</string>`;
  }
  if (Buffer.isBuffer(param)) {
    return `<base64>${param.toString("base64")}</base64>`;
  }
  if (Array.isArray(param)) {
    const data = param.map((p) => `<value>${serializeXmlRpcValue(p)}</value>`).join("");
    return `<array><data>${data}</data></array>`;
  }
  if (typeof param === "object" && param !== null) {
    const members = Object.entries(param)
      .map(
        ([k, v]) =>
          `<member><name>${escapeXml(k)}</name><value>${serializeXmlRpcValue(v)}</value></member>`
      )
      .join("");
    return `<struct>${members}</struct>`;
  }
  return "";
}

export interface ParseXmlRpcValueOptions {
  /**
   * Some servers return a bare `<value>` with no type tag (spec-wise a string)
   * or an otherwise unrecognized shape. Lenient mode coerces those instead of
   * returning null; NZBGet's tolerant reader needs this, rTorrent's does not.
   */
  lenient?: boolean;
}

// With parseTagValue: false and textNodeName: "_text", values can be wrapped.
const getText = (v: unknown) =>
  v && typeof v === "object" && "_text" in v ? (v as Record<string, unknown>)._text : v;

/** The scalar types of an XML-RPC `<value>`, if it holds one. */
function parseScalar(rec: Record<string, unknown>): { found: boolean; value?: XMLValue } {
  if ("string" in rec) return { found: true, value: getText(rec.string) };
  if ("int" in rec) return { found: true, value: Number.parseInt(getText(rec.int) as string) };
  if ("i4" in rec) return { found: true, value: Number.parseInt(getText(rec.i4) as string) };
  if ("i8" in rec) return { found: true, value: Number.parseInt(getText(rec.i8) as string) };
  if ("double" in rec) {
    return { found: true, value: Number.parseFloat(getText(rec.double) as string) };
  }
  if ("boolean" in rec) {
    const boolVal = getText(rec.boolean);
    return { found: true, value: boolVal == 1 || boolVal === "1" };
  }
  if ("base64" in rec) return { found: true, value: getText(rec.base64) };
  return { found: false };
}

function parseXmlRpcArray(arrayValue: unknown, options: ParseXmlRpcValueOptions): XMLValue {
  const data = (arrayValue as Record<string, unknown>)["data"];
  if (!data) return [];

  const dataBlock = Array.isArray(data) ? data[0] : data;
  if (!dataBlock || typeof dataBlock !== "object" || !("value" in dataBlock)) return [];

  const raw = (dataBlock as Record<string, unknown>).value;
  const values = Array.isArray(raw) ? raw : [raw];
  return (values as unknown[]).map((v: unknown) => parseXmlRpcValue(v, options));
}

function parseXmlRpcStruct(structValue: unknown, options: ParseXmlRpcValueOptions): XMLValue {
  const members = (structValue as Record<string, unknown>)["member"] as Record<string, unknown>[];
  if (!members) return {};

  const result: Record<string, unknown> = {};
  for (const m of members) {
    if (m["name"] && m["value"]) {
      result[getText(m["name"]) as string] = parseXmlRpcValue(m["value"], options);
    }
  }
  return result;
}

/** Converts a parsed `<value>` subtree into its JS equivalent. */
export function parseXmlRpcValue(
  valueObj: unknown,
  options: ParseXmlRpcValueOptions = {}
): XMLValue {
  if (typeof valueObj !== "object" || valueObj === null) {
    return valueObj;
  }

  // Unwrap the value array fast-xml-parser produces for the isArray elements.
  let obj = valueObj;
  if (Array.isArray(obj)) {
    obj = obj[0];
    if (typeof obj !== "object" || obj === null) {
      return obj;
    }
  }

  const rec = obj as Record<string, unknown>;

  const scalar = parseScalar(rec);
  if (scalar.found) return scalar.value;
  if ("array" in rec) return parseXmlRpcArray(rec["array"], options);
  if ("struct" in rec) return parseXmlRpcStruct(rec["struct"], options);

  if (options.lenient) {
    // A `<value>` with no type tag is a string per the XML-RPC spec.
    if ("_text" in rec) return rec._text;
    return String(Object.values(rec)[0]);
  }

  return null;
}

export interface ParseXmlRpcResponseOptions extends ParseXmlRpcValueOptions {
  /** Builds the Error thrown for an XML-RPC `<fault>`; defaults to rTorrent's wording. */
  formatFault?: (fault: Record<string, unknown>) => string;
}

function defaultFormatFault(fault: Record<string, unknown>): string {
  const faultString = fault["faultString"] as string;
  return faultString ? `XML-RPC Fault: ${faultString}` : "XML-RPC Fault occurred";
}

/**
 * Parses a `methodResponse` document into its single return value, throwing on a
 * `<fault>`. Returns null for a response that carries neither.
 */
export function parseXmlRpcResponse(
  xml: string,
  options: ParseXmlRpcResponseOptions = {}
): XMLValue {
  const parsed = xmlRpcParser.parse(xml);

  if (parsed.methodResponse?.fault) {
    const fault = parseXmlRpcValue(parsed.methodResponse.fault.value, options) as Record<
      string,
      unknown
    >;
    throw new Error((options.formatFault ?? defaultFormatFault)(fault));
  }

  if (parsed.methodResponse?.params?.param) {
    const params = parsed.methodResponse.params.param;
    const param = Array.isArray(params) ? params[0] : params;
    if (param?.value) {
      return parseXmlRpcValue(param.value, options);
    }
  }

  return null;
}
