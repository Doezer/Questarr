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

  for (const [tag, convert] of Object.entries(SCALAR_PARSERS)) {
    if (tag in rec) return convert(getText(rec[tag]));
  }
  if ("array" in rec) return parseXmlRpcArray(rec["array"], options);
  if ("struct" in rec) return parseXmlRpcStruct(rec["struct"], options);

  if (options.lenient) {
    // A `<value>` with no type tag is a string per the XML-RPC spec.
    if ("_text" in rec) return rec._text;
    return String(Object.values(rec)[0]);
  }

  return null;
}

// With parseTagValue: false and textNodeName: "_text", values can be wrapped.
function getText(v: unknown): unknown {
  return v && typeof v === "object" && "_text" in v ? (v as Record<string, unknown>)._text : v;
}

const SCALAR_PARSERS: Record<string, (text: unknown) => XMLValue> = {
  string: (t) => t,
  int: (t) => Number.parseInt(t as string),
  i4: (t) => Number.parseInt(t as string),
  i8: (t) => Number.parseInt(t as string),
  double: (t) => Number.parseFloat(t as string),
  boolean: (t) => t == 1 || t === "1",
  base64: (t) => t,
};

function parseXmlRpcArray(array: unknown, options: ParseXmlRpcValueOptions): XMLValue {
  const data = (array as Record<string, unknown>)["data"];
  if (!data) return [];

  const dataBlock = Array.isArray(data) ? data[0] : data;
  if (!dataBlock || typeof dataBlock !== "object" || !("value" in dataBlock)) return [];

  const value = (dataBlock as Record<string, unknown>).value;
  const values = Array.isArray(value) ? value : [value];
  return (values as unknown[]).map((v: unknown) => parseXmlRpcValue(v, options));
}

function parseXmlRpcStruct(struct: unknown, options: ParseXmlRpcValueOptions): XMLValue {
  const members = (struct as Record<string, unknown>)["member"] as
    Record<string, unknown>[] | undefined;
  if (!members) return {};

  const result: Record<string, unknown> = {};
  for (const m of members) {
    if (m["name"] && m["value"]) {
      result[getText(m["name"]) as string] = parseXmlRpcValue(m["value"], options);
    }
  }
  return result;
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
