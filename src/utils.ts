/** Wrap extension-authored context in a boundary models can distinguish from user intent. */
export const wrapSystemNotification = (content: string): string =>
  `<system-notification>\n${content}\n</system-notification>`;

export const formatTokens = (n: number | null | undefined) => {
  if (n == null) return "N/A";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "k";
  return n.toString();
};
