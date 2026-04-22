/**
 * Loan Analyzer
 *
 * Translates complex lending agreements into plain-language true costs.
 * Calculates real APR, total repayment, and identifies predatory terms.
 *
 * @module loan-analyzer
 * @license GPL-3.0
 * @author OliWoods Foundation
 */

import { z } from 'zod';

export const LoanTermsSchema = z.object({
  principal: z.number().positive(),
  statedAPR: z.number().min(0).optional(),
  feeAmount: z.number().nonnegative().default(0),
  feePercent: z.number().min(0).max(100).optional(),
  termDays: z.number().int().positive(),
  paymentFrequency: z.enum(['single', 'biweekly', 'monthly', 'weekly']),
  rolloverFee: z.number().nonnegative().default(0),
  latePaymentFee: z.number().nonnegative().default(0),
  prepaymentPenalty: z.boolean().default(false),
  collateralRequired: z.boolean().default(false),
  lenderName: z.string().optional(),
  loanType: z.enum(['payday', 'title', 'installment', 'personal', 'mortgage', 'student', 'credit-card', 'other']),
});

export const LoanAnalysisSchema = z.object({
  trueAPR: z.number(),
  totalRepayment: z.number(),
  totalInterestAndFees: z.number(),
  costPerDollarBorrowed: z.number(),
  predatoryIndicators: z.array(z.object({
    indicator: z.string(),
    severity: z.enum(['warning', 'danger', 'critical']),
    explanation: z.string(),
  })),
  plainLanguageSummary: z.string(),
  riskLevel: z.enum(['low', 'moderate', 'high', 'predatory']),
  betterAlternatives: z.array(z.object({ name: z.string(), typicalAPR: z.string(), description: z.string() })),
});

export const DebtSpiralProjectionSchema = z.object({
  months: z.array(z.object({
    month: z.number().int().positive(),
    balance: z.number(),
    totalPaid: z.number(),
    totalFees: z.number(),
    rollovers: z.number().int(),
  })),
  totalCostAfter12Months: z.number(),
  effectiveAPRWithRollovers: z.number(),
  timeToPayoff: z.string(),
  warning: z.string(),
});

export type LoanTerms = z.infer<typeof LoanTermsSchema>;
export type LoanAnalysis = z.infer<typeof LoanAnalysisSchema>;
export type DebtSpiralProjection = z.infer<typeof DebtSpiralProjectionSchema>;

const PREDATORY_THRESHOLDS = {
  paydayAPR: 300,
  titleAPR: 200,
  installmentAPR: 100,
  personalAPR: 36,
};

const ALTERNATIVES = [
  { name: 'Credit Union Payday Alternative Loan (PAL)', typicalAPR: '18-28%', description: 'Federally regulated alternative with max 28% APR and up to $2,000' },
  { name: 'CDFI Emergency Loan', typicalAPR: '5-18%', description: 'Community Development Financial Institution small-dollar loans' },
  { name: 'Employer Paycheck Advance', typicalAPR: '0-6%', description: 'Many employers offer earned wage access at low or no cost' },
  { name: '211 Emergency Assistance', typicalAPR: '0%', description: 'Dial 211 for local emergency financial assistance and utility help' },
  { name: 'Negotiated Payment Plan', typicalAPR: '0%', description: 'Contact the creditor directly to negotiate a payment plan before borrowing' },
];

