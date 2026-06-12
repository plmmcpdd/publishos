import { BANNED_WORDS, buildMatcher } from '../config/bannedWords';

export interface ScanHit {
  ruleId: string;
  matchedText: string;
  category: string;
  reason: string;
  suggestion?: string;
}

export interface ScanResult {
  passed: boolean;
  blockers: ScanHit[];
  warnings: ScanHit[];
}

export function scanText(text: string): ScanResult {
  const blockers: ScanHit[] = [];
  const warnings: ScanHit[] = [];

  for (const rule of BANNED_WORDS) {
    const matches = text.match(buildMatcher(rule));
    if (!matches?.length) continue;

    const hit: ScanHit = {
      ruleId: rule.id,
      matchedText: matches[0],
      category: rule.category,
      reason: rule.reason,
      suggestion: rule.suggestedAlternative,
    };

    if (rule.level === 'BLOCK') blockers.push(hit);
    else warnings.push(hit);
  }

  return {
    passed: blockers.length === 0,
    blockers,
    warnings,
  };
}
