// Per architecture/schema-v3.md §4.6 — Rule 7
export type WireFormatVersion = `${number}.${number}`;
export const CURRENT_WIRE_VERSION: WireFormatVersion = "1.0";
