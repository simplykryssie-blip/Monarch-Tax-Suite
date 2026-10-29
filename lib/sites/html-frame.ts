/**
 * Screen-height units (100vh and the like) inside a frame mean the frame's own height, and the frame is sized to its content,
 * so a hero written as 100vh makes the frame grow every time it is measured. They are replaced with a fixed screen height.
 */
const SCREEN = 720;
export const fixScreenUnits = (code: string): string => code.replace(/(-?\d*\.?\d+)\s*(?:vh|svh|lvh|dvh)\b/gi, (_, n: string) => `${Math.round((Number(n) * SCREEN) / 100)}px`);

