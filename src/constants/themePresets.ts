export interface ThemePreset {
  id: string;
  nameJa: string;
  nameEn: string;
  color: string;      // --primary-color
  rgb: string;        // --primary-rgb
  hover: string;      // --primary-hover
  onPrimary: string;  // --on-primary
  light: string;      // --primary-light
  border: string;     // --primary-border
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "mint",
    nameJa: "サイバーミント",
    nameEn: "Cyber Mint",
    color: "#4adfc8",
    rgb: "74, 223, 200",
    hover: "#37cbb4",
    onPrimary: "#003730",
    light: "#69f9e1",
    border: "#19c3ad"
  },
  {
    id: "blue",
    nameJa: "オーシャンブルー",
    nameEn: "Ocean Blue",
    color: "#38bdf8",
    rgb: "56, 189, 248",
    hover: "#0ea5e9",
    onPrimary: "#0369a1",
    light: "#7dd3fc",
    border: "#0284c7"
  },
  {
    id: "orange",
    nameJa: "サンセットオレンジ",
    nameEn: "Sunset Orange",
    color: "#fb923c",
    rgb: "251, 146, 60",
    hover: "#f97316",
    onPrimary: "#7c2d12",
    light: "#fdba74",
    border: "#ea580c"
  },
  {
    id: "purple",
    nameJa: "ラベンダーパープル",
    nameEn: "Lavender Purple",
    color: "#c084fc",
    rgb: "192, 132, 252",
    hover: "#a855f7",
    onPrimary: "#581c87",
    light: "#d8b4fe",
    border: "#9333ea"
  },
  {
    id: "pink",
    nameJa: "サクラピンク",
    nameEn: "Sakura Pink",
    color: "#f472b6",
    rgb: "244, 114, 182",
    hover: "#ec4899",
    onPrimary: "#831843",
    light: "#f9a8d4",
    border: "#db2777"
  },
  {
    id: "gold",
    nameJa: "レモンゴールド",
    nameEn: "Lemon Gold",
    color: "#fbbf24",
    rgb: "251, 191, 36",
    hover: "#f59e0b",
    onPrimary: "#78350f",
    light: "#fde047",
    border: "#d97706"
  },
  {
    id: "green",
    nameJa: "フォレストグリーン",
    nameEn: "Forest Green",
    color: "#4ade80",
    rgb: "74, 222, 128",
    hover: "#22c55e",
    onPrimary: "#14532d",
    light: "#86efac",
    border: "#16a34a"
  },
  {
    id: "white",
    nameJa: "プラチナホワイト",
    nameEn: "Platinum White",
    color: "#ffffff",
    rgb: "255, 255, 255",
    hover: "#e2e2e9",
    onPrimary: "#0d0f14",
    light: "#ffffff",
    border: "#cbd5e1"
  },
  {
    id: "cream",
    nameJa: "ウォームクリーム",
    nameEn: "Warm Cream",
    color: "#f5e6ca",
    rgb: "245, 230, 202",
    hover: "#e8d4b3",
    onPrimary: "#1c1917",
    light: "#fdf6e2",
    border: "#d7c39d"
  }
];

export const THEME_PRESETS_LIGHT: Record<string, Partial<ThemePreset>> = {
  mint: {
    color: "#0d9488",
    rgb: "13, 148, 136",
    hover: "#0f766e",
    onPrimary: "#ffffff",
    light: "#14b8a6",
    border: "#0d9488"
  },
  blue: {
    color: "#0284c7",
    rgb: "2, 132, 199",
    hover: "#0369a1",
    onPrimary: "#ffffff",
    light: "#38bdf8",
    border: "#0284c7"
  },
  orange: {
    color: "#ea580c",
    rgb: "234, 88, 12",
    hover: "#c2410c",
    onPrimary: "#ffffff",
    light: "#fb923c",
    border: "#ea580c"
  },
  purple: {
    color: "#7c3aed",
    rgb: "124, 58, 237",
    hover: "#6d28d9",
    onPrimary: "#ffffff",
    light: "#a78bfa",
    border: "#7c3aed"
  },
  pink: {
    color: "#db2777",
    rgb: "219, 39, 119",
    hover: "#be185d",
    onPrimary: "#ffffff",
    light: "#f472b6",
    border: "#db2777"
  },
  gold: {
    color: "#d97706",
    rgb: "217, 119, 6",
    hover: "#b45309",
    onPrimary: "#ffffff",
    light: "#fbbf24",
    border: "#d97706"
  },
  green: {
    color: "#16a34a",
    rgb: "22, 163, 74",
    hover: "#15803d",
    onPrimary: "#ffffff",
    light: "#4ade80",
    border: "#16a34a"
  },
  white: {
    color: "#1e293b",
    rgb: "30, 41, 59",
    hover: "#0f172a",
    onPrimary: "#ffffff",
    light: "#475569",
    border: "#1e293b"
  },
  cream: {
    color: "#78350f",
    rgb: "120, 53, 15",
    hover: "#451a03",
    onPrimary: "#ffffff",
    light: "#b45309",
    border: "#78350f"
  }
};
