/**
 * Result tables, shared by every lab: a header row ("Test Description | Result | Units | Ranges | Method")
 * fixes the column x positions; each later line is a parameter row, a continuation, a method line, a
 * sub-heading, or narrative.
 */
import type { Line } from "./pdf";
import type { Flag, Parameter } from "./types";

export interface Columns {
  name: number;
  result: number;
  unit?: number;
  range?: number;
  method?: number;
}

const SLOP = 7;

/** Column positions from a header line, or null when the line is not a table header. */
export function headerColumns(line: Line): Columns | null {
  const t = line.text.toUpperCase();
  if (!/TEST\s*DESCRIPTION|INVESTIGATION|PARAMETER/.test(t) || !/RESULT/.test(t)) return null;
  const at = (re: RegExp) => line.items.find((i) => re.test(i.s.toUpperCase()))?.x;
  const name = at(/TEST|INVESTIGATION|PARAMETER/) ?? line.items[0]!.x;
  const result = at(/^RESULTS?$|RESULT/);
  if (result === undefined) return null;
  return { name, result, unit: at(/^UNITS?$|UNIT/), range: at(/RANGE|REFERENCE|INTERVAL/), method: at(/^METHOD/) };
}

/** Split a line's items into the table's cells. */
export function cells(line: Line, c: Columns) {
  const bounds = [
    ["name", -Infinity, c.result - SLOP],
    ["result", c.result - SLOP, (c.unit ?? c.range ?? c.method ?? Infinity) - SLOP],
    ["unit", (c.unit ?? Infinity) - SLOP, (c.range ?? c.method ?? Infinity) - SLOP],
    ["range", (c.range ?? Infinity) - SLOP, (c.method ?? Infinity) - SLOP],
    ["method", (c.method ?? Infinity) - SLOP, Infinity],
  ] as const;
  const out: Record<"name" | "result" | "unit" | "range" | "method", string> = { name: "", result: "", unit: "", range: "", method: "" };
  for (const it of line.items) {
    const b = bounds.find(([, lo, hi]) => it.x >= lo && it.x < hi);
    if (b) out[b[0]] = (out[b[0]] ? out[b[0]] + " " : "") + it.s;
  }
  for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] = out[k].replace(/\s+/g, " ").trim();
  return out;
}

const num = (s: string) => {
  const m = s.replace(/,/g, "").match(/^[<>]?\s*(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : NaN;
};

/** H / L from a numeric value and a simple range: "a - b", "a–b", "< x", "> x", "Up to x". */
export function computeFlag(value: string, range?: string): Flag {
  if (!range) return "";
  const v = num(value);
  if (Number.isNaN(v) || /[a-z]{3,}/i.test(value.replace(/^[<>]/, ""))) return "";
  const r = range.split("\n")[0]!.replace(/,/g, "").trim();
  let m = r.match(/^(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return v < Number(m[1]) ? "L" : v > Number(m[2]) ? "H" : "";
  if ((m = r.match(/^(?:<|<=|≤|up\s*to|upto)\s*(-?\d+(?:\.\d+)?)$/i))) return v > Number(m[1]) ? "H" : "";
  if ((m = r.match(/^(?:>|>=|≥)\s*(-?\d+(?:\.\d+)?)$/i))) return v < Number(m[1]) ? "L" : "";
  return "";
}

/** "11.2 L" / "H 15" / "15 *" → value + printed flag. */
export function splitFlag(raw: string): { value: string; flag: Flag | null } {
  let m = raw.match(/^(.*\S)\s+([HL])$/);
  if (m) return { value: m[1]!, flag: m[2] as Flag };
  m = raw.match(/^([HL])\s+(\S.*)$/);
  if (m) return { value: m[2]!, flag: m[1] as Flag };
  return { value: raw, flag: null };
}

export const METHOD_LINE = /^\(?\s*method\s*[:\-]\s*(.*?[^\s\-–—].*?)\)?$/i;

export function makeParameter(name: string, cell: ReturnType<typeof cells>): Parameter {
  const { value, flag } = splitFlag(cell.result);
  const range = cell.range || undefined;
  return {
    name,
    value,
    unit: /^[.\-–—]?$/.test(cell.unit) ? undefined : cell.unit, // "." / "-" placeholders mean no unit
    range,
    method: cell.method || undefined,
    flag: flag ?? computeFlag(value, range),
  };
}
