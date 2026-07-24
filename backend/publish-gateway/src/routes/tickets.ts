import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';
import { safeFetchWebsite } from '../services/safe-http-fetch';

const router = Router();

// List tickets
router.get('/tickets', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const where = status && status !== 'all' ? { status } : {};
    const tickets = await prisma.ticket.findMany({
      where,
      include: { photos: true, diagnosis: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: tickets });
  } catch (error) {
    next(new AppError(500, 'internal_error', 'Failed to fetch tickets'));
  }
});

// Get ticket detail
router.get('/tickets/:id', async (req, res, next) => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: { photos: true, diagnosis: true },
    });
    if (!ticket) {
      throw new AppError(404, 'not_found', 'Ticket not found');
    }
    res.json({ success: true, data: ticket });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(500, 'internal_error', 'Failed to fetch ticket'));
  }
});

// Create ticket
router.post('/tickets', async (req, res, next) => {
  try {
    const { companyName, address, website, industry, phone, painPoints, contactName, contactEmail, contactPhone } = req.body;
    if (!companyName || !address || !industry) {
      throw new AppError(400, 'validation_error', 'companyName, address, industry are required');
    }
    const ticket = await prisma.ticket.create({
      data: { companyName, address, website, industry, phone, painPoints, contactName, contactEmail, contactPhone },
    });
    res.json({ success: true, data: ticket });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(500, 'internal_error', 'Failed to create ticket'));
  }
});

// Update ticket status
router.patch('/tickets/:id', async (req, res, next) => {
  try {
    const { status, assignedTo, priority } = req.body;
    const data: Record<string, unknown> = {};
    if (status) data.status = status;
    if (assignedTo !== undefined) data.assignedTo = assignedTo;
    if (priority) data.priority = priority;
    const ticket = await prisma.ticket.update({ where: { id: req.params.id }, data });
    res.json({ success: true, data: ticket });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(500, 'internal_error', 'Failed to update ticket'));
  }
});

// Upload ticket photo
router.post('/tickets/:id/photos', async (req, res, next) => {
  try {
    const { url, caption, type } = req.body;
    if (!url) {
      throw new AppError(400, 'validation_error', 'url is required');
    }
    const photo = await prisma.ticketPhoto.create({
      data: { ticketId: req.params.id, url, caption, type },
    });
    res.json({ success: true, data: photo });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(500, 'internal_error', 'Failed to upload photo'));
  }
});

// Delete ticket photo
router.delete('/tickets/:ticketId/photos/:photoId', async (req, res, next) => {
  try {
    await prisma.ticketPhoto.delete({ where: { id: req.params.photoId } });
    res.json({ success: true });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(500, 'internal_error', 'Failed to delete photo'));
  }
});

// Trigger diagnosis
router.post('/tickets/:id/diagnose', async (req, res, next) => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: { photos: true },
    });
    if (!ticket) {
      throw new AppError(404, 'not_found', 'Ticket not found');
    }
    await prisma.ticket.update({ where: { id: req.params.id }, data: { status: 'diagnosing' } });

    // Run diagnosis async
    runDiagnosis(ticket.id).catch(err => console.error('[diagnosis] failed:', err));

    res.json({ success: true, data: { message: 'Diagnosis started' } });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(500, 'internal_error', 'Failed to start diagnosis'));
  }
});

// Get diagnosis report
router.get('/tickets/:id/report', async (req, res, next) => {
  try {
    const report = await prisma.diagnosisReport.findUnique({
      where: { ticketId: req.params.id },
    });
    if (!report) {
      throw new AppError(404, 'not_found', 'Report not found');
    }
    res.json({ success: true, data: report });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(500, 'internal_error', 'Failed to fetch report'));
  }
});

// ---- GEO Diagnosis Engine ----

