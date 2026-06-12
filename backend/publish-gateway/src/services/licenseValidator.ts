import type { PrismaClient } from '@prisma/client';

export interface LicenseValidationResult {
  status: string;
  canUse: boolean;
  reason?: string;
}

export function computeLicenseStatus(license: any): LicenseValidationResult {
  if (!license) {
    return { status: 'PENDING', canUse: false, reason: 'Missing license chain record' };
  }

  if (license.status === 'REVOKED') {
    return { status: 'REVOKED', canUse: false, reason: 'License has been revoked' };
  }

  if (license.status === 'NOT_REQUIRED') {
    return { status: 'NOT_REQUIRED', canUse: true };
  }

  const now = new Date();
  if (now < license.validFrom) {
    return { status: 'PENDING', canUse: false, reason: 'License is not active yet' };
  }

  if (!license.isPerpetual && license.validUntil && now > license.validUntil) {
    return { status: 'EXPIRED', canUse: false, reason: `License expired at ${license.validUntil.toISOString()}` };
  }

  if (!license.commercialUse) {
    return { status: 'REVOKED', canUse: false, reason: 'License does not allow commercial use' };
  }

  return { status: 'VALID', canUse: true };
}

export async function validateContentLicenses(
  contentId: string,
  prisma: PrismaClient,
): Promise<{
  passed: boolean;
  failures: { assetId: string; assetName: string; reason: string }[];
}> {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: { assets: true },
  });

  if (!content) {
    return {
      passed: false,
      failures: [{ assetId: '', assetName: 'Content', reason: 'Content not found' }],
    };
  }

  // For now, check if any stock_video assets have licenseId
  const failures = content.assets
    .filter((a) => a.type === 'stock_video' && !a.licenseId)
    .map((a) => ({
      assetId: a.id,
      assetName: a.description || a.url,
      reason: 'Stock video asset missing license reference',
    }));

  return { passed: failures.length === 0, failures };
}
