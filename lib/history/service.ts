import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as tables from '@/db/schema';
import { aiInfrastructureService } from '@/lib/ai/service';
import { ApiError } from '@/lib/api/envelope';
import { permissionService } from '@/lib/auth/permissions';
import { contentSchema } from '@/lib/content/contracts';
import {
  contentImportBatchSchema,
  contentImportCommitInputSchema,
  contentImportCommitResultSchema,
  contentImportPageDataSchema,
  contentImportPreviewInputSchema,
  contentImportPreviewItemSchema,
  contentImportPreviewSchema,
  contentImportRowInputSchema,
  dedupTestResultSchema,
  duplicateJudgeOutputSchema,
  embeddingVectorSchema,
  historyCandidateSchema,
  historyRetrievalItemSchema,
  type ContentImportPreviewItem,
  type DuplicateJudgeOutput,
  type EmbeddingVector,
  type HistoryCandidate,
} from './contracts';
import {
  deterministicFallbackEmbeddings,
  OpenAICompatibleEmbeddingClient,
  type EmbeddingResult,
} from './embedding-client';
import {
  canonicalContentText,
  contentSourceHash,
  roundedScore,
  textSimilarity,
  vectorSimilarity,
} from './similarity';

type Database = BetterSQLite3Database<typeof tables>;
type AiService = Pick<
  ReturnType<typeof aiInfrastructureService>,
  'executeTest'
>;
type PreviewPayload = { items: ContentImportPreviewItem[] };

const MAX_IMPORT_ROWS = 200;
const missing = () =>
  new ApiError(404, 'NOT_FOUND', '记录不存在或不属于当前组织');

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function parseCsv(payload: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < payload.length; index += 1) {
    const character = payload[index];
    if (quoted) {
      if (character === '"' && payload[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (quoted) throw new ApiError(400, 'CSV_INVALID', 'CSV 存在未闭合的引号');
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  if (rows.length < 2)
    throw new ApiError(400, 'CSV_EMPTY', 'CSV 必须包含表头和至少一行数据');
  const headers = rows[0].map((value, index) =>
    (index === 0 ? value.replace(/^\uFEFF/, '') : value).trim(),
  );
  if (new Set(headers).size !== headers.length)
    throw new ApiError(400, 'CSV_HEADERS_DUPLICATED', 'CSV 表头不能重复');
  return rows
    .slice(1)
    .filter((values) => values.some((value) => value.trim()))
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? '']),
      ),
    );
}

function parseImportPayload(format: 'csv' | 'json', payload: string) {
  let rows: unknown;
  if (format === 'csv') rows = parseCsv(payload);
  else {
    try {
      rows = JSON.parse(payload) as unknown;
    } catch {
      throw new ApiError(400, 'IMPORT_JSON_INVALID', '导入文件不是有效 JSON');
    }
  }
  if (!Array.isArray(rows))
    throw new ApiError(400, 'IMPORT_ROWS_REQUIRED', '导入内容必须是记录数组');
  if (rows.length === 0)
    throw new ApiError(400, 'IMPORT_EMPTY', '导入文件没有数据行');
  if (rows.length > MAX_IMPORT_ROWS)
    throw new ApiError(
      413,
      'IMPORT_TOO_MANY_ROWS',
      `单次最多预览 ${MAX_IMPORT_ROWS} 行`,
    );
  return rows;
}

function normalizeNullable(value: unknown) {
  return typeof value === 'string' && value.trim() === '' ? null : value;
}

function normalizeRawImportRow(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  const published = normalizeNullable(raw.published_at);
  let publishedAt = published;
  if (typeof published === 'string') {
    const date = new Date(published);
    if (!Number.isNaN(date.getTime())) publishedAt = date.toISOString();
  }
  return {
    account_id: normalizeNullable(raw.account_id),
    account_identifier: normalizeNullable(raw.account_identifier),
    external_id: normalizeNullable(raw.external_id),
    title: raw.title,
    content_type: normalizeNullable(raw.content_type),
    content_goal: normalizeNullable(raw.content_goal),
    topic: normalizeNullable(raw.topic),
    angle: normalizeNullable(raw.angle),
    hook_text: normalizeNullable(raw.hook_text),
    core_message: normalizeNullable(raw.core_message),
    published_at: publishedAt,
  };
}

