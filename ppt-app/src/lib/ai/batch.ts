export const AI_BATCH_SIZE = 12;
export const AI_MAX_RETRIES = 2;

export interface BatchProgress {
  processed: number;
  failed: number;
  currentBatch: number;
  batchCount: number;
}

export interface BatchProcessResult<TOutput> {
  outputs: TOutput[];
  failedIds: string[];
}

export interface BatchAttemptContext {
  /** Stable for every automatic retry of one logical batch. */
  requestId: string;
  attempt: number;
}

export async function processInBatches<TInput extends { id: string }, TOutput>(options: {
  items: TInput[];
  batchSize?: number;
  maxRetries?: number;
  processBatch: (batch: TInput[], context: BatchAttemptContext) => Promise<TOutput[]>;
  onBatchSuccess?: (batch: TInput[], output: TOutput[], progress: BatchProgress) => void;
  onProgress?: (progress: BatchProgress) => void;
}): Promise<BatchProcessResult<TOutput>> {
  const batchSize = options.batchSize ?? AI_BATCH_SIZE;
  const maxRetries = options.maxRetries ?? AI_MAX_RETRIES;
  const batches = Array.from({ length: Math.ceil(options.items.length / batchSize) }, (_, index) =>
    options.items.slice(index * batchSize, (index + 1) * batchSize));
  const outputs: TOutput[] = [];
  const failedIds: string[] = [];
  let processed = 0;

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const requestId = globalThis.crypto.randomUUID();
    let lastError: unknown;
    let batchOutput: TOutput[] | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        batchOutput = await options.processBatch(batch, { requestId, attempt });
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (batchOutput) {
      outputs.push(...batchOutput);
      processed += batch.length;
      const progress = { processed, failed: failedIds.length, currentBatch: index + 1, batchCount: batches.length };
      options.onBatchSuccess?.(batch, batchOutput, progress);
      options.onProgress?.(progress);
    } else {
      failedIds.push(...batch.map((item) => item.id));
      const progress = { processed, failed: failedIds.length, currentBatch: index + 1, batchCount: batches.length };
      options.onProgress?.(progress);
      console.error("AI batch failed after retries", { index, ids: batch.map((item) => item.id), error: lastError });
    }
  }

  return { outputs, failedIds };
}
