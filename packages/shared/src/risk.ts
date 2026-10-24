/**
 * Configurable risk matrix.
 *
 * Score = likelihood × severity. Each organisation can store its own matrix
 * (size and banding) in organizations.settings.riskMatrix. The default below is
 * an organisational convention for a 5×5 matrix — it is NOT a statutory
 * requirement and should be aligned with the organisation's own HSE procedure.
 */

export type RiskBand = 'low' | 'medium' | 'high' | 'critical';

export interface RiskMatrixConfig {
  /** Max value on each axis (likelihood and severity both run 1..size). */
  size: number;
  /** Inclusive lower bound of each band. Must be ascending and start at 1. */
  bands: { band: RiskBand; minScore: number }[];
  likelihoodLabels?: string[];
  severityLabels?: string[];
}

export const DEFAULT_RISK_MATRIX: RiskMatrixConfig = {
  size: 5,
  bands: [
    { band: 'low', minScore: 1 },
    { band: 'medium', minScore: 5 },
    { band: 'high', minScore: 10 },
    { band: 'critical', minScore: 15 },
  ],
  likelihoodLabels: ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'],
  severityLabels: ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic'],
};

export class RiskInputError extends Error {}

export function validateRiskMatrix(cfg: RiskMatrixConfig): void {
  if (!Number.isInteger(cfg.size) || cfg.size < 2 || cfg.size > 10) throw new RiskInputError('Matrix size must be an integer between 2 and 10');
  if (cfg.bands.length === 0 || cfg.bands[0]!.minScore !== 1) throw new RiskInputError('First band must start at score 1');
  for (let i = 1; i < cfg.bands.length; i++) {
    if (cfg.bands[i]!.minScore <= cfg.bands[i - 1]!.minScore) throw new RiskInputError('Band thresholds must be strictly ascending');
  }
  if (cfg.bands[cfg.bands.length - 1]!.minScore > cfg.size * cfg.size) throw new RiskInputError('Band threshold exceeds maximum score');
}

export function calculateRisk(likelihood: number, severity: number, cfg: RiskMatrixConfig = DEFAULT_RISK_MATRIX): { score: number; band: RiskBand } {
  for (const [name, v] of [['likelihood', likelihood], ['severity', severity]] as const) {
    if (!Number.isInteger(v) || v < 1 || v > cfg.size) throw new RiskInputError(`${name} must be an integer from 1 to ${cfg.size}`);
  }
  const score = likelihood * severity;
  let band: RiskBand = cfg.bands[0]!.band;
  for (const b of cfg.bands) if (score >= b.minScore) band = b.band;
  return { score, band };
}
