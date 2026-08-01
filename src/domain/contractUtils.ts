export const getContractSizeLabel = (size: number): string => {
  if (size === 100000) return "10万通貨 (Standard)";
  if (size === 10000) return "1万通貨 (Mini)";
  if (size === 1000) return "1,000通貨 (Micro)";
  return `${size.toLocaleString()}通貨`;
};
