export type ThemeType = 'dark' | 'dim' | 'light' | 'sepia' | 'warm-sepia';

export interface ThemeConfig {
  id: ThemeType;
  nameJa: string;
  nameEn: string;
  subname: string;
  icon: string;
  description: string;
  environment: string;
  bgHex: string;
  cardHex: string;
  textHex: string;
  accentHex: string;
}

export const THEME_LIST: ThemeConfig[] = [
  {
    id: 'dark',
    nameJa: 'ダーク',
    nameEn: 'Dark',
    subname: 'Modern Deep Slate',
    icon: '🌙',
    description: 'まぶしさを抑えた落ち着いた深みのあるスレートダーク。文字色も純白を避け、チカチカしないソフトホワイト（Slate-200）を採用。',
    environment: '夜間・暗所での長時間の集中作業に最適',
    bgHex: '#0a0e17',
    cardHex: '#131d31',
    textHex: '#e2e8f0',
    accentHex: '#6366f1'
  },
  {
    id: 'dim',
    nameJa: 'ディム',
    nameEn: 'Dim',
    subname: 'Slate Navy / 低コントラスト',
    icon: '🌌',
    description: 'コントラストを抑えた優しいスレートネイビー。瞳の筋肉の緊張をほぐし、長時間のチャート分析でも最も疲れにくい配色。',
    environment: '夕暮れ・薄暗い室内・長時間のデータ監視に最適',
    bgHex: '#161c28',
    cardHex: '#222d42',
    textHex: '#cbd5e1',
    accentHex: '#818cf8'
  },
  {
    id: 'light',
    nameJa: 'ライト',
    nameEn: 'Light',
    subname: 'Soft Slate Light / 非グレア',
    icon: '☀️',
    description: '白一色のまぶしさを防ぐ Slate-50 ベース。文字は真っ黒ではなく濃紺チャコールで、高い視認性と自然な読みやすさを両立。',
    environment: '日中・明るいオフィス・屋外光のある環境に最適',
    bgHex: '#f8fafc',
    cardHex: '#ffffff',
    textHex: '#0f172a',
    accentHex: '#4f46e5'
  },
  {
    id: 'sepia',
    nameJa: 'ダークセピア',
    nameEn: 'Dark Sepia',
    subname: 'Warm Dark / 低刺激ウォームダーク',
    icon: '📜',
    description: '明るさを抑えた深煎りエスプレッソ＆柔らかなクリーム文字。ブルーライトをカットし、光の刺激に敏感な目にも非常に優しいダークウォーム配色。',
    environment: '夜間・光の刺激を避けたい長時間のデータ分析に最適',
    bgHex: '#18130e',
    cardHex: '#2a2018',
    textHex: '#e6dac6',
    accentHex: '#d97706'
  },
  {
    id: 'warm-sepia',
    nameJa: 'ウォームセピア',
    nameEn: 'Warm Sepia',
    subname: 'Muted Parchment / 落ち着いた明るめセピア',
    icon: '📖',
    description: '白すぎず落ち着いたクラシック羊皮紙色と深煎り珈琲ブラウン文字。ブルーライトを抑えつつ適度な明度で読みやすい上質ペーパートーン。',
    environment: '日中・読書灯の下・自然光の入る部屋での快適な分析に最適',
    bgHex: '#c2b189',
    cardHex: '#cbb991',
    textHex: '#120d06',
    accentHex: '#8a4208'
  }
];

// 後方互換性用のヘルパー
export const THEMES_BY_ID: Record<ThemeType, ThemeConfig> = THEME_LIST.reduce((acc, cur) => {
  acc[cur.id] = cur;
  return acc;
}, {} as Record<ThemeType, ThemeConfig>);
