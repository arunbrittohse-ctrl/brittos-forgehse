/**
 * Provider-independent generation for the HSE Document Studio.
 *
 *   1. The deterministic template generator (packages/shared/src/documents/generate.ts) ALWAYS produces
 *      the document. It needs no network, no key and no paid service.
 *   2. Optionally, a SuggestionProvider adds suggestions. Each suggestion is merged with origin "model",
 *      has no risk ratings and blocks submission until a person accepts or removes it.
 *
 * Any backend can be plugged in by implementing SuggestionProvider. The built-in one uses the server's
 * configured AI backend, but only when that backend is a real language model (a locally hosted
 * OpenAI-compatible server such as Ollama, or Anthropic if an operator chooses to configure it).
 * The local rules engine is NOT a model, so it is never offered as one, and the generator record
 * says `modelCalled: true` only after a model actually answered.
 */
import {
  generateDocument, mergeModelSuggestions, modelSuggestionSchema, MODEL_SUGGESTION_JSON_SCHEMA, TEMPLATE_VERSION, docType, asText, asList,
  type DocContent, type DocGenerator, type DocInputs, type DocTypeKey, type ModelSuggestions, type RiskMatrixConfig,
} from '@forgehse/shared';
import { AiError, type ClaudeService, type ContentBlock } from '../ai/claude';

export interface SuggestionRequest { docType: DocTypeKey; inputs: DocInputs; content: DocContent }

export interface SuggestionProvider {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  suggest(req: SuggestionRequest): Promise<ModelSuggestions>;
}

/** Wraps the server's configured AI backend; only constructed when that backend is a real model. */
export class AiServiceSuggestionProvider implements SuggestionProvider {
  constructor(private ai: ClaudeService) {}
  get id() { return this.ai.provider.id; }
  get label() { return this.ai.provider.label; }
  get model() { return this.ai.provider.model; }

  async suggest(req: SuggestionRequest): Promise<ModelSuggestions> {
    const t = docType(req.docType);
    const facts = [
      `Document type: ${t.label}`,
      `Title: ${asText(req.inputs.title)}`,
      `Activity: ${asText(req.inputs.activity) || 'not stated'}`,
      `Work steps: ${asList(req.inputs.sequence).join(' / ') || 'not stated'}`,
      `Equipment: ${asList(req.inputs.equipment).join(', ') || 'not stated'}`,
      `Selected hazards: ${asList(req.inputs.hazards).join(', ') || 'none'}`,
      `Site conditions: ${asText(req.inputs.environment) || 'not stated'}`,
      `Hazards already covered: ${req.content.riskRows.map((r) => r.hazard).slice(0, 30).join('; ') || 'none'}`,
    ].join('\n');
    const content: ContentBlock[] = [{
      type: 'text',
      text: [
        'You are helping an HSE engineer draft a controlled document. Suggest ONLY additional hazards and points that the template below does not already cover.',
        'Rules: no legal citations, no clause numbers, no authority names, no numeric limits, no phone numbers, no claims of compliance or approval. Use plain language.',
        '<facts>', facts, '</facts>',
      ].join('\n'),
    }];
    const prep = this.ai.prepare({
      messages: [{ role: 'user', content }],
      tools: [{ name: 'emit_document_suggestions', description: 'Return additional hazards and points for the HSE document.', input_schema: MODEL_SUGGESTION_JSON_SCHEMA }],
      toolChoice: { type: 'tool', name: 'emit_document_suggestions' },
      maxTokens: 2000,
    });
    const res = await this.ai.send(prep);
    const use = res.content.find((c): c is Extract<ContentBlock, { type: 'tool_use' }> => c.type === 'tool_use');
    const parsed = modelSuggestionSchema.safeParse(use?.input);
    if (!parsed.success) throw new AiError(502, 'ai_bad_output', 'The model reply was not in the expected format. The template draft was kept without suggestions.');
    return parsed.data;
  }
}

export interface ModelAvailability { available: boolean; provider: string | null; model: string | null; label: string; reason: string }

export class DocumentGenerationService {
  constructor(private provider: SuggestionProvider | null, private providerReason = '') {}

  static fromAi(ai: ClaudeService): DocumentGenerationService {
    const p = ai.provider;
    if (!p.configured || p.id === 'off') return new DocumentGenerationService(null, 'No AI provider is configured on this server.');
    if (p.deterministic) return new DocumentGenerationService(null, 'The server runs the local rules engine, which is not a language model. Configure a locally hosted model (AI_PROVIDER=openai_compatible) to enable suggestions.');
    return new DocumentGenerationService(new AiServiceSuggestionProvider(ai));
  }

  availability(): ModelAvailability {
    if (!this.provider) return { available: false, provider: null, model: null, label: 'Template generator only', reason: this.providerReason };
    return { available: true, provider: this.provider.id, model: this.provider.model, label: this.provider.label, reason: '' };
  }

  async generate(t: DocTypeKey, inputs: DocInputs, o: { matrix: RiskMatrixConfig; organizationName?: string; useModel: boolean; now?: Date }): Promise<{ content: DocContent; generator: DocGenerator }> {
    const content = generateDocument(t, inputs, { matrix: o.matrix, organizationName: o.organizationName });
    const generator: DocGenerator = {
      mode: 'template', templateVersion: TEMPLATE_VERSION, provider: null, model: null, modelCalled: false, modelSuggestions: 0,
      generatedAt: (o.now ?? new Date()).toISOString(),
      note: 'Deterministic template draft. No AI model was called.',
    };
    if (!o.useModel) return { content, generator };
    if (!this.provider) throw new AiError(409, 'model_unavailable', this.providerReason || 'No language model is available for suggestions.');
    const s = await this.provider.suggest({ docType: t, inputs, content });
    const added = mergeModelSuggestions(content, s, docType(t).riskRegister);
    return {
      content,
      generator: {
        ...generator, mode: 'template+model', provider: this.provider.id, model: this.provider.model, modelCalled: true, modelSuggestions: added,
        note: `Template draft plus ${added} suggestion(s) from ${this.provider.label}. Model suggestions are labelled and must be accepted by a person.`,
      },
    };
  }
}
