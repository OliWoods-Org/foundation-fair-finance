/**
 * Debt Warning System
 *
 * Early warning system for debt spirals using financial pattern analysis.
 * Identifies borrowers at risk of falling into debt traps and provides
 * intervention pathways.
 *
 * @module debt-warning
 * @license GPL-3.0
 * @author OliWoods Foundation
 */

import { z } from 'zod';

export const FinancialSnapshotSchema = z.object({
  userId: z.string(),
  date: z.string().datetime(),
  monthlyIncome: z.number().nonnegative(),
  monthlyExpenses: z.number().nonnegative(),
  totalDebt: z.number().nonnegative(),
  activeLoans: z.array(z.object({
    type: z.string(),
    balance: z.number().nonnegative(),
    monthlyPayment: z.number().nonnegative(),
    apr: z.number().min(0),
    isPayday: z.boolean().default(false),
  })),
  creditScore: z.number().int().min(300).max(850).optional(),
  savingsBalance: z.number().nonnegative().default(0),
  overdraftsLast90Days: z.number().int().nonnegative().default(0),
  paydayLoansLast12Months: z.number().int().nonnegative().default(0),
});

export const DebtRiskAssessmentSchema = z.object({
  userId: z.string(),
  assessmentDate: z.string().datetime(),
  riskLevel: z.enum(['low', 'moderate', 'high', 'critical']),
  riskScore: z.number().min(0).max(100),
  debtToIncomeRatio: z.number().min(0),
  monthlyDeficit: z.number(),
  timeToInsolvencyMonths: z.number().int().optional(),
  spiralIndicators: z.array(z.object({
    indicator: z.string(),
    present: z.boolean(),
    weight: z.number(),
  })),
  interventions: z.array(z.object({
    priority: z.enum(['immediate', 'short-term', 'long-term']),
    action: z.string(),
    potentialSavings: z.string().optional(),
    resource: z.string().optional(),
  })),
});

export type FinancialSnapshot = z.infer<typeof FinancialSnapshotSchema>;
export type DebtRiskAssessment = z.infer<typeof DebtRiskAssessmentSchema>;

const SPIRAL_INDICATORS = [
  { indicator: 'Borrowing to repay other loans', weight: 0.25 },
  { indicator: 'Multiple active payday loans', weight: 0.20 },
  { indicator: 'Debt-to-income ratio above 43%', weight: 0.15 },
  { indicator: 'Monthly expenses exceed income', weight: 0.15 },
  { indicator: 'No emergency savings', weight: 0.10 },
  { indicator: 'Recent overdrafts', weight: 0.08 },
  { indicator: 'Using payday loans for recurring expenses', weight: 0.07 },
];

