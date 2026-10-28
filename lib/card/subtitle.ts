// "Almost there" subtitle (plan §5.4). Returns undefined to keep the
// owner's tagline.
export const getAlmostThereSubtitle = (stamps: number, totalStamps: number, rewardName: string) => {
  const remaining = totalStamps - stamps;
  if (remaining === 1) return `¡Solo te falta 1 para tu ${rewardName}!`;
  if (remaining === 2) return `¡Te faltan 2 para tu ${rewardName}!`;
  return undefined;
};
