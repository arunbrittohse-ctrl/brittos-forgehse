/**
 * FORGEHSE HSE line-icon set: original drawings on a 64-unit grid, stroke-only
 * (round caps/joins), so they inherit colour and scale cleanly from 16 px chips to A3 posters.
 */
import type { PosterIcon } from './studio';

const circle = (cx: number, cy: number, r: number) => `M${cx + r} ${cy}a${r} ${r} 0 1 1-${2 * r} 0a${r} ${r} 0 1 1 ${2 * r} 0`;

export const HSE_ICON_PATHS: Record<PosterIcon, string> = {
  hard_hat: 'M8 46h48M14 46v-6a18 18 0 0 1 36 0v6M27 23v-7h10v7M22 46v-8M42 46v-8',
  harness: `${circle(24, 12, 5)}M24 17v21M24 38l-7 18M24 38l7 18M13 27h22M18 21l12 11M30 21L18 32M26 19c8-5 16-9 23-11${circle(52, 7, 3)}`,
  gloves: 'M22 56V34l-7-9a3.5 3.5 0 0 1 5.5-4.4L25 26V12a3.5 3.5 0 0 1 7 0v13V9a3.5 3.5 0 0 1 7 0v16V13a3.5 3.5 0 0 1 7 0v19c0 13-4 24-12 24zM22 48h20',
  goggles: 'M8 26h48v12a6 6 0 0 1-6 6H41l-5-6h-8l-5 6h-9a6 6 0 0 1-6-6zM8 31H3M56 31h5M16 32h8M40 32h8',
  ear_protection: 'M15 36a17 17 0 0 1 34 0M9 34h10v18H9zM45 34h10v18H45zM19 43h-4M45 43h4',
  respirator: 'M20 24c0-9 24-9 24 0v14c0 9-6 15-12 15s-12-6-12-15zM20 30L9 25M44 30l11-5M26 40h12M27 46h10M32 20v6',
  boots: 'M18 8h15v27l15 6c5 2 7 5 7 10v4H18zM18 47h37M33 18H18',
  hi_vis_vest: 'M22 8l10 10 10-10 9 6v42H13V14zM32 18v38M13 33h38M13 43h38',
  fire: 'M32 57c-10 0-17-7-17-16 0-11 9-15 10-26 7 5 11 12 10 18 3-2 5-6 5-10 7 5 9 12 9 18 0 9-7 16-17 16zM32 57c-4.5 0-7.5-3-7.5-7.5 0-5 5-7.5 6.5-12.5 4.5 3.5 8.5 7.5 8.5 12.5 0 4.5-3 7.5-7.5 7.5z',
  extinguisher: 'M23 23h16v33H23zM27 23v-7h8v7M35 16h10l5 5M27 13l-8-4M23 33h16',
  electric: 'M37 5L15 36h15l-4 23 23-33H34z',
  ladder: 'M21 5v54M43 5v54M21 13h22M21 25h22M21 37h22M21 49h22',
  scaffold: 'M10 57V11M32 57V11M54 57V11M7 11h50M7 34h50M10 34l22-23M32 57l22-23M5 57h54',
  excavation: 'M3 22h15l6 28h16l6-28h15M24 50h16M20 22v-7M44 22v-7M14 15h12M38 15h12M26 36h12',
  crane: 'M14 58V10h6v48M9 58h16M20 14h36M20 14l13-8 23 8M50 14v18M46 32h8v6h-8zM20 23l9-9',
  forklift: `M8 44V24h16l8 12v8M12 24V13h11l2 11M41 7v40M41 40h18M8 44h33${circle(14, 50, 5)}${circle(32, 50, 5)}`,
  vehicle: `M5 42V28l8-12h25l8 12h12v14M5 42h53M13 28h33${circle(15, 48, 5)}${circle(48, 48, 5)}`,
  confined_space: `M9 47a23 8 0 0 0 46 0a23 8 0 0 0-46 0${circle(32, 13, 4)}M32 19v15M24 26l8-4 8 4M32 34l-6 9M32 34l6 9`,
  chemical: 'M25 6h14M28 6v17L14 50a4 4 0 0 0 3.6 6h28.8a4 4 0 0 0 3.6-6L36 23V6M21 41h22M30 47h.1M37 45h.1',
  heat: 'M33 10a4 4 0 0 1 8 0v26a9 9 0 1 1-8 0zM37 22v20M13 14l4 4M9 28h7M13 42l4-4M20 8v6',
  water: 'M32 6c8 12 17 22 17 33a17 17 0 0 1-34 0c0-11 9-21 17-33zM24 41a8 8 0 0 0 8 8',
  first_aid: 'M9 18h46v36H9zM24 18v-7h16v7M32 26v20M22 36h20',
  stop_hand: 'M21 57c-7-6-11-14-11-21v-8a3.5 3.5 0 0 1 7 0v5V14a3.5 3.5 0 0 1 7 0v15V10a3.5 3.5 0 0 1 7 0v19V12a3.5 3.5 0 0 1 7 0v17V18a3.5 3.5 0 0 1 7 0v19c0 10-4 16-8 20z',
  warning: 'M32 7l27 48H5zM32 24v15M32 47v.5',
  shield_check: 'M32 5l21 8v15c0 14-9 24-21 31C20 52 11 42 11 28V13zM22 32l7 7 14-15',
  noise: 'M8 26h11l13-11v34L19 38H8zM40 24a10 10 0 0 1 0 16M46 17a19 19 0 0 1 0 30M52 11a28 28 0 0 1 0 42',
  dust: 'M6 22h31a6 6 0 1 0-6-6M6 32h43a6 6 0 1 1-6 6M6 42h23M40 48h.5M48 22h.5',
  manual_handling: `${circle(27, 10, 4)}M27 16v17l-6 22M27 33l7 22M20 25h20M38 19h15v15H38z`,
  eye: 'M3 32s11-17 29-17 29 17 29 17-11 17-29 17S3 32 3 32zM32 41a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  leaf: 'M13 51C13 27 30 12 55 9c0 27-15 42-38 42M13 51l21-21M13 51l-5 6',
  people: `${circle(20, 20, 6)}${circle(44, 20, 6)}M7 48c0-9 6-15 13-15s13 6 13 15M31 48c0-9 6-15 13-15s13 6 13 15`,
  tools: 'M45 7a12 12 0 0 0-12 16L10 46a5.5 5.5 0 0 0 8 8l23-23a12 12 0 0 0 16-12l-8 6-7-7 6-8zM14 50h.1',
  lockout: 'M19 30h26v26H19zM24 30v-8a8 8 0 0 1 16 0v8M32 40v7',
};
