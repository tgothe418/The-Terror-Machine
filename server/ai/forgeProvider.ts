/* eslint-disable @typescript-eslint/no-explicit-any */
import { getAiClient } from '../utils/aiClient';
import { getGeminiPolicy, getEngineProvider } from './modelPolicy';
import { getLocalForgeModel } from './voiceProviderPolicy';
import * as localVoiceClient from '../utils/localVoiceClient';
import * as zaiClient from '../utils/zaiClient';
import * as hemmingwayClient from '../utils/hemmingwayClient';

export interface ForgePromptOptions {
  systemInstruction?: string;
  inlineData?: { mimeType: string; data: string };
  policyKey?: 'FORGE_ARCHITECTURE' | 'FORGE_PREVIEW' | 'LORE_ANALYSIS';
  responseMimeType?: string;
  pageImages?: string[];
}

export interface ForgePromptMeta {
  text: string;
  finish_reason: string | null;
}

export async function executeForgePromptWithMeta(
  prompt: string,
  options?: ForgePromptOptions
): Promise<ForgePromptMeta> {
  const engineProvider = getEngineProvider();
  if (engineProvider === 'local' || engineProvider === 'zai' || engineProvider === 'hemmingway') {
    let textPrompt = '';
    if (options?.systemInstruction) {
      textPrompt += `[SYSTEM INSTRUCTION]\n${options.systemInstruction}\n\n`;
    }
    textPrompt += prompt;
    let images: Array<{ mimeType: string; data: string } | string> | undefined;
    if (options?.pageImages && options.pageImages.length > 0) {
      images = [...options.pageImages];
    }

    if (options?.inlineData) {
      const { mimeType, data } = options.inlineData;
      if (mimeType.startsWith('image/')) {
        images = images ? [...images, options.inlineData] : [options.inlineData];
      } else if (mimeType === 'application/pdf') {
        const pdfBuffer = Buffer.from(data, 'base64');
        try {
          const { PDFParse } = await import('pdf-parse');
          const parser = new PDFParse({ data: pdfBuffer });
          const isLocal = engineProvider === 'local';
          const maxPages = isLocal ? 25 : 100;
          const textResult = await parser.getText({ first: maxPages });
          let extractedText = textResult?.text ? textResult.text.trim() : '';
          const maxChars = isLocal ? 28000 : 120000;
          if (extractedText.length > maxChars) {
            extractedText = extractedText.slice(0, maxChars) + '\n\n[... Remaining pages truncated for local 16K context budget ...]';
          }
          if (extractedText) {
            textPrompt += `\n\n--- EXTRACTED PDF TEXT CONTENT (First ${maxPages} Pages) ---\n${extractedText}\n--- END EXTRACTED PDF TEXT CONTENT ---`;
          }
          try {
            const screenshotRes = await parser.getScreenshot({ partial: [1, 2, 3], imageDataUrl: true });
            if (screenshotRes?.pages?.length) {
              const shots: string[] = [];
              for (const pg of screenshotRes.pages) {
                if (pg.dataUrl) {
                  shots.push(pg.dataUrl);
                }
              }
              if (shots.length > 0) {
                images = images ? [...images, ...shots] : shots;
              }
            }
          } catch (shotErr) {
            console.warn('[FORGE PDF SCREENSHOT WARN]', shotErr);
          }
          await parser.destroy();
        } catch (pdfErr) {
          console.error('[FORGE PDF PARSE ERROR]', pdfErr);
        }
      } else if (
        mimeType.startsWith('text/') ||
        mimeType === 'application/json' ||
        mimeType.includes('yaml') ||
        mimeType.includes('xml')
      ) {
        let docText = Buffer.from(data, 'base64').toString('utf-8');
        const isLocal = engineProvider === 'local';
        const maxChars = isLocal ? 28000 : 120000;
        if (docText.length > maxChars) {
          docText = docText.slice(0, maxChars) + '\n\n[... Remaining text truncated for local 16K context budget ...]';
        }
        textPrompt += `\n\n--- SOURCE DOCUMENT CONTENT ---\n${docText}\n--- END SOURCE DOCUMENT CONTENT ---`;
      }
    }

    if (engineProvider === 'hemmingway') {
      const hasMetaMock = Boolean((hemmingwayClient.generateHemmingwayTextWithMeta as any)?.mock);
      const hasTextMock = Boolean((hemmingwayClient.generateHemmingwayText as any)?.mock);
      if (hasTextMock && !hasMetaMock) {
        const text = await hemmingwayClient.generateHemmingwayText(textPrompt, {
          jsonMode: options?.responseMimeType === 'application/json',
          maxTokens: 4096,
          timeoutMs: 300_000,
        });
        return { text, finish_reason: 'stop' };
      }
      const res = await hemmingwayClient.generateHemmingwayTextWithMeta(textPrompt, {
        jsonMode: options?.responseMimeType === 'application/json',
        maxTokens: 4096,
        timeoutMs: 300_000,
      });
      return { text: res.text, finish_reason: res.finish_reason };
    }

    if (engineProvider === 'zai') {
      const hasMetaMock = Boolean((zaiClient.generateZaiTextWithMeta as any)?.mock);
      const hasTextMock = Boolean((zaiClient.generateZaiText as any)?.mock);
      if (hasTextMock && !hasMetaMock) {
        const text = await zaiClient.generateZaiText(textPrompt, {
          jsonMode: options?.responseMimeType === 'application/json',
          maxTokens: 4096,
          timeoutMs: 300_000,
        });
        return { text, finish_reason: 'stop' };
      }
      const res = await zaiClient.generateZaiTextWithMeta(textPrompt, {
        jsonMode: options?.responseMimeType === 'application/json',
        maxTokens: 4096,
        timeoutMs: 300_000,
      });
      return { text: res.text, finish_reason: res.finish_reason };
    }

    const forgeModel = getLocalForgeModel();
    const isVisionModel = /vl|vision|minicpm-v|llava|pixtral|omni/i.test(forgeModel);
    const localImages = isVisionModel ? images : undefined;
    const localHasMetaMock = Boolean((localVoiceClient.generateLocalTextWithMeta as any)?.mock);
    const localHasTextMock = Boolean((localVoiceClient.generateLocalText as any)?.mock);
    if (localHasTextMock && !localHasMetaMock) {
      const text = await localVoiceClient.generateLocalText(textPrompt, {
        model: forgeModel,
        jsonMode: options?.responseMimeType === 'application/json',
        images: localImages,
        max_tokens: 16384,
        timeoutMs: 300_000,
      });
      return { text, finish_reason: 'stop' };
    }
    const res = await localVoiceClient.generateLocalTextWithMeta(textPrompt, {
      model: forgeModel,
      jsonMode: options?.responseMimeType === 'application/json',
      images: localImages,
      max_tokens: 16384,
      timeoutMs: 300_000,
    });
    return { text: res.text, finish_reason: res.finish_reason };
  }

  const aiClient = getAiClient();
  const policy = getGeminiPolicy(options?.policyKey || 'FORGE_ARCHITECTURE');
  const contents = options?.inlineData
    ? [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: options.inlineData },
          ],
        },
      ]
    : prompt;

  const config: any = {
    thinkingConfig: {
      thinkingLevel: policy.thinkingLevel,
    },
  };
  if (options?.systemInstruction) {
    config.systemInstruction = options.systemInstruction;
  }
  if (options?.responseMimeType) {
    config.responseMimeType = options.responseMimeType;
  }

  const response = await aiClient.models.generateContent({
    model: policy.model,
    contents,
    config,
  });

  const rawFinish = (response as any).candidates?.[0]?.finishReason ?? null;
  const isLength = typeof rawFinish === 'string' && (
    rawFinish === 'MAX_TOKENS' ||
    rawFinish.toLowerCase() === 'length' ||
    rawFinish.toLowerCase() === 'max_tokens'
  );
  const finish_reason = isLength ? 'length' : rawFinish;

  return {
    text: response.text || '',
    finish_reason,
  };
}

export async function executeForgePrompt(
  prompt: string,
  options?: ForgePromptOptions
): Promise<string> {
  return (await executeForgePromptWithMeta(prompt, options)).text;
}
