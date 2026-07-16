import Anthropic from '@anthropic-ai/sdk';
import type { Job } from './types.js';
import { logInfo } from './logger.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface JobQualityResult {
  isSuspect: boolean;
  confidence: number;       // 0–1 how confident the judge is
  flags: string[];          // e.g. ["vague description", "MLM pattern", "no company info"]
  reason: string;
}

const SYSTEM = `You are a job listing quality analyst. Your job is to detect fake, spam, misleading, or low-quality job postings.

Common red flags:
- Vague or copy-paste descriptions with no specific responsibilities
- MLM / pyramid scheme patterns ("unlimited earning potential", "be your own boss", "no experience needed earn $5000/week")
- No real company name or verifiable company info
- Salary claims that are unrealistically high and vague ("$50-$150/hr" with no context)
- "Work from home" + "no experience" + high pay = MLM signal
- Keyword stuffing with no coherent job description
- Fake recruiter patterns ("We are urgently hiring", "immediate openings", "reply to this email")

Respond with valid JSON only.`;

export async function analyzeJobQuality(job: Job): Promise<JobQualityResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { isSuspect: false, confidence: 0, flags: [], reason: 'ANTHROPIC_API_KEY not configured' };
  }

  const desc = job.description ?? '';
  if (desc.length < 100) {
    return { isSuspect: false, confidence: 0, flags: ['no-description'], reason: 'Not enough description to analyze' };
  }

  const prompt = `Analyze this job listing for quality and authenticity:

Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Description (first 800 chars): ${desc.substring(0, 800)}

Is this a legitimate job posting or does it show red flags of being fake, spam, or a scam?

Respond with this exact JSON:
{
  "is_suspect": true | false,
  "confidence": <0.0-1.0>,
  "flags": ["<flag1>", "<flag2>"],
  "reason": "<one sentence summary>"
}`;

  try {
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';
    const response = await client.messages.create({
      model,
      max_tokens: 256,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('');
    const parsed = JSON.parse(raw);
    return {
      isSuspect:  !!parsed.is_suspect,
      confidence: parsed.confidence ?? 0,
      flags:      parsed.flags ?? [],
      reason:     parsed.reason ?? '',
    };
  } catch {
    return { isSuspect: false, confidence: 0, flags: [], reason: 'Analysis failed' };
  }
}

export async function filterSuspectJobs(jobs: Job[]): Promise<{ clean: Job[]; suspect: Job[] }> {
  if (!process.env.ANTHROPIC_API_KEY) return { clean: jobs, suspect: [] };

  const MIN_CONFIDENCE = 0.75;
  const clean: Job[]   = [];
  const suspect: Job[] = [];

  // Only analyze jobs with descriptions and high scores — not worth spending tokens on low-score ones
  const toAnalyze = jobs.filter(j => j.description && j.description.length > 100 && (j.score ?? 0) >= 30);
  const skip      = jobs.filter(j => !j.description || j.description.length <= 100 || (j.score ?? 0) < 30);

  for (const job of toAnalyze) {
    const result = await analyzeJobQuality(job);
    if (result.isSuspect && result.confidence >= MIN_CONFIDENCE) {
      logInfo(`🚩 Job sospechoso (${Math.round(result.confidence * 100)}% confianza): "${job.title}" @ ${job.company} — ${result.reason}`);
      suspect.push(job);
    } else {
      clean.push(job);
    }
  }

  return { clean: [...clean, ...skip], suspect };
}
