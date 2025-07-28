import { GoogleGenAI } from "@google/genai"
import type { JWTInput } from "google-auth-library"
import { IEmbedder, EmbeddingResponse, EmbedderInfo } from "../interfaces/embedder"
import { GEMINI_MAX_ITEM_TOKENS } from "../constants"
import { t } from "../../../i18n"
import { TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { safeJsonParse } from "../../../shared/safeJsonParse"

export class VertexAIEmbedder implements IEmbedder {
	private readonly client: GoogleGenAI
	private static readonly DEFAULT_MODEL = "gemini-embedding-001"
	private readonly modelId: string
	private readonly hasCredentials: boolean

	constructor(
		vertexAIOptions: {
			vertexProjectId?: string
			vertexRegion?: string
			vertexJsonCredentials?: string
			vertexKeyFile?: string
		},
		modelId?: string,
	) {
		const hasJsonCredentials =
			vertexAIOptions?.vertexJsonCredentials && vertexAIOptions.vertexJsonCredentials.trim() !== ""
		const hasKeyFile = vertexAIOptions?.vertexKeyFile && vertexAIOptions.vertexKeyFile.trim() !== ""

		if (!hasJsonCredentials && !hasKeyFile) {
			throw new Error(t("embeddings:vertexAIConfigurationFailed"))
		}

		this.modelId = modelId || VertexAIEmbedder.DEFAULT_MODEL

		const project = vertexAIOptions.vertexProjectId ?? "not-provided"
		const location = vertexAIOptions.vertexRegion ?? "us-central1"

		if (hasJsonCredentials) {
			this.client = new GoogleGenAI({
				vertexai: true,
				project,
				location,
				googleAuthOptions: {
					credentials: safeJsonParse<JWTInput>(vertexAIOptions.vertexJsonCredentials!, undefined),
				},
			})
			this.hasCredentials = true
		} else if (hasKeyFile) {
			this.client = new GoogleGenAI({
				vertexai: true,
				project,
				location,
				googleAuthOptions: { keyFile: vertexAIOptions.vertexKeyFile! },
			})
			this.hasCredentials = true
		} else {
			this.client = new GoogleGenAI({ vertexai: true, project, location })
			this.hasCredentials = false
		}
	}

	async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
		try {
			const modelToUse = model || this.modelId

			const embeddings: number[][] = []

			for (const text of texts) {
				const truncatedText = this.truncateText(text, GEMINI_MAX_ITEM_TOKENS)

				const result = await this.client.models.embedContent({
					model: modelToUse,
					contents: { parts: [{ text: truncatedText }] },
				})

				if (result.embeddings && result.embeddings.length > 0 && result.embeddings[0].values) {
					embeddings.push(result.embeddings[0].values)
				} else {
					throw new Error(`No embedding returned for text: ${truncatedText.substring(0, 100)}...`)
				}
			}

			return {
				embeddings,
				usage: {
					promptTokens: texts.reduce((sum, text) => sum + this.estimateTokens(text), 0),
					totalTokens: texts.reduce((sum, text) => sum + this.estimateTokens(text), 0),
				},
			}
		} catch (error) {
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				location: "VertexAIEmbedder:createEmbeddings",
			})
			throw error
		}
	}

	async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
		try {
			if (!this.hasCredentials) {
				return {
					valid: false,
					error: t("embeddings:vertexAIConfigurationFailed"),
				}
			}

			return { valid: true }
		} catch (error) {
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				location: "VertexAIEmbedder:validateConfiguration",
			})

			return {
				valid: false,
				error: t("embeddings:vertexAIConfigurationFailed"),
			}
		}
	}

	private truncateText(text: string, maxTokens: number): string {
		const maxChars = maxTokens * 4
		if (text.length <= maxChars) {
			return text
		}
		return text.substring(0, maxChars)
	}

	private estimateTokens(text: string): number {
		return Math.ceil(text.length / 4)
	}

	get embedderInfo(): EmbedderInfo {
		return {
			name: "vertex-ai",
		}
	}
}
