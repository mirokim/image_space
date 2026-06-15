/**
 * Claude Vision 분석 — 택소노미 차원으로 이미지를 채점/분류한다.
 * 강제 tool-use 로 구조화 출력을 받는다(전 모델 버전 호환). 결과는 zod 로 검증.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  SCALAR_DIMENSIONS,
  CATEGORICAL_DIMENSIONS,
  buildAnalysisSchema,
  type AnalysisResult,
} from '@imgspace/shared';
import { config } from '../config.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });
const schema = buildAnalysisSchema();

/** 택소노미 → tool input JSON 스키마(raw). */
function buildToolInputSchema() {
  const scoreProps: Record<string, unknown> = {};
  for (const d of SCALAR_DIMENSIONS) {
    scoreProps[d.key] = {
      type: 'number',
      description: `${d.label}: ${d.description} (0=${d.low}, 1=${d.high})`,
    };
  }
  const labelProps: Record<string, unknown> = {};
  for (const d of CATEGORICAL_DIMENSIONS) {
    labelProps[d.key] = {
      type: 'string',
      enum: d.options.map((o) => o.value),
      description: `${d.label}: ${d.description}`,
    };
  }
  return {
    type: 'object',
    properties: {
      caption: { type: 'string', description: '이미지 한 줄 설명(한국어, 30자 내외).' },
      scores: {
        type: 'object',
        properties: scoreProps,
        required: SCALAR_DIMENSIONS.map((d) => d.key),
      },
      labels: {
        type: 'object',
        properties: labelProps,
        required: CATEGORICAL_DIMENSIONS.map((d) => d.key),
      },
    },
    required: ['caption', 'scores', 'labels'],
  };
}

const INSTRUCTION =
  '이 이미지를 분석해서 record_analysis 도구로 결과를 기록하라. ' +
  '각 스칼라 차원은 0~1 사이 값으로, 각 카테고리 차원은 주어진 옵션 중 가장 적합한 하나로 채운다. ' +
  '주관을 배제하고 시각적 근거에 따라 일관되게 평가하라.';

const allowedMime = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export async function analyzeImage(buf: Buffer, mime: string): Promise<AnalysisResult> {
  const mediaType = allowedMime.has(mime) ? mime : 'image/png';
  const b64 = buf.toString('base64');

  const response = await client.messages.create({
    model: config.visionModel,
    max_tokens: 2000,
    tools: [
      {
        name: 'record_analysis',
        description: '이미지 분석 결과(설명·스칼라 점수·카테고리 라벨)를 기록한다.',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input_schema: buildToolInputSchema() as any,
      },
    ],
    tool_choice: { type: 'tool', name: 'record_analysis' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              media_type: mediaType as any,
              data: b64,
            },
          },
          { type: 'text', text: INSTRUCTION },
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Vision: tool_use 응답 없음');
  }
  return schema.parse(toolUse.input);
}
