import type { RiskMatrixConfig, ObservationStatus, RiskBand } from '@forgehse/shared';

export interface Me {
  user: { id: string; fullName: string; email: string; mustChangePassword: boolean };
  organization: { id: string; name: string };
  permissions: string[];
  projects: { id: string; code: string; name: string; sites: { id: string; code: string; name: string }[] }[];
}
export interface Meta { hazardCategories: string[]; riskMatrix: RiskMatrixConfig; timezone: string }
export interface ObservationItem {
  id: string; refNo: string; hazardCategory: string; location: string; description: string; status: ObservationStatus;
  overdue: boolean; riskBand: RiskBand; riskScore: number; dueDate: string | null; observedAt: string; assigneeName: string | null; siteName: string;
}