async function runDiagnosis(ticketId: string): Promise<void> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { photos: true },
  });
  if (!ticket) return;

  try {
    console.log(`[diagnosis] Starting for ticket ${ticketId}: ${ticket.companyName}`);

    // Step 1: Collect data
    const rawData = await collectData(ticket);
    console.log(`[diagnosis] Data collected for ${ticket.companyName}`);

    // Step 2: AI search test - ask AI engines about this company
    const aiSearchResults = await runAISearchTest(ticket);
    console.log(`[diagnosis] AI search test done: ${aiSearchResults.length} queries`);

    // Step 3: AI diagnosis
    const diagnosis = await runAIDiagnosis(ticket, rawData, aiSearchResults);
    console.log(`[diagnosis] AI diagnosis done, SoM score: ${diagnosis.somScore}`);

    // Step 4: Save report
    await prisma.diagnosisReport.create({
      data: {
        ticketId,
        status: 'draft',
        somScore: diagnosis.somScore,
        somChatgpt: diagnosis.somChatgpt,
        somGemini: diagnosis.somGemini,
        somPerplexity: diagnosis.somPerplexity,
        scoreGmb: diagnosis.scoreGmb,
        scoreWeb: diagnosis.scoreWeb,
        scoreContent: diagnosis.scoreContent,
        scoreTrust: diagnosis.scoreTrust,
        scoreLocal: diagnosis.scoreLocal,
        aiSearchResults: aiSearchResults as any,
        coreFindings: diagnosis.coreFindings as any,
        competitors: diagnosis.competitors as any,
        recommendations: diagnosis.recommendations as any,
        revenueImpact: diagnosis.revenueImpact as any,
        summary: diagnosis.summary,
        fullReport: diagnosis.fullReport,
      },
    });

    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'completed' } });
    console.log(`[diagnosis] Report saved for ticket ${ticketId}`);
  } catch (error) {
    console.error(`[diagnosis] Error for ticket ${ticketId}:`, error);
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'pending' } });
  }
}

async function collectData(ticket: any): Promise<any> {
  const data: any = { company: ticket.companyName, address: ticket.address, industry: ticket.industry };

  // Collect website data if available
  if (ticket.website) {
    try {
      const result = await safeFetchWebsite(ticket.website);
      const html = result.body;
      data.website = {
        url: result.url,
        htmlLength: html.length,
        hasSchema: html.includes('application/ld+json'),
        hasViewport: html.includes('viewport'),
        titleMatch: html.match(/<title>(.*?)<\/title>/)?.[1] || '',
        metaDesc: html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/)?.[1] || '',
        h1Count: (html.match(/<h1/g) || []).length,
        imgWithoutAlt: (html.match(/<img[^>]*(?!alt=)[^>]*>/g) || []).length,
        hasSSL: ticket.website.startsWith('https'),
      };
    } catch {
      data.website = { url: ticket.website, error: 'Website could not be safely fetched' };
    }
  }

  return data;
}

async function runAISearchTest(ticket: any): Promise<any[]> {
  const questions = [
    `Who is the best ${ticket.industry} company in ${ticket.address}?`,
    `Recommend a reliable ${ticket.industry} service near ${ticket.address}`,
    `What do people say about ${ticket.companyName}?`,
    `How to choose a good ${ticket.industry} contractor in ${ticket.address}?`,
    `${ticket.companyName} reviews and reputation`,
  ];

  const results: any[] = [];

  for (const question of questions) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY || '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 500,
          messages: [{ role: 'user', content: question }],
        }),
      });

      const data: any = await response.json();
      const answer = data.content?.[0]?.text || '';
      const mentioned = answer.toLowerCase().includes(ticket.companyName.toLowerCase());

      results.push({
        platform: 'Claude',
        question,
        mentioned,
        position: mentioned ? estimatePosition(answer, ticket.companyName) : -1,
        quote: mentioned ? extractQuote(answer, ticket.companyName) : '',
        answerSnippet: answer.slice(0, 300),
      });
    } catch (err) {
      results.push({ platform: 'Claude', question, mentioned: false, error: String(err) });
    }
  }

  return results;
}

