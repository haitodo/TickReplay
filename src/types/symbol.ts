export interface SymbolItem {
  name: string;
  source_type: "custom" | "broker" | "default" | string;
  group_name: string;
}