function issueText(error: z.ZodError) {
  return error.issues.map(
    (issue) => `${issue.path.join('.') || '记录'}：${issue.message}`,
  );
}

function dedupKey(
  strategy: 'external_id' | 'title_published_at' | 'canonical',
  row: {
    externalId: string | null;
    title: string;
    topic: string;
    angle: string;
    hookText: string;
    coreMessage: string;
    publishedAt: string | null;
  },
) {
  if (strategy === 'external_id') {
    if (!row.externalId)
      throw new Error('使用 external_id 去重时，每行必须填写 external_id');
    return `external_id:${sha256(row.externalId.trim().toLocaleLowerCase())}`;
  }
  if (strategy === 'title_published_at') {
    if (!row.publishedAt)
      throw new Error(
        '使用 title_published_at 去重时，每行必须填写 published_at',
      );
    return `title_published_at:${sha256(`${row.title.trim().toLocaleLowerCase()}|${row.publishedAt}`)}`;
  }
  return `canonical:${contentSourceHash(row)}`;
}

function batchView(row: typeof tables.contentImportBatches.$inferSelect) {
  return contentImportBatchSchema.omit({ previewJson: true }).parse(row);
}

export function deterministicJudgment(
  items: Array<z.infer<typeof historyRetrievalItemSchema>>,
): DuplicateJudgeOutput {
  const top = items[0];
  const level = !top
    ? 'new'
    : top.ruleScore.combined >= 0.78
      ? 'high'
      : top.ruleScore.combined >= 0.58
        ? 'remixable'
        : top.ruleScore.combined >= 0.36
          ? 'mild'
          : 'new';
  const similarIds = items
    .filter((item) => item.ruleScore.combined >= 0.36)
    .map((item) => item.contentId);
  return duplicateJudgeOutputSchema.parse({
    duplicate_level: level,
    similar_content_ids: similarIds,
    reason: top
      ? `规则综合分最高为 ${Math.round(top.ruleScore.combined * 100)}%，已同时比较主题、角度、钩子、核心信息与语义相似度。`
      : '当前账号没有通过规则初筛的历史内容。',
    recommended_action:
      level === 'high'
        ? '更换切入角度和核心信息后再进入策划。'
        : level === 'remixable'
          ? '保留有效主题，但重写角度、钩子和核心表达。'
          : '可继续策划，并在脚本阶段保持表达差异。',
    alternative_angles:
      level === 'high' || level === 'remixable'
        ? ['改用顾客决策视角', '改用门店真实过程视角']
        : [],
  });
}