export function assessDebtRisk(snapshot: FinancialSnapshot): DebtRiskAssessment {
  const dti = snapshot.monthlyIncome > 0
    ? snapshot.activeLoans.reduce((s, l) => s + l.monthlyPayment, 0) / snapshot.monthlyIncome
    : 999;

  const monthlyDeficit = snapshot.monthlyIncome - snapshot.monthlyExpenses -
    snapshot.activeLoans.reduce((s, l) => s + l.monthlyPayment, 0);

  const indicators = SPIRAL_INDICATORS.map(si => {
    let present = false;
    switch (si.indicator) {
      case 'Borrowing to repay other loans':
        present = snapshot.paydayLoansLast12Months > 3 && snapshot.activeLoans.some(l => l.isPayday);
        break;
      case 'Multiple active payday loans':
        present = snapshot.activeLoans.filter(l => l.isPayday).length >= 2;
        break;
      case 'Debt-to-income ratio above 43%':
        present = dti > 0.43;
        break;
      case 'Monthly expenses exceed income':
        present = monthlyDeficit < 0;
        break;
      case 'No emergency savings':
        present = snapshot.savingsBalance < snapshot.monthlyExpenses * 0.5;
        break;
      case 'Recent overdrafts':
        present = snapshot.overdraftsLast90Days > 0;
        break;
      case 'Using payday loans for recurring expenses':
        present = snapshot.paydayLoansLast12Months >= 4;
        break;
    }
    return { ...si, present };
  });

  const riskScore = Math.min(100, Math.round(
    indicators.filter(i => i.present).reduce((s, i) => s + i.weight * 100, 0) +
    Math.max(0, (dti - 0.3) * 50) +
    (monthlyDeficit < 0 ? Math.min(30, Math.abs(monthlyDeficit) / 100) : 0),
  ));

  const riskLevel: DebtRiskAssessment['riskLevel'] = riskScore < 25 ? 'low' : riskScore < 50 ? 'moderate' : riskScore < 75 ? 'high' : 'critical';

  const timeToInsolvency = monthlyDeficit < 0 && snapshot.savingsBalance > 0
    ? Math.ceil(snapshot.savingsBalance / Math.abs(monthlyDeficit))
    : undefined;

  const interventions: DebtRiskAssessment['interventions'] = [];

  if (riskLevel === 'critical') {
    interventions.push({
      priority: 'immediate',
      action: 'Contact a free HUD-approved credit counselor',
      resource: 'Call 1-800-388-2227 (NFCC) or visit nfcc.org',
    });
  }

  const paydayLoans = snapshot.activeLoans.filter(l => l.isPayday);
  if (paydayLoans.length > 0) {
    const paydayTotal = paydayLoans.reduce((s, l) => s + l.monthlyPayment, 0);
    interventions.push({
      priority: 'immediate',
      action: 'Replace payday loans with a credit union Payday Alternative Loan (PAL)',
      potentialSavings: `Up to $${Math.round(paydayTotal * 0.7 * 12).toLocaleString()}/year`,
      resource: 'Find a credit union: mycreditunion.gov',
    });
  }

  if (monthlyDeficit < 0) {
    interventions.push({
      priority: 'short-term',
      action: `Address $${Math.abs(Math.round(monthlyDeficit)).toLocaleString()}/month budget shortfall. Review expenses for reduction opportunities.`,
    });
  }

  if (snapshot.savingsBalance < snapshot.monthlyExpenses) {
    interventions.push({
      priority: 'long-term',
      action: 'Build emergency fund to cover 3 months of expenses',
      potentialSavings: 'Eliminates need for emergency borrowing',
    });
  }

  interventions.push({
    priority: 'short-term',
    action: 'Check eligibility for government assistance: SNAP, LIHEAP, Medicaid, TANF',
    resource: 'Visit benefits.gov or dial 211',
  });

  return DebtRiskAssessmentSchema.parse({
    userId: snapshot.userId,
    assessmentDate: new Date().toISOString(),
    riskLevel,
    riskScore,
    debtToIncomeRatio: Math.round(dti * 1000) / 10,
    monthlyDeficit: Math.round(monthlyDeficit),
    timeToInsolvencyMonths: timeToInsolvency,
    spiralIndicators: indicators,
    interventions,
  });
}

/**
 * Compare two financial snapshots to detect trajectory.
 */
export function detectTrajectory(
  previous: FinancialSnapshot,
  current: FinancialSnapshot,
): { direction: 'improving' | 'stable' | 'worsening'; changes: string[] } {
  const changes: string[] = [];
  const prevDebt = previous.totalDebt;
  const curDebt = current.totalDebt;

  if (curDebt > prevDebt * 1.1) changes.push(`Debt increased ${Math.round((curDebt - prevDebt) / prevDebt * 100)}%`);
  if (curDebt < prevDebt * 0.9) changes.push(`Debt decreased ${Math.round((prevDebt - curDebt) / prevDebt * 100)}%`);

  const prevPayday = previous.activeLoans.filter(l => l.isPayday).length;
  const curPayday = current.activeLoans.filter(l => l.isPayday).length;
  if (curPayday > prevPayday) changes.push(`Active payday loans increased from ${prevPayday} to ${curPayday}`);
  if (curPayday < prevPayday) changes.push(`Active payday loans decreased from ${prevPayday} to ${curPayday}`);

  if (current.savingsBalance > previous.savingsBalance * 1.2) changes.push('Savings increasing');
  if (current.savingsBalance < previous.savingsBalance * 0.5) changes.push('Savings declining rapidly');

  const worsening = changes.filter(c => c.includes('increased') || c.includes('declining')).length;
  const improving = changes.filter(c => c.includes('decreased') || c.includes('increasing')).length;

  return {
    direction: worsening > improving ? 'worsening' : improving > worsening ? 'improving' : 'stable',
    changes,
  };
}