export function analyzeLoan(terms: LoanTerms): LoanAnalysis {
  const totalFees = terms.feeAmount + (terms.feePercent ? terms.principal * terms.feePercent / 100 : 0);
  const totalRepayment = terms.principal + totalFees;
  const trueAPR = calculateTrueAPR(terms.principal, totalFees, terms.termDays);
  const costPerDollar = Math.round((totalRepayment / terms.principal) * 100) / 100;

  const indicators: LoanAnalysis['predatoryIndicators'] = [];

  // APR checks
  if (trueAPR > 400) {
    indicators.push({ indicator: 'Extreme APR', severity: 'critical', explanation: `True APR of ${trueAPR.toFixed(0)}% is usurious. Most states cap interest rates well below this.` });
  } else if (trueAPR > 100) {
    indicators.push({ indicator: 'Very High APR', severity: 'danger', explanation: `True APR of ${trueAPR.toFixed(0)}% far exceeds typical personal loan rates (6-36%).` });
  } else if (trueAPR > 36) {
    indicators.push({ indicator: 'Above Fair Lending Rate', severity: 'warning', explanation: `APR of ${trueAPR.toFixed(0)}% exceeds the 36% threshold used by the Military Lending Act.` });
  }

  // Short term + high fee pattern
  if (terms.termDays <= 30 && totalFees > terms.principal * 0.10) {
    indicators.push({ indicator: 'Short-term high-fee structure', severity: 'danger', explanation: 'Short repayment window with high fees is designed to force rollovers, creating a debt trap.' });
  }

  // Rollover fees
  if (terms.rolloverFee > 0) {
    indicators.push({ indicator: 'Rollover/extension fees', severity: 'danger', explanation: `$${terms.rolloverFee} rollover fee incentivizes the lender to keep you in debt. Average payday borrower rolls over 8 times.` });
  }

  // Prepayment penalty
  if (terms.prepaymentPenalty) {
    indicators.push({ indicator: 'Prepayment penalty', severity: 'warning', explanation: 'Charges for paying off early discourage you from escaping the loan.' });
  }

  // Collateral on small loans
  if (terms.collateralRequired && terms.principal < 5000) {
    indicators.push({ indicator: 'Collateral required for small loan', severity: 'danger', explanation: 'Requiring collateral (often a car title) for a small loan puts essential assets at risk.' });
  }

  const riskLevel: LoanAnalysis['riskLevel'] = indicators.some(i => i.severity === 'critical') ? 'predatory'
    : indicators.filter(i => i.severity === 'danger').length >= 2 ? 'predatory'
    : indicators.some(i => i.severity === 'danger') ? 'high'
    : indicators.length > 0 ? 'moderate' : 'low';

  const summary = `Borrowing $${terms.principal.toLocaleString()} for ${terms.termDays} days will cost you $${totalRepayment.toLocaleString()} total — that's $${totalFees.toLocaleString()} in fees alone. The true annual percentage rate (APR) is ${trueAPR.toFixed(0)}%. For comparison, a typical credit card charges 20-25% APR and a personal loan charges 6-36% APR.`;

  return LoanAnalysisSchema.parse({
    trueAPR: Math.round(trueAPR * 100) / 100,
    totalRepayment: Math.round(totalRepayment * 100) / 100,
    totalInterestAndFees: Math.round(totalFees * 100) / 100,
    costPerDollarBorrowed: costPerDollar,
    predatoryIndicators: indicators,
    plainLanguageSummary: summary,
    riskLevel,
    betterAlternatives: ALTERNATIVES,
  });
}

export function projectDebtSpiral(terms: LoanTerms, rolloverProbability = 0.8): DebtSpiralProjection {
  const months: DebtSpiralProjection['months'] = [];
  const feePerTerm = terms.feeAmount + (terms.feePercent ? terms.principal * terms.feePercent / 100 : 0);
  let balance = terms.principal;
  let totalPaid = 0;
  let totalFees = 0;
  let rollovers = 0;
  const termsPerMonth = Math.max(1, Math.round(30 / terms.termDays));

  for (let month = 1; month <= 12; month++) {
    for (let t = 0; t < termsPerMonth; t++) {
      if (Math.random() < rolloverProbability) {
        totalFees += terms.rolloverFee || feePerTerm;
        totalPaid += terms.rolloverFee || feePerTerm;
        rollovers++;
      } else {
        totalPaid += balance + feePerTerm;
        totalFees += feePerTerm;
        balance = 0;
        break;
      }
    }
    months.push({ month, balance, totalPaid: Math.round(totalPaid), totalFees: Math.round(totalFees), rollovers });
    if (balance === 0) break;
  }

  const finalTotalPaid = months[months.length - 1].totalPaid;
  const effectiveAPR = balance > 0 ? calculateTrueAPR(terms.principal, finalTotalPaid - terms.principal, 365) : calculateTrueAPR(terms.principal, finalTotalPaid - terms.principal, months.length * 30);

  return DebtSpiralProjectionSchema.parse({
    months,
    totalCostAfter12Months: finalTotalPaid,
    effectiveAPRWithRollovers: Math.round(effectiveAPR),
    timeToPayoff: balance > 0 ? 'Still in debt after 12 months' : `${months.length} months`,
    warning: finalTotalPaid > terms.principal * 2
      ? `WARNING: With typical rollover behavior, a $${terms.principal} loan will cost $${finalTotalPaid.toLocaleString()} — ${(finalTotalPaid / terms.principal).toFixed(1)}x the original amount.`
      : `Total cost with rollovers: $${finalTotalPaid.toLocaleString()}`,
  });
}

function calculateTrueAPR(principal: number, totalFees: number, termDays: number): number {
  if (principal <= 0 || termDays <= 0) return 0;
  return (totalFees / principal) * (365 / termDays) * 100;
}