export function historyRetrievalService(
  db: Database,
  organizationId: string,
  userId: string,
  runtime: {
    now?: () => Date;
    embeddingClient?: OpenAICompatibleEmbeddingClient;
    aiService?: AiService;
  } = {},
) {
  const permissions = permissionService(db, organizationId, userId);
  const now = runtime.now ?? (() => new Date());
  const embeddingClient =
    runtime.embeddingClient ?? new OpenAICompatibleEmbeddingClient();
  const aiService =
    runtime.aiService ?? aiInfrastructureService(db, organizationId, userId);
  const timestamp = () => now().toISOString();
  const isDemo = permissions.organization.isDemo;

  const audit = (entityType: string, entityId: string, action: string) =>
    db
      .insert(tables.auditLogs)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        userId,
        entityType,
        entityId,
        action,
        metadataJson: JSON.stringify({ source: 'history_retrieval' }),
        isDemo,
        createdAt: timestamp(),
      })
      .run();

  const accountById = (id: string) => {
    const parsedId = z.uuid().parse(id);
    const account = db
      .select()
      .from(tables.accounts)
      .where(
        and(
          eq(tables.accounts.organizationId, organizationId),
          eq(tables.accounts.id, parsedId),
        ),
      )
      .get();
    if (!account) throw missing();
    permissions.requireClientRead(account.clientId);
    return account;
  };

  const accountByIdentifier = (identifier: string) => {
    const parsedId = z.uuid().safeParse(identifier);
    const rows = db
      .select()
      .from(tables.accounts)
      .where(
        and(
          eq(tables.accounts.organizationId, organizationId),
          parsedId.success
            ? eq(tables.accounts.id, parsedId.data)
            : eq(tables.accounts.accountName, identifier.trim()),
        ),
      )
      .limit(2)
      .all();
    if (rows.length === 0) throw new Error('账号不存在或不属于当前组织');
    if (rows.length > 1) throw new Error('账号名称不唯一，请改用 account_id');
    permissions.requireClientWrite(rows[0].clientId);
    return rows[0];
  };

  const readableAccounts = () => {
    const readableClientIds = permissions.readableClientIds();
    const predicates = [eq(tables.accounts.organizationId, organizationId)];
    if (readableClientIds)
      predicates.push(
        readableClientIds.length
          ? inArray(tables.accounts.clientId, readableClientIds)
          : sql`0 = 1`,
      );
    return db
      .select({
        id: tables.accounts.id,
        accountName: tables.accounts.accountName,
        clientId: tables.accounts.clientId,
        clientName: tables.clients.clientName,
      })
      .from(tables.accounts)
      .innerJoin(
        tables.clients,
        and(
          eq(tables.clients.organizationId, organizationId),
          eq(tables.clients.id, tables.accounts.clientId),
        ),
      )
      .where(and(...predicates))
      .orderBy(asc(tables.clients.clientName), asc(tables.accounts.accountName))
      .all()
      .map((row) => ({
        ...row,
        canWrite: permissions.canWriteClient(row.clientId),
      }));
  };

  const persistEmbedding = (
    content: typeof tables.contents.$inferSelect,
    vector: EmbeddingVector,
    model: string,
    sourceHash: string,
  ) => {
    const at = timestamp();
    return db.transaction(() => {
      db.update(tables.contentEmbeddings)
        .set({ status: 'stale', updatedAt: at })
        .where(
          and(
            eq(tables.contentEmbeddings.organizationId, organizationId),
            eq(tables.contentEmbeddings.accountId, content.accountId),
            eq(tables.contentEmbeddings.contentId, content.id),
            eq(tables.contentEmbeddings.status, 'active'),
          ),
        )
        .run();
      const row = {
        id: crypto.randomUUID(),
        organizationId,
        accountId: content.accountId,
        contentId: content.id,
        embeddingModel: model,
        sourceHash,
        vectorJson: embeddingVectorSchema.parse(vector),
        status: 'active' as const,
        isDemo: content.isDemo,
        createdAt: at,
        updatedAt: at,
      };
      db.insert(tables.contentEmbeddings).values(row).run();
      return row;
    });
  };

  const indexRows = async (
    rows: Array<typeof tables.contents.$inferSelect>,
  ) => {
    const uniqueRows = [...new Map(rows.map((row) => [row.id, row])).values()];
    const staleRows = uniqueRows.filter((row) => {
      const hash = contentSourceHash(row);
      const existing = db
        .select()
        .from(tables.contentEmbeddings)
        .where(
          and(
            eq(tables.contentEmbeddings.organizationId, organizationId),
            eq(tables.contentEmbeddings.contentId, row.id),
            eq(tables.contentEmbeddings.status, 'active'),
            eq(
              tables.contentEmbeddings.embeddingModel,
              embeddingClient.publicConfig.model,
            ),
            eq(tables.contentEmbeddings.sourceHash, hash),
          ),
        )
        .get();
      return !existing;
    });
    if (staleRows.length === 0)
      return {
        indexed: 0,
        failed: 0,
        mode: embeddingClient.publicConfig.mode,
        model: embeddingClient.publicConfig.model,
      };
    let result: EmbeddingResult;
    let failed = 0;
    try {
      result = await embeddingClient.embed(
        staleRows.map((row) => canonicalContentText(row)),
      );
    } catch {
      failed = staleRows.length;
      result = deterministicFallbackEmbeddings(
        staleRows.map((row) => canonicalContentText(row)),
      );
    }
    for (const [index, row] of staleRows.entries())
      persistEmbedding(
        row,
        result.vectors[index],
        result.model,
        contentSourceHash(row),
      );
    return {
      indexed: staleRows.length,
      failed,
      mode:
        result.method === 'embedding'
          ? ('live' as const)
          : ('fallback' as const),
      model: result.model,
    };
  };

  const resolveRetrievalVectors = async (
    candidate: HistoryCandidate,
    histories: Array<typeof tables.contents.$inferSelect>,
  ) => {
    const activeByContent = new Map(
      db
        .select()
        .from(tables.contentEmbeddings)
        .where(
          and(
            eq(tables.contentEmbeddings.organizationId, organizationId),
            eq(tables.contentEmbeddings.accountId, candidate.accountId),
            eq(tables.contentEmbeddings.status, 'active'),
          ),
        )
        .all()
        .map((row) => [row.contentId, row]),
    );
    const missing = histories.filter((row) => {
      const embedding = activeByContent.get(row.id);
      return !(
        embedding &&
        embedding.embeddingModel === embeddingClient.publicConfig.model &&
        embedding.sourceHash === contentSourceHash(row)
      );
    });
    const requestedTexts = [
      canonicalContentText(candidate),
      ...missing.map((row) => canonicalContentText(row)),
    ];
    try {
      const generated = await embeddingClient.embed(requestedTexts);
      for (const [index, row] of missing.entries()) {
        const saved = persistEmbedding(
          row,
          generated.vectors[index + 1],
          generated.model,
          contentSourceHash(row),
        );
        activeByContent.set(row.id, saved);
      }
      return {
        candidateVector: generated.vectors[0],
        method: generated.method,
        model: generated.model,
        vectors: new Map(
          histories.map((row) => {
            const embedding = activeByContent.get(row.id);
            if (!embedding) throw new Error('历史内容 Embedding 未成功生成');
            return [row.id, embeddingVectorSchema.parse(embedding.vectorJson)];
          }),
        ),
        fallbackReason: null as string | null,
      };
    } catch (error) {
      const fallback = deterministicFallbackEmbeddings([
        canonicalContentText(candidate),
        ...histories.map((row) => canonicalContentText(row)),
      ]);
      return {
        candidateVector: fallback.vectors[0],
        method: fallback.method,
        model: fallback.model,
        vectors: new Map(
          histories.map((row, index) => [row.id, fallback.vectors[index + 1]]),
        ),
        fallbackReason:
          error instanceof Error ? error.message : 'Embedding 调用失败',
      };
    }
  };

  const retrieve = async (candidate: HistoryCandidate, runId: string | null) => {
    const account = accountById(candidate.accountId);
    if (runId) {
      permissions.requireClientWrite(account.clientId);
      const run = db.select({ id: tables.runs.id }).from(tables.runs).where(and(
        eq(tables.runs.organizationId, organizationId),
        eq(tables.runs.id, runId),
        eq(tables.runs.runType, 'production'),
      )).get();
      if (!run) throw missing();
    }
    const histories = db.select().from(tables.contents).where(and(
      eq(tables.contents.organizationId, organizationId),
      eq(tables.contents.accountId, account.id),
      or(eq(tables.contents.status, 'PUBLISHED'), eq(tables.contents.status, 'REVIEWED')),
    )).orderBy(desc(tables.contents.publishedAt), desc(tables.contents.createdAt)).all();
    const resolved = await resolveRetrievalVectors(candidate, histories);
    const scored = histories.map((row) => {
      const semantic = roundedScore(vectorSimilarity(resolved.candidateVector, resolved.vectors.get(row.id)!));
      const topic = roundedScore(textSimilarity(candidate.topic, row.topic));
      const angle = roundedScore(textSimilarity(candidate.angle, row.angle));
      const hook = roundedScore(textSimilarity(candidate.hookText, row.hookText));
      const coreMessage = roundedScore(textSimilarity(candidate.coreMessage, row.coreMessage));
      const combined = roundedScore(semantic * 0.35 + topic * 0.1 + angle * 0.25 + hook * 0.15 + coreMessage * 0.15);
      return { row, semantic, ruleScore: { semantic, topic, angle, hook, coreMessage, combined } };
    }).sort((left, right) => right.semantic - left.semantic ||
      (right.row.publishedAt ?? '').localeCompare(left.row.publishedAt ?? '') || left.row.id.localeCompare(right.row.id)).slice(0, 10);
    const judgeCandidates = [...scored].filter((item) => item.ruleScore.combined >= 0.2 || item.semantic >= 0.35)
      .sort((left, right) => right.ruleScore.combined - left.ruleScore.combined || right.semantic - left.semantic).slice(0, 5);
    const judgeIds = new Set(judgeCandidates.map((item) => item.row.id));
    const top10 = scored.map((item, index) => historyRetrievalItemSchema.parse({
      contentId: item.row.id, title: item.row.title, contentType: item.row.contentType,
      contentGoal: item.row.contentGoal, topic: item.row.topic, angle: item.row.angle,
      hookText: item.row.hookText, coreMessage: item.row.coreMessage,
      publishedAt: item.row.publishedAt, similarity: item.semantic, retrievalMethod: resolved.method,
      sourceHash: contentSourceHash(item.row), rank: index + 1, ruleScore: item.ruleScore,
      sentToJudge: judgeIds.has(item.row.id),
    }));
    const retrievalId = crypto.randomUUID();
    const createdAt = timestamp();
    db.transaction(() => {
      db.insert(tables.historyRetrievals).values({
        id: retrievalId, organizationId, accountId: account.id, candidateJson: candidate,
        retrievalMethod: resolved.method, runId, createdBy: userId, isDemo, createdAt,
      }).run();
      if (top10.length) db.insert(tables.historyRetrievalItems).values(top10.map((item) => ({
        id: crypto.randomUUID(), organizationId, accountId: account.id, retrievalId,
        contentId: item.contentId, similarity: item.similarity, retrievalMethod: item.retrievalMethod,
        sourceHash: item.sourceHash, rank: item.rank, isDemo, createdAt,
      }))).run();
      audit('history_retrieval', retrievalId, 'history_retrieval.completed');
    });
    const judgeInput = judgeCandidates.map((item) => ({
      content_id: item.row.id, title: item.row.title, topic: item.row.topic, angle: item.row.angle,
      hook_text: item.row.hookText, core_message: item.row.coreMessage,
      semantic_similarity: item.semantic, rule_score: item.ruleScore.combined,
    }));
    return {
      retrievalId, account, candidate, top10, judgeInput,
      judgeInputContentIds: [...judgeIds],
      fallbackJudgment: deterministicJudgment(top10.filter((item) => item.sentToJudge)),
      fallbackReason: resolved.fallbackReason,
      embedding: {
        ...embeddingClient.publicConfig,
        mode: resolved.method === 'embedding' ? ('live' as const) : ('fallback' as const),
        model: resolved.model,
      },
    };
  };

  return {
    importPageData() {
      const accounts = readableAccounts();
      const writableAccountIds = new Set(
        accounts.filter((item) => item.canWrite).map((item) => item.id),
      );
      const batches = db
        .select()
        .from(tables.contentImportBatches)
        .where(eq(tables.contentImportBatches.organizationId, organizationId))
        .orderBy(desc(tables.contentImportBatches.createdAt))
        .limit(20)
        .all()
        .map(batchView);
      return contentImportPageDataSchema.parse({
        accounts,
        batches,
        permissions: {
          canImport: writableAccountIds.size > 0,
          canTest: permissions.has('ai.test'),
        },
      });
    },

    previewImport(input: unknown) {
      const value = contentImportPreviewInputSchema.parse(input);
      const rawRows = parseImportPayload(value.format, value.payload);
      const seen = new Set<string>();
      const items = rawRows.map((raw, index): ContentImportPreviewItem => {
        const parsed = contentImportRowInputSchema.safeParse(
          normalizeRawImportRow(raw),
        );
        if (!parsed.success)
          return contentImportPreviewItemSchema.parse({
            rowNumber: index + 1,
            status: 'invalid',
            accountId: null,
            accountName: null,
            externalId: null,
            title:
              raw &&
              typeof raw === 'object' &&
              'title' in raw &&
              typeof (raw as Record<string, unknown>).title === 'string'
                ? (raw as Record<string, string>).title
                : '',
            contentType: null,
            contentGoal: null,
            topic: '',
            angle: '',
            hookText: '',
            coreMessage: '',
            publishedAt: null,
            dedupKey: null,
            existingContentId: null,
            issues: issueText(parsed.error),
          });
        const row = parsed.data;
        const base = {
          rowNumber: index + 1,
          accountId: null as string | null,
          accountName: null as string | null,
          externalId: row.external_id ?? null,
          title: row.title,
          contentType: row.content_type ?? null,
          contentGoal: row.content_goal ?? null,
          topic: row.topic ?? '',
          angle: row.angle ?? '',
          hookText: row.hook_text ?? '',
          coreMessage: row.core_message ?? '',
          publishedAt: row.published_at ?? null,
          dedupKey: null as string | null,
          existingContentId: null as string | null,
          issues: [] as string[],
        };
        try {
          const account = accountByIdentifier(
            row.account_id ?? row.account_identifier ?? '',
          );
          base.accountId = account.id;
          base.accountName = account.accountName;
          base.dedupKey = dedupKey(value.dedupStrategy, base);
          const identity = `${account.id}:${base.dedupKey}`;
          const existing = db
            .select({ id: tables.contents.id })
            .from(tables.contents)
            .where(
              and(
                eq(tables.contents.organizationId, organizationId),
                eq(tables.contents.accountId, account.id),
                eq(tables.contents.importDedupKey, base.dedupKey),
              ),
            )
            .get();
          if (existing) {
            base.existingContentId = existing.id;
            return contentImportPreviewItemSchema.parse({
              ...base,
              status: 'duplicate',
              issues: ['数据库中已存在相同去重键，将跳过'],
            });
          }
          if (seen.has(identity))
            return contentImportPreviewItemSchema.parse({
              ...base,
              status: 'duplicate',
              issues: ['本次文件中去重键重复，将跳过'],
            });
          seen.add(identity);
          return contentImportPreviewItemSchema.parse({
            ...base,
            status: 'valid',
          });
        } catch (error) {
          if (error instanceof ApiError) throw error;
          return contentImportPreviewItemSchema.parse({
            ...base,
            status: 'invalid',
            issues: [error instanceof Error ? error.message : '记录校验失败'],
          });
        }
      });
      const counts = {
        totalRows: items.length,
        validRows: items.filter((item) => item.status === 'valid').length,
        duplicateRows: items.filter((item) => item.status === 'duplicate')
          .length,
        invalidRows: items.filter((item) => item.status === 'invalid').length,
      };
      const at = timestamp();
      const batch = contentImportBatchSchema.parse({
        id: crypto.randomUUID(),
        organizationId,
        format: value.format,
        dedupStrategy: value.dedupStrategy,
        sourceHash: sha256(
          `${value.format}|${value.dedupStrategy}|${value.payload}`,
        ),
        previewJson: { items } satisfies PreviewPayload,
        status: 'previewed',
        ...counts,
        committedRows: 0,
        createdBy: userId,
        isDemo,
        committedAt: null,
        createdAt: at,
        updatedAt: at,
      });
      return db.transaction(() => {
        db.insert(tables.contentImportBatches).values(batch).run();
        audit('content_import_batch', batch.id, 'content_import.previewed');
        return contentImportPreviewSchema.parse({
          batch: batchView(batch),
          items,
          canCommit: counts.invalidRows === 0 && counts.validRows > 0,
        });
      });
    },

    async commitImport(input: unknown) {
      const { batchId } = contentImportCommitInputSchema.parse(input);
      const batch = db
        .select()
        .from(tables.contentImportBatches)
        .where(
          and(
            eq(tables.contentImportBatches.organizationId, organizationId),
            eq(tables.contentImportBatches.id, batchId),
          ),
        )
        .get();
      if (!batch) throw missing();
      if (batch.status !== 'previewed')
        throw new ApiError(409, 'IMPORT_ALREADY_FINALIZED', '该预览批次已处理');
      if (batch.invalidRows > 0)
        throw new ApiError(
          409,
          'IMPORT_HAS_INVALID_ROWS',
          '请修正所有无效行后重新预览',
        );
      const preview = z
        .object({
          items: z.array(contentImportPreviewItemSchema).max(MAX_IMPORT_ROWS),
        })
        .parse(batch.previewJson) as PreviewPayload;
      const validItems = preview.items.filter(
        (item) => item.status === 'valid',
      );
      if (validItems.length === 0)
        throw new ApiError(
          409,
          'IMPORT_NOTHING_TO_COMMIT',
          '没有可写入的新记录',
        );
      const accountMap = new Map(
        validItems.map((item) => {
          if (!item.accountId) throw new Error('预览记录缺少账号');
          const account = accountById(item.accountId);
          permissions.requireClientWrite(account.clientId);
          return [account.id, account];
        }),
      );
      const inserted = db.transaction(() => {
        const contentIds: string[] = [];
        for (const item of validItems) {
          const account = accountMap.get(item.accountId!);
          if (!account || !item.dedupKey) throw new Error('预览记录无效');
          const existing = db
            .select({ id: tables.contents.id })
            .from(tables.contents)
            .where(
              and(
                eq(tables.contents.organizationId, organizationId),
                eq(tables.contents.accountId, account.id),
                eq(tables.contents.importDedupKey, item.dedupKey),
              ),
            )
            .get();
          if (existing) continue;
          const at = timestamp();
          const content = contentSchema.parse({
            id: crypto.randomUUID(),
            organizationId,
            clientId: account.clientId,
            brandId: account.brandId,
            storeId: account.storeId,
            accountId: account.id,
            monthlyPlanId: null,
            title: item.title,
            contentType: item.contentType ?? 'other',
            contentGoal: item.contentGoal ?? 'exposure',
            topic: item.topic,
            angle: item.angle,
            hookType: 'other',
            hookText: item.hookText,
            coreMessage: item.coreMessage,
            productText: '',
            ctaType: '',
            localElement: '',
            peopleJson: [],
            status: 'PUBLISHED',
            priority: 'normal',
            operatorId: userId,
            plannedPublishDate: item.publishedAt,
            publishedAt: item.publishedAt,
            deadline: null,
            externalId: item.externalId,
            importDedupKey: item.dedupKey,
            importBatchId: batch.id,
            currentScriptVersionId: null,
            activeApprovedScriptVersionId: null,
            currentEditVersionId: null,
            activeApprovedEditVersionId: null,
            aiReviewStatus: null,
            createdBy: userId,
            isDemo,
            createdAt: at,
            updatedAt: at,
          });
          db.insert(tables.contents).values(content).run();
          audit('content', content.id, 'content.imported');
          contentIds.push(content.id);
        }
        const committedAt = timestamp();
        const update = db
          .update(tables.contentImportBatches)
          .set({
            status: 'committed',
            committedRows: contentIds.length,
            committedAt,
            updatedAt: committedAt,
          })
          .where(
            and(
              eq(tables.contentImportBatches.organizationId, organizationId),
              eq(tables.contentImportBatches.id, batch.id),
              eq(tables.contentImportBatches.status, 'previewed'),
            ),
          )
          .run();
        if (update.changes !== 1)
          throw new ApiError(
            409,
            'IMPORT_ALREADY_FINALIZED',
            '该预览批次已处理',
          );
        audit('content_import_batch', batch.id, 'content_import.committed');
        return { contentIds, committedAt };
      });
      const insertedRows = inserted.contentIds.length
        ? db
            .select()
            .from(tables.contents)
            .where(
              and(
                eq(tables.contents.organizationId, organizationId),
                inArray(tables.contents.id, inserted.contentIds),
              ),
            )
            .all()
        : [];
      const embedding = await indexRows(insertedRows);
      return contentImportCommitResultSchema.parse({
        batch: batchView({
          ...batch,
          status: 'committed',
          committedRows: inserted.contentIds.length,
          committedAt: inserted.committedAt,
          updatedAt: inserted.committedAt,
        }),
        contentIds: inserted.contentIds,
        embedding,
      });
    },

    async syncContentEmbedding(contentId: string) {
      const content = db
        .select()
        .from(tables.contents)
        .where(
          and(
            eq(tables.contents.organizationId, organizationId),
            eq(tables.contents.id, z.uuid().parse(contentId)),
          ),
        )
        .get();
      if (!content) throw missing();
      permissions.requireClientWrite(content.clientId);
      return indexRows([content]);
    },

    async dedupTest(input: unknown) {
      permissions.require('ai.test');
      const candidate = historyCandidateSchema.parse(input);
      const retrieval = await retrieve(candidate, null);
      const { account, top10, retrievalId, fallbackJudgment } = retrieval;
      let judgment = fallbackJudgment;
      let fallbackUsed = retrieval.judgeInput.length === 0;
      let fallbackReason =
        retrieval.fallbackReason ??
        (retrieval.judgeInput.length === 0 ? '没有历史内容通过规则初筛' : null);
      let run: z.infer<typeof dedupTestResultSchema>['run'] = null;
      if (retrieval.judgeInput.length) {
        const allowedIds = new Set(retrieval.judgeInputContentIds);
        const testResult = await aiService.executeTest({
          skillCode: 'duplicate_judge',
          subjectId: retrievalId,
          clientId: account.clientId,
          accountId: account.id,
          data: {
            candidate: {
              title: candidate.title,
              content_type: candidate.contentType ?? '',
              content_goal: candidate.contentGoal ?? '',
              topic: candidate.topic,
              angle: candidate.angle,
              hook_text: candidate.hookText,
              core_message: candidate.coreMessage,
            },
            similar_contents: retrieval.judgeInput,
          },
          mockOutput: fallbackJudgment,
          validateOutput(output) {
            const parsed = duplicateJudgeOutputSchema.parse(output);
            if (parsed.similar_content_ids.some((id) => !allowedIds.has(id)))
              throw new Error(
                'duplicate_judge 引用了本次 Top5 之外的 content_id',
              );
          },
        });
        db.update(tables.historyRetrievals)
          .set({ runId: testResult.run.id })
          .where(
            and(
              eq(tables.historyRetrievals.organizationId, organizationId),
              eq(tables.historyRetrievals.id, retrievalId),
            ),
          )
          .run();
        if (testResult.schemaResult.valid)
          judgment = duplicateJudgeOutputSchema.parse(testResult.parsedJson);
        else {
          fallbackUsed = true;
          fallbackReason = testResult.schemaResult.issues.join('；');
        }
        if (testResult.mode === 'mock') {
          fallbackUsed = true;
          fallbackReason = '未配置 LLM Key，使用确定性 Mock 判定';
        }
        run = {
          id: testResult.run.id,
          status: testResult.run.status,
          billedPoints: testResult.usage.billedPoints,
          mode: testResult.mode,
          schemaValid: testResult.schemaResult.valid,
        };
      }
      return dedupTestResultSchema.parse({
        marker: 'TEST_RUN',
        retrievalId,
        candidate,
        top10,
        judgeInputContentIds: retrieval.judgeInputContentIds,
        judgment,
        fallbackUsed,
        fallbackReason,
        embedding: retrieval.embedding,
        run,
      });
    },

    async retrieveForRun(input: unknown, runId: string) {
      const candidate = historyCandidateSchema.parse(input);
      return retrieve(candidate, z.uuid().parse(runId));
    },
  };
}