function estimatePosition(answer: string, companyName: string): number {
  const lower = answer.toLowerCase();
  const nameLower = companyName.toLowerCase();
  const idx = lower.indexOf(nameLower);
  if (idx === -1) return -1;
  // Rough position based on character position
  const before = answer.slice(0, idx);
  const numbers = before.match(/\d+[.)]/g) || [];
  return numbers.length + 1;
}

function extractQuote(answer: string, companyName: string): string {
  const sentences = answer.split(/[.!?]+/);
  const relevant = sentences.filter(s => s.toLowerCase().includes(companyName.toLowerCase()));
  return relevant[0]?.trim().slice(0, 200) || '';
}

async function runAIDiagnosis(ticket: any, rawData: any, aiSearchResults: any[]): Promise<any> {
  const mentionedCount = aiSearchResults.filter(r => r.mentioned).length;
  const totalQueries = aiSearchResults.length;

  const prompt = `You are a senior GEO (Generative Engine Optimization) expert with 15 years of experience helping local service businesses (HVAC, plumbing, electrical) improve their visibility in AI search engines.

Diagnose this business:

Company: ${ticket.companyName}
Address: ${ticket.address}
Industry: ${ticket.industry}
Website: ${ticket.website || 'Not provided'}
Pain points: ${ticket.painPoints || 'Not specified'}

Website data: ${JSON.stringify(rawData.website || {})}

AI Search Test Results:
${aiSearchResults.map(r => `Q: "${r.question}" → Mentioned: ${r.mentioned}${r.quote ? ` | Quote: "${r.quote}"` : ''}`).join('\n')}

Analyze from these GEO-specific dimensions:

1. AI VISIBILITY (Share of Model):
   - How often do AI engines recommend this company? (${mentionedCount}/${totalQueries})
   - Why or why not?
   - What information is missing that AI needs to recommend them?

2. INFORMATION COMPLETENESS:
   - Is the company's data consistent across all platforms?
   - What key information is AI missing about this business?
   - Are services, service area, hours, and contact info complete?

3. TRUST SIGNALS:
   - Does AI have enough trust signals to recommend this company?
   - Reviews, ratings, certifications, awards, years in business?
   - What trust gaps exist?

4. CONTENT AUTHORITY:
   - Does the website have authoritative content AI can reference?
   - Service descriptions, FAQ, case studies, blog posts?
   - What content is missing that would help AI understand this business?

5. COMPETITOR GAP:
   - Who are the top 3 competitors in this area?
   - What do competitors have that this company doesn't?
   - What's the biggest opportunity?

Output a JSON object with this exact structure:
{
  "somScore": <0-100, overall AI visibility score>,
  "somChatgpt": <estimated ChatGPT visibility>,
  "somGemini": <estimated Gemini visibility>,
  "somPerplexity": <estimated Perplexity visibility>,
  "scoreGmb": <0-100, GBP completeness>,
  "scoreWeb": <0-100, website quality for GEO>,
  "scoreContent": <0-100, content authority>,
  "scoreTrust": <0-100, trust signals>,
  "scoreLocal": <0-100, local presence>,
  "coreFindings": [{"severity": "critical|major|minor", "title": "...", "detail": "...", "recommendation": "...", "impact": "..."}],
  "competitors": [{"name": "...", "somScore": <number>, "rating": <number>, "reviewCount": <number>, "strengths": "..."}],
  "recommendations": [{"priority": "high|medium|low", "action": "...", "impact": "...", "effort": "...", "timeline": "..."}],
  "revenueImpact": {"currentEstimate": "...", "projectedEstimate": "...", "gain": "..."},
  "summary": "<2-3 sentence executive summary>",
  "fullReport": "<Full markdown report with all sections>"
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data: any = await response.json();
  const text = data.content?.[0]?.text || '';

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  // Fallback
  return {
    somScore: mentionedCount / totalQueries * 100,
    summary: text.slice(0, 500),
    fullReport: text,
  };
}

export default router;
