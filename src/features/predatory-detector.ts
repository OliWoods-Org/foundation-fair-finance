/**
 * Predatory Lending Detector
 *
 * Maps lender density against demographics, identifies predatory targeting
 * patterns, and enables CFPB complaint filing.
 *
 * @module predatory-detector
 * @license GPL-3.0
 * @author OliWoods Foundation
 */

import { z } from 'zod';

export const LenderLocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['payday', 'title-loan', 'pawnshop', 'rent-to-own', 'check-cashing', 'buy-here-pay-here', 'subprime-mortgage']),
  address: z.object({ street: z.string(), city: z.string(), state: z.string(), zip: z.string(), lat: z.number(), lng: z.number() }),
  stateRegulated: z.boolean(),
  licenseNumber: z.string().optional(),
  complaintsCount: z.number().int().nonnegative().default(0),
});

export const CensusTrackDataSchema = z.object({
  tractId: z.string(),
  population: z.number().int().positive(),
  medianIncome: z.number().nonnegative(),
  percentMinority: z.number().min(0).max(100),
  percentBelowPoverty: z.number().min(0).max(100),
  percentUnbanked: z.number().min(0).max(100),
  bankBranchCount: z.number().int().nonnegative(),
  paydayLenderCount: z.number().int().nonnegative(),
  creditUnionCount: z.number().int().nonnegative(),
});

export const TargetingAnalysisSchema = z.object({
  tractId: z.string(),
  predatoryLenderDensity: z.number(),
  bankDesertScore: z.number().min(0).max(100),
  targetingScore: z.number().min(0).max(100),
  disparityRatio: z.number(),
  findings: z.array(z.string()),
  recommendation: z.string(),
});

export const CFPBComplaintSchema = z.object({
  id: z.string().uuid(),
  product: z.enum(['payday-loan', 'title-loan', 'personal-loan', 'mortgage', 'credit-card', 'debt-collection', 'credit-reporting', 'student-loan']),
  issue: z.string(),
  subIssue: z.string().optional(),
  companyName: z.string(),
  state: z.string(),
  narrative: z.string(),
  desiredResolution: z.string(),
  documentsAttached: z.array(z.string()),
  createdAt: z.string().datetime(),
});

export type LenderLocation = z.infer<typeof LenderLocationSchema>;
export type CensusTrackData = z.infer<typeof CensusTrackDataSchema>;
export type TargetingAnalysis = z.infer<typeof TargetingAnalysisSchema>;
export type CFPBComplaint = z.infer<typeof CFPBComplaintSchema>;

/**
 * Analyze predatory lending targeting patterns within a census tract.
 */
export function analyzeTargeting(tract: CensusTrackData, lenders: LenderLocation[]): TargetingAnalysis {
  const tractLenders = lenders.filter(l =>
    ['payday', 'title-loan', 'check-cashing', 'rent-to-own'].includes(l.type),
  );

  const predatoryDensity = tract.population > 0 ? (tractLenders.length / tract.population) * 10000 : 0;
  const bankDesertScore = tract.bankBranchCount === 0 ? 100
    : tract.bankBranchCount === 1 ? 70
    : Math.max(0, 50 - tract.bankBranchCount * 10);

  // Calculate targeting score
  let targetingScore = 0;
  targetingScore += Math.min(30, predatoryDensity * 10);
  targetingScore += bankDesertScore * 0.25;
  targetingScore += tract.percentBelowPoverty * 0.3;
  targetingScore += tract.percentUnbanked * 0.4;
  targetingScore = Math.min(100, Math.round(targetingScore));

  // Disparity ratio: predatory lenders per capita vs bank branches per capita
  const predatoryPerCapita = tract.population > 0 ? tractLenders.length / tract.population : 0;
  const bankPerCapita = tract.population > 0 ? tract.bankBranchCount / tract.population : 0;
  const disparityRatio = bankPerCapita > 0 ? Math.round((predatoryPerCapita / bankPerCapita) * 100) / 100 : predatoryPerCapita > 0 ? 999 : 0;

  const findings: string[] = [];
  if (predatoryDensity > 2) findings.push(`High concentration of predatory lenders: ${tractLenders.length} per ${tract.population.toLocaleString()} residents`);
  if (bankDesertScore > 60) findings.push(`Banking desert: only ${tract.bankBranchCount} bank branches serving the community`);
  if (tract.percentMinority > 50 && predatoryDensity > 1) findings.push(`Potential racial targeting: ${tract.percentMinority}% minority community with elevated predatory lender presence`);
  if (disparityRatio > 3) findings.push(`Predatory lenders outnumber banks ${disparityRatio}:1`);

  const recommendation = targetingScore > 70
    ? 'URGENT: This community shows strong indicators of predatory targeting. File complaints with the state AG and CFPB.'
    : targetingScore > 40
    ? 'This community has elevated predatory lending risk. Promote credit union and CDFI alternatives.'
    : 'Normal lending landscape. Continue monitoring.';

  return TargetingAnalysisSchema.parse({
    tractId: tract.tractId,
    predatoryLenderDensity: Math.round(predatoryDensity * 100) / 100,
    bankDesertScore,
    targetingScore,
    disparityRatio,
    findings,
    recommendation,
  });
}

/**
 * Generate a CFPB complaint from structured inputs.
 */
export function generateCFPBComplaint(
  product: CFPBComplaint['product'],
  companyName: string,
  state: string,
  issue: string,
  details: { loanAmount?: number; apr?: number; feesCharged?: number; description: string; desiredResolution: string },
): CFPBComplaint {
  const narrative = [
    details.description,
    details.loanAmount ? `Original loan amount: $${details.loanAmount.toLocaleString()}.` : '',
    details.apr ? `I was charged an APR of ${details.apr}%.` : '',
    details.feesCharged ? `Total fees charged: $${details.feesCharged.toLocaleString()}.` : '',
  ].filter(Boolean).join(' ');

  return CFPBComplaintSchema.parse({
    id: crypto.randomUUID(),
    product,
    issue,
    companyName,
    state,
    narrative,
    desiredResolution: details.desiredResolution,
    documentsAttached: [],
    createdAt: new Date().toISOString(),
  });
}

/**
 * Find CDFI and credit union alternatives near a location.
 */
export function findAlternatives(
  location: { lat: number; lng: number },
  radiusMiles: number,
  providers: Array<{ name: string; type: string; lat: number; lng: number; maxLoan: number; maxAPR: number; services: string[] }>,
): Array<{ name: string; type: string; distance: number; maxAPR: number; services: string[] }> {
  return providers
    .map(p => {
      const R = 3959;
      const dLat = (p.lat - location.lat) * Math.PI / 180;
      const dLng = (p.lng - location.lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(location.lat * Math.PI / 180) * Math.cos(p.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return { ...p, distance: Math.round(distance * 10) / 10 };
    })
    .filter(p => p.distance <= radiusMiles)
    .sort((a, b) => a.distance - b.distance)
    .map(({ name, type, distance, maxAPR, services }) => ({ name, type, distance, maxAPR, services }));
}
