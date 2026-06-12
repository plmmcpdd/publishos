export type BannedWordLevel = 'BLOCK' | 'WARN';

export interface BannedWordRule {
  id: string;
  word: string;
  level: BannedWordLevel;
  category: string;
  jurisdiction?: string[];
  reason: string;
  suggestedAlternative?: string;
}

export const BANNED_WORDS: BannedWordRule[] = [
  { id: 'BL01', word: 'licensed', level: 'BLOCK', category: 'licensing claim', reason: 'Do not claim a blue-collar license unless it has been verified.', suggestedAlternative: 'trained professional' },
  { id: 'BL02', word: 'certified', level: 'BLOCK', category: 'licensing claim', reason: 'Certification claims can require specific proof in some states.', suggestedAlternative: 'experienced technician' },
  { id: 'BL03', word: 'guaranteed', level: 'BLOCK', category: 'absolute promise', reason: 'Guaranteed results can violate advertising rules.', suggestedAlternative: 'we stand behind our work' },
  { id: 'BL04', word: 'best', level: 'BLOCK', category: 'superlative claim', reason: 'Superlative claims require verifiable evidence.', suggestedAlternative: 'top-rated in [area]' },
  { id: 'BL05', word: '#1', level: 'BLOCK', category: 'ranking claim', reason: 'Number-one ranking claims require third-party verification.', suggestedAlternative: 'highly rated' },
  { id: 'BL06', word: 'free.*inspection', level: 'BLOCK', category: 'pricing claim', reason: 'Free inspection claims can trigger consumer protection requirements.', suggestedAlternative: 'complimentary assessment (terms apply)' },
  { id: 'BL07', word: 'act now', level: 'BLOCK', category: 'high-pressure sales', reason: 'Urgency language can be considered misleading when not substantiated.', suggestedAlternative: 'schedule today' },
  { id: 'BL08', word: 'limited time only', level: 'BLOCK', category: 'high-pressure sales', reason: 'Limited-time claims need a true expiration date.', suggestedAlternative: 'offer valid through [date]' },
  { id: 'WN01', word: 'cheap', level: 'WARN', category: 'brand risk', reason: 'Cheap can imply low quality.', suggestedAlternative: 'affordable' },
  { id: 'WN02', word: 'quick fix', level: 'WARN', category: 'quality claim', reason: 'Quick fix can imply a temporary solution.', suggestedAlternative: 'efficient solution' },
  { id: 'WN03', word: 'as low as', level: 'WARN', category: 'pricing claim', reason: 'Lowest-price claims need complete terms.', suggestedAlternative: 'pricing starting at' },
  { id: 'WN04', word: 'emergency', level: 'WARN', category: 'urgency claim', reason: 'Use only when emergency service is genuinely available.', suggestedAlternative: 'urgent service available' },
];

function needsWordBoundary(value: string): boolean {
  return /^[A-Za-z0-9]/.test(value) && /[A-Za-z0-9]$/.test(value);
}

export function buildMatcher(rule: BannedWordRule): RegExp {
  const pattern = needsWordBoundary(rule.word)
    ? `\\b${rule.word}\\b`
    : rule.word;
  return new RegExp(pattern, 'gi');
}
