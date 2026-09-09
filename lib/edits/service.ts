import { and, asc, count, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as tables from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { permissionService, type EditAccessScope } from '@/lib/auth/permissions';
import { assertContentTransition } from '@/lib/content/workflow';
import { approvalDecisionInputSchema } from '@/lib/scripts/contracts';
import { createReviewToken, reviewTokenHash, reviewTokenSchema } from '@/lib/reviews/token';
import {
  assignEditorInputSchema,
  editApprovalViewSchema,
  editTaskListSchema,
  editTaskQuerySchema,
  editVersionSchema,
  editWorkspaceSchema,
  publicEditReviewSchema,
  resubmitEditApprovalSchema,
  startEditingInputSchema,
  submitEditVersionResultSchema,
  submitEditVersionSchema,
} from './contracts';

type Database = BetterSQLite3Database<typeof tables>;
type ContentRow = typeof tables.contents.$inferSelect;
type ReviewerInput = {
  reviewerType: 'internal_user' | 'external_client';
  reviewerUserId?: string | null;
  expiresAt?: string | null;
};
const missing = () => new ApiError(404, 'NOT_FOUND', '记录不存在或不属于当前组织');
const json = (value: unknown) => JSON.stringify(value);
const EDIT_STATUSES = ['SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH'] as const;

function requireDecisionComment(input: { status: 'approved' | 'changes_requested' | 'rejected'; comment: string }) {
  if (input.status !== 'approved' && !input.comment)
    throw new ApiError(400, 'REVIEW_COMMENT_REQUIRED', '要求修改或拒绝时必须填写审核意见');
}

export function editReviewService(
  db: Database,
  organizationId: string,
  userId: string,
  runtime: { now?: () => Date; createToken?: () => string } = {},
) {
  const permissions = permissionService(db, organizationId, userId);
  const now = runtime.now ?? (() => new Date());
  const timestamp = () => now().toISOString();
  const createToken = runtime.createToken ?? createReviewToken;

  function rawContent(id: string) {
    const row = db.select().from(tables.contents).where(and(
      eq(tables.contents.organizationId, organizationId),
      eq(tables.contents.id, z.uuid().parse(id)),
    )).get();
    if (!row) throw missing();
    return row;
  }

  function content(id: string) {
    const row = rawContent(id);
    permissions.requireEditRead(row.clientId, row.editorId);
    return row;
  }

  function editor(id: string) {
    const row = db.select().from(tables.users).where(and(
      eq(tables.users.organizationId, organizationId),
      eq(tables.users.id, z.uuid().parse(id)),
      eq(tables.users.status, 'active'),
    )).get();
    if (!row) throw missing();
    if (row.role !== 'editor') throw new ApiError(409, 'EDITOR_NOT_ALLOWED', '所选成员不是有效的 Editor');
    return row;
  }

  function version(contentId: string, versionId: string) {
    const row = db.select().from(tables.editVersions).where(and(
      eq(tables.editVersions.organizationId, organizationId),
      eq(tables.editVersions.contentId, contentId),
      eq(tables.editVersions.id, z.uuid().parse(versionId)),
    )).get();
    if (!row) throw missing();
    return row;
  }

  function editorOptions() {
    return db.select({ id: tables.users.id, name: tables.users.name }).from(tables.users).where(and(
      eq(tables.users.organizationId, organizationId),
      eq(tables.users.role, 'editor'),
      eq(tables.users.status, 'active'),
    )).orderBy(asc(tables.users.name), asc(tables.users.id)).all();
  }

  function reviewerOptions(clientId: string) {
    return db.select({ id: tables.users.id, name: tables.users.name, role: tables.users.role }).from(tables.users).where(and(
      eq(tables.users.organizationId, organizationId), eq(tables.users.status, 'active'),
    )).orderBy(asc(tables.users.name), asc(tables.users.id)).all().flatMap((member) => {
      if (!['owner', 'admin', 'operator'].includes(member.role) || !permissions.canUserWriteClient(member.id, clientId)) return [];
      return [{ id: member.id, name: member.name, clientIds: [clientId] }];
    });
  }

  function expireExternalApprovals(contentId: string) {
    const at = timestamp();
    db.update(tables.approvals).set({ status: 'expired', updatedAt: at }).where(and(
      eq(tables.approvals.organizationId, organizationId),
      eq(tables.approvals.contentId, contentId),
      eq(tables.approvals.approvalType, 'final_video'),
      eq(tables.approvals.status, 'pending'),
      eq(tables.approvals.reviewerType, 'external_client'),
      lte(tables.approvals.expiresAt, at),
    )).run();
  }

  function canDecide(approval: typeof tables.approvals.$inferSelect, clientId: string) {
    if (approval.reviewerType !== 'internal_user' || !permissions.canReviewEdit(clientId)) return false;
    return permissions.actor.role === 'owner' || permissions.actor.role === 'admin' || approval.reviewerUserId === userId;
  }

  function workspace(id: string) {
    const row = content(id);
    expireExternalApprovals(row.id);
    const names = db.select({
      clientName: tables.clients.clientName,
      brandName: tables.brands.brandName,
      accountName: tables.accounts.accountName,
    }).from(tables.accounts)
      .innerJoin(tables.clients, and(eq(tables.clients.organizationId, organizationId), eq(tables.clients.id, tables.accounts.clientId)))
      .innerJoin(tables.brands, and(eq(tables.brands.organizationId, organizationId), eq(tables.brands.id, tables.accounts.brandId)))
      .where(and(
        eq(tables.accounts.organizationId, organizationId), eq(tables.accounts.id, row.accountId),
        eq(tables.accounts.clientId, row.clientId), eq(tables.accounts.brandId, row.brandId),
      )).get();
    if (!names) throw missing();
    const assignedEditor = row.editorId ? db.select({ name: tables.users.name }).from(tables.users).where(and(
      eq(tables.users.organizationId, organizationId), eq(tables.users.id, row.editorId),
    )).get() : null;
    if (row.editorId && !assignedEditor) throw missing();
    const versions = db.select().from(tables.editVersions).where(and(
      eq(tables.editVersions.organizationId, organizationId), eq(tables.editVersions.contentId, row.id),
    )).orderBy(desc(tables.editVersions.versionNo)).all().map((item) => {
      const creator = db.select({ name: tables.users.name }).from(tables.users).where(and(
        eq(tables.users.organizationId, organizationId), eq(tables.users.id, item.createdBy),
      )).get();
      if (!creator) throw missing();
      return editVersionSchema.parse({
        ...item,
        creatorName: creator.name,
        isCurrent: row.currentEditVersionId === item.id,
        isActiveApproved: row.activeApprovedEditVersionId === item.id,
      });
    });
    const versionNumbers = new Map(versions.map((item) => [item.id, item.versionNo]));
    const approvals = db.select().from(tables.approvals).where(and(
      eq(tables.approvals.organizationId, organizationId),
      eq(tables.approvals.contentId, row.id),
      eq(tables.approvals.approvalType, 'final_video'),
    )).orderBy(desc(tables.approvals.createdAt), desc(tables.approvals.id)).all().map((approval) => {
      const reviewer = approval.reviewerUserId ? db.select({ name: tables.users.name }).from(tables.users).where(and(
        eq(tables.users.organizationId, organizationId), eq(tables.users.id, approval.reviewerUserId),
      )).get() : null;
      return editApprovalViewSchema.parse({
        ...approval,
        versionNo: versionNumbers.get(approval.versionId) ?? 0,
        reviewerName: reviewer?.name ?? null,
        canDecide: canDecide(approval, row.clientId),
      });
    });
    const mayAssign = permissions.canAssignEdit(row.clientId);
    const mayWork = permissions.canWorkOnEdit(row.clientId, row.editorId);
    return editWorkspaceSchema.parse({
      content: {
        id: row.id,
        title: row.title,
        status: row.status,
        clientId: row.clientId,
        ...names,
        editorId: row.editorId,
        editorName: assignedEditor?.name ?? null,
        currentEditVersionId: row.currentEditVersionId,
        activeApprovedEditVersionId: row.activeApprovedEditVersionId,
      },
      versions,
      approvals,
      options: {
        editors: mayAssign ? editorOptions() : [],
        reviewers: mayWork || permissions.canReviewEdit(row.clientId) ? reviewerOptions(row.clientId) : [],
      },
      permissions: {
        canAssign: mayAssign && row.status === 'SHOT',
        canStart: row.status === 'SHOT' && !!row.editorId && mayWork,
        canSubmit: ['EDITING', 'REVISION', 'READY_TO_PUBLISH'].includes(row.status) && !!row.editorId && mayWork,
        canResubmit: row.status === 'WAITING_REVIEW' && !!row.currentEditVersionId
          && (mayWork || permissions.canReviewEdit(row.clientId)),
        canReview: row.status === 'WAITING_REVIEW' && permissions.canReviewEdit(row.clientId),
      },
    });
  }

  function prepareReviewer(clientId: string, input: ReviewerInput) {
    let reviewerUserId: string | null = null;
    let rawToken: string | null = null;
    let hash: string | null = null;
    let expiresAt: string | null = null;
    if (input.reviewerType === 'internal_user') {
      reviewerUserId = input.reviewerUserId ?? null;
      const reviewer = reviewerUserId ? db.select().from(tables.users).where(and(
        eq(tables.users.organizationId, organizationId),
        eq(tables.users.id, reviewerUserId),
        eq(tables.users.status, 'active'),
      )).get() : null;
      if (!reviewer) throw missing();
      if (!['owner', 'admin', 'operator'].includes(reviewer.role) || !permissions.canUserWriteClient(reviewer.id, clientId))
        throw new ApiError(409, 'REVIEWER_NOT_ALLOWED', '内部成片审核人必须有权管理该客户');
    } else {
      rawToken = reviewTokenSchema.parse(createToken());
      hash = reviewTokenHash(rawToken);
      expiresAt = input.expiresAt ?? new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const expiresMs = Date.parse(expiresAt);
      if (expiresMs <= now().getTime() || expiresMs > now().getTime() + 30 * 24 * 60 * 60 * 1000)
        throw new ApiError(400, 'REVIEW_EXPIRY_INVALID', '外部审核有效期必须在当前时间之后且不超过 30 天');
    }
    return { reviewerUserId, rawToken, hash, expiresAt };
  }

  function insertApproval(row: ContentRow, versionId: string, reviewer: ReturnType<typeof prepareReviewer>, at: string) {
    db.update(tables.approvals).set({ status: 'expired', updatedAt: at }).where(and(
      eq(tables.approvals.organizationId, organizationId),
      eq(tables.approvals.contentId, row.id),
      eq(tables.approvals.approvalType, 'final_video'),
      eq(tables.approvals.status, 'pending'),
    )).run();
    const approvalId = crypto.randomUUID();
    db.insert(tables.approvals).values({
      id: approvalId,
      organizationId,
      contentId: row.id,
      approvalType: 'final_video',
      versionId,
      status: 'pending',
      reviewerType: reviewer.reviewerUserId ? 'internal_user' : 'external_client',
      reviewerUserId: reviewer.reviewerUserId,
      reviewTokenHash: reviewer.hash,
      expiresAt: reviewer.expiresAt,
      comment: '',
      isDemo: row.isDemo,
      createdAt: at,
      updatedAt: at,
    }).run();
    return approvalId;
  }

  function writeLog(row: ContentRow, nextStatus: ContentRow['status'], triggerId: string, reason: string, at: string, triggerType: 'edit' | 'approval') {
    db.insert(tables.contentStatusLogs).values({
      id: crypto.randomUUID(), organizationId, contentId: row.id,
      previousStatus: row.status, newStatus: nextStatus, triggerType, triggerId,
      operatorId: userId, reason, isDemo: row.isDemo, createdAt: at,
    }).run();
  }

  function audit(action: string, entityType: string, entityId: string, metadata: Record<string, unknown>, isDemo: boolean, at: string) {
    db.insert(tables.auditLogs).values({
      id: crypto.randomUUID(), organizationId, userId, action, entityType, entityId,
      metadataJson: json(metadata), isDemo, createdAt: at,
    }).run();
  }

  return {
    list(input: unknown) {
      const query = editTaskQuerySchema.parse(input);
      const scope: EditAccessScope = permissions.editAccessScope();
      const predicates = [
        eq(tables.contents.organizationId, organizationId),
        inArray(tables.contents.status, [...EDIT_STATUSES]),
      ];
      if (scope.kind === 'clients') predicates.push(scope.clientIds.length ? inArray(tables.contents.clientId, scope.clientIds) : sql`0 = 1`);
      if (scope.kind === 'editor') predicates.push(eq(tables.contents.editorId, scope.editorId));
      if (query.status) predicates.push(eq(tables.contents.status, query.status));
      const rows = db.select().from(tables.contents).where(and(...predicates))
        .orderBy(desc(tables.contents.updatedAt), asc(tables.contents.id))
        .limit(query.pageSize).offset((query.page - 1) * query.pageSize).all();
      return editTaskListSchema.parse({
        items: rows.map((row) => {
          const detail = workspace(row.id).content;
          const currentVersion = row.currentEditVersionId ? version(row.id, row.currentEditVersionId) : null;
          const activeVersion = row.activeApprovedEditVersionId ? version(row.id, row.activeApprovedEditVersionId) : null;
          return {
            ...detail,
            currentVersionNo: currentVersion?.versionNo ?? null,
            activeApprovedVersionNo: activeVersion?.versionNo ?? null,
            updatedAt: row.updatedAt,
            isDemo: row.isDemo,
          };
        }),
        total: db.select({ value: count() }).from(tables.contents).where(and(...predicates)).get()?.value ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      });
    },

    workspace,

    assign(id: string, input: unknown) {
      const { editorId } = assignEditorInputSchema.parse(input);
      const row = rawContent(id);
      permissions.requireEditAssignment(row.clientId);
      if (row.status !== 'SHOT') throw new ApiError(409, 'EDIT_ASSIGNMENT_NOT_ALLOWED', '只能为已拍摄且尚未开始剪辑的内容分配 Editor');
      editor(editorId);
      const at = timestamp();
      db.transaction(() => {
        const changed = db.update(tables.contents).set({ editorId, updatedAt: at }).where(and(
          eq(tables.contents.organizationId, organizationId), eq(tables.contents.id, row.id),
          eq(tables.contents.status, 'SHOT'), eq(tables.contents.updatedAt, row.updatedAt),
        )).run();
        if (changed.changes !== 1) throw new ApiError(409, 'STALE_CONTENT_STATUS', '内容状态已变化，请刷新后重试');
        audit('edit.assigned', 'content', row.id, { editorId }, row.isDemo, at);
      });
      return workspace(row.id);
    },

    start(id: string, input: unknown) {
      const { reason } = startEditingInputSchema.parse(input);
      const row = content(id);
      permissions.requireEditWork(row.clientId, row.editorId);
      if (!row.editorId) throw new ApiError(409, 'EDITOR_REQUIRED', '请先分配剪辑人员');
      assertContentTransition(row.status, 'EDITING', 'edit');
      const at = timestamp();
      db.transaction(() => {
        const changed = db.update(tables.contents).set({ status: 'EDITING', updatedAt: at }).where(and(
          eq(tables.contents.organizationId, organizationId), eq(tables.contents.id, row.id),
          eq(tables.contents.status, 'SHOT'), eq(tables.contents.updatedAt, row.updatedAt),
        )).run();
        if (changed.changes !== 1) throw new ApiError(409, 'STALE_CONTENT_STATUS', '内容状态已变化，请刷新后重试');
        writeLog(row, 'EDITING', row.id, reason, at, 'edit');
        audit('edit.started', 'content', row.id, { editorId: row.editorId }, row.isDemo, at);
      });
      return workspace(row.id);
    },

    submitVersion(id: string, input: unknown) {
      const value = submitEditVersionSchema.parse(input);
      const row = content(id);
      permissions.requireEditWork(row.clientId, row.editorId);
      if (!row.editorId) throw new ApiError(409, 'EDITOR_REQUIRED', '请先分配剪辑人员');
      if (!['EDITING', 'REVISION', 'READY_TO_PUBLISH'].includes(row.status))
        throw new ApiError(409, 'EDIT_VERSION_NOT_ALLOWED', '当前内容状态不允许提交新成片版本');
      assertContentTransition(row.status, 'WAITING_REVIEW', 'edit');
      const reviewer = prepareReviewer(row.clientId, value);
      const at = timestamp();
      const versionId = crypto.randomUUID();
      db.transaction(() => {
        const current = rawContent(row.id);
        if (current.status !== row.status || current.editorId !== row.editorId || current.currentEditVersionId !== row.currentEditVersionId)
          throw new ApiError(409, 'STALE_EDIT_VERSION', '剪辑版本或内容状态已变化，请刷新后重试');
        const versionNo = (db.select({ value: sql<number>`coalesce(max(${tables.editVersions.versionNo}), 0)` })
          .from(tables.editVersions).where(and(
            eq(tables.editVersions.organizationId, organizationId), eq(tables.editVersions.contentId, row.id),
          )).get()?.value ?? 0) + 1;
        db.insert(tables.editVersions).values({
          id: versionId, organizationId, contentId: row.id, versionNo,
          assetUrl: value.assetUrl, assetType: value.assetType, note: value.note,
          createdBy: userId, isDemo: row.isDemo, createdAt: at,
        }).run();
        const approvalId = insertApproval(row, versionId, reviewer, at);
        const changed = db.update(tables.contents).set({
          status: 'WAITING_REVIEW', currentEditVersionId: versionId,
          activeApprovedEditVersionId: null, updatedAt: at,
        }).where(and(
          eq(tables.contents.organizationId, organizationId), eq(tables.contents.id, row.id),
          eq(tables.contents.status, row.status), eq(tables.contents.updatedAt, row.updatedAt),
        )).run();
        if (changed.changes !== 1) throw new ApiError(409, 'STALE_CONTENT_STATUS', '内容状态已变化，请刷新后重试');
        writeLog(row, 'WAITING_REVIEW', versionId, `提交成片 V${versionNo} 审核`, at, 'edit');
        audit('edit.version_submitted', 'edit_version', versionId, {
          contentId: row.id, versionNo, approvalId, reviewerType: value.reviewerType,
        }, row.isDemo, at);
      });
      return submitEditVersionResultSchema.parse({
        workspace: workspace(row.id),
        reviewPath: reviewer.rawToken ? `/review/${reviewer.rawToken}` : null,
      });
    },

    resubmitApproval(id: string, input: unknown) {
      const value = resubmitEditApprovalSchema.parse(input);
      const row = content(id);
      if (!permissions.canWorkOnEdit(row.clientId, row.editorId) && !permissions.canReviewEdit(row.clientId))
        throw new ApiError(403, 'PERMISSION_DENIED', '当前身份无权重新提交成片审核');
      if (row.status !== 'WAITING_REVIEW' || row.currentEditVersionId !== value.versionId)
        throw new ApiError(409, 'EDIT_REVIEW_RESUBMIT_NOT_ALLOWED', '只能重新提交当前待审核成片版本');
      version(row.id, value.versionId);
      const reviewer = prepareReviewer(row.clientId, value);
      const at = timestamp();
      db.transaction(() => {
        const current = rawContent(row.id);
        if (current.status !== 'WAITING_REVIEW' || current.currentEditVersionId !== value.versionId)
          throw new ApiError(409, 'STALE_EDIT_VERSION', '剪辑版本或内容状态已变化，请刷新后重试');
        insertApproval(row, value.versionId, reviewer, at);
        audit('edit.approval_resubmitted', 'edit_version', value.versionId, {
          contentId: row.id, reviewerType: value.reviewerType,
        }, row.isDemo, at);
      });
      return submitEditVersionResultSchema.parse({
        workspace: workspace(row.id),
        reviewPath: reviewer.rawToken ? `/review/${reviewer.rawToken}` : null,
      });
    },

    decide(approvalId: string, input: unknown) {
      const value = approvalDecisionInputSchema.parse(input);
      requireDecisionComment(value);
      const approval = db.select().from(tables.approvals).where(and(
        eq(tables.approvals.organizationId, organizationId),
        eq(tables.approvals.id, z.uuid().parse(approvalId)),
        eq(tables.approvals.approvalType, 'final_video'),
      )).get();
      if (!approval) throw missing();
      const row = rawContent(approval.contentId);
      permissions.requireEditReview(row.clientId);
      if (approval.reviewerType !== 'internal_user')
        throw new ApiError(403, 'REVIEW_CHANNEL_MISMATCH', '外部客户审核只能通过专属 Token 链接提交');
      if (!canDecide(approval, row.clientId))
        throw new ApiError(403, 'PERMISSION_DENIED', '当前成员不是该审核的指定审核人');
      if (approval.status !== 'pending') throw new ApiError(409, 'APPROVAL_FINALIZED', '该审核已经处理，不能重复提交');
      const edit = version(row.id, approval.versionId);
      if (row.status !== 'WAITING_REVIEW' || row.currentEditVersionId !== edit.id)
        throw new ApiError(409, 'EDIT_VERSION_NOT_CURRENT', '审核版本已不是当前待审核成片');
      const nextStatus = value.status === 'approved' ? 'READY_TO_PUBLISH' as const : 'REVISION' as const;
      assertContentTransition(row.status, nextStatus, 'approval');
      const at = timestamp();
      db.transaction(() => {
        const approvalChanged = db.update(tables.approvals).set({
          status: value.status, comment: value.comment, updatedAt: at,
        }).where(and(
          eq(tables.approvals.organizationId, organizationId), eq(tables.approvals.id, approval.id),
          eq(tables.approvals.status, 'pending'),
        )).run();
        if (approvalChanged.changes !== 1) throw new ApiError(409, 'APPROVAL_FINALIZED', '该审核已经处理，不能重复提交');
        const changed = db.update(tables.contents).set({
          status: nextStatus,
          activeApprovedEditVersionId: value.status === 'approved' ? edit.id : null,
          updatedAt: at,
        }).where(and(
          eq(tables.contents.organizationId, organizationId), eq(tables.contents.id, row.id),
          eq(tables.contents.status, 'WAITING_REVIEW'), eq(tables.contents.currentEditVersionId, edit.id),
        )).run();
        if (changed.changes !== 1) throw new ApiError(409, 'STALE_CONTENT_STATUS', '内容状态已变化，请刷新后重试');
        db.update(tables.approvals).set({ status: 'expired', updatedAt: at }).where(and(
          eq(tables.approvals.organizationId, organizationId), eq(tables.approvals.contentId, row.id),
          eq(tables.approvals.approvalType, 'final_video'), eq(tables.approvals.status, 'pending'),
        )).run();
        writeLog(row, nextStatus, approval.id, value.comment || '成片审核通过', at, 'approval');
        audit(`edit_approval.${value.status}`, 'approval', approval.id, {
          contentId: row.id, versionId: edit.id,
        }, row.isDemo, at);
      });
      return workspace(row.id);
    },
  };
}

export function publicEditReviewService(
  db: Database,
  runtime: { now?: () => Date } = {},
) {
  const now = runtime.now ?? (() => new Date());

  function approvalForToken(token: string) {
    const approval = db.select().from(tables.approvals).where(and(
      eq(tables.approvals.reviewTokenHash, reviewTokenHash(token)),
      eq(tables.approvals.reviewerType, 'external_client'),
      eq(tables.approvals.approvalType, 'final_video'),
    )).get();
    if (!approval || !approval.expiresAt) throw new ApiError(404, 'REVIEW_LINK_NOT_FOUND', '审核链接不存在或已失效');
    const at = now().toISOString();
    if (approval.status === 'pending' && approval.expiresAt <= at) {
      db.update(tables.approvals).set({ status: 'expired', updatedAt: at }).where(and(
        eq(tables.approvals.organizationId, approval.organizationId), eq(tables.approvals.id, approval.id),
        eq(tables.approvals.status, 'pending'),
      )).run();
      throw new ApiError(410, 'REVIEW_LINK_EXPIRED', '审核链接已过期');
    }
    if (approval.status === 'expired') throw new ApiError(410, 'REVIEW_LINK_EXPIRED', '审核链接已过期');
    return approval;
  }

  function view(token: string) {
    const approval = approvalForToken(token);
    const content = db.select().from(tables.contents).where(and(
      eq(tables.contents.organizationId, approval.organizationId), eq(tables.contents.id, approval.contentId),
    )).get();
    const edit = db.select().from(tables.editVersions).where(and(
      eq(tables.editVersions.organizationId, approval.organizationId),
      eq(tables.editVersions.contentId, approval.contentId),
      eq(tables.editVersions.id, approval.versionId),
    )).get();
    if (!content || !edit) throw new ApiError(404, 'REVIEW_LINK_NOT_FOUND', '审核链接不存在或已失效');
    const brand = db.select().from(tables.brands).where(and(
      eq(tables.brands.organizationId, approval.organizationId), eq(tables.brands.id, content.brandId),
    )).get();
    if (!brand) throw new ApiError(404, 'REVIEW_LINK_NOT_FOUND', '审核链接不存在或已失效');
    return publicEditReviewSchema.parse({
      brand: { name: brand.brandName, city: brand.city },
      content: { title: content.title },
      edit: { versionNo: edit.versionNo, assetUrl: edit.assetUrl, assetType: edit.assetType, note: edit.note },
      approval: {
        status: approval.status, expiresAt: approval.expiresAt,
        comment: approval.comment, updatedAt: approval.updatedAt,
      },
    });
  }

  return {
    view,
    decide(token: string, input: unknown) {
      const value = approvalDecisionInputSchema.parse(input);
      requireDecisionComment(value);
      const approval = approvalForToken(token);
      if (approval.status !== 'pending') throw new ApiError(409, 'APPROVAL_FINALIZED', '该审核已经处理，不能重复提交');
      const content = db.select().from(tables.contents).where(and(
        eq(tables.contents.organizationId, approval.organizationId), eq(tables.contents.id, approval.contentId),
      )).get();
      const edit = db.select().from(tables.editVersions).where(and(
        eq(tables.editVersions.organizationId, approval.organizationId),
        eq(tables.editVersions.contentId, approval.contentId), eq(tables.editVersions.id, approval.versionId),
      )).get();
      if (!content || !edit) throw new ApiError(404, 'REVIEW_LINK_NOT_FOUND', '审核链接不存在或已失效');
      if (content.status !== 'WAITING_REVIEW' || content.currentEditVersionId !== edit.id)
        throw new ApiError(409, 'EDIT_VERSION_NOT_CURRENT', '审核版本已不是当前待审核成片');
      const nextStatus = value.status === 'approved' ? 'READY_TO_PUBLISH' as const : 'REVISION' as const;
      assertContentTransition(content.status, nextStatus, 'approval');
      const at = now().toISOString();
      db.transaction(() => {
        const approvalChanged = db.update(tables.approvals).set({
          status: value.status, comment: value.comment, updatedAt: at,
        }).where(and(
          eq(tables.approvals.organizationId, approval.organizationId),
          eq(tables.approvals.id, approval.id), eq(tables.approvals.status, 'pending'),
        )).run();
        if (approvalChanged.changes !== 1) throw new ApiError(409, 'APPROVAL_FINALIZED', '该审核已经处理，不能重复提交');
        const contentChanged = db.update(tables.contents).set({
          status: nextStatus,
          activeApprovedEditVersionId: value.status === 'approved' ? edit.id : null,
          updatedAt: at,
        }).where(and(
          eq(tables.contents.organizationId, approval.organizationId), eq(tables.contents.id, content.id),
          eq(tables.contents.status, 'WAITING_REVIEW'), eq(tables.contents.currentEditVersionId, edit.id),
        )).run();
        if (contentChanged.changes !== 1) throw new ApiError(409, 'STALE_CONTENT_STATUS', '内容状态已变化，请刷新后重试');
        db.update(tables.approvals).set({ status: 'expired', updatedAt: at }).where(and(
          eq(tables.approvals.organizationId, approval.organizationId), eq(tables.approvals.contentId, content.id),
          eq(tables.approvals.approvalType, 'final_video'), eq(tables.approvals.status, 'pending'),
        )).run();
        db.insert(tables.contentStatusLogs).values({
          id: crypto.randomUUID(), organizationId: approval.organizationId, contentId: content.id,
          previousStatus: 'WAITING_REVIEW', newStatus: nextStatus, triggerType: 'approval', triggerId: approval.id,
          operatorId: content.operatorId,
          reason: value.comment || '外部客户成片审核通过', isDemo: content.isDemo, createdAt: at,
        }).run();
        db.insert(tables.auditLogs).values({
          id: crypto.randomUUID(), organizationId: approval.organizationId, userId: null,
          action: `edit_approval.${value.status}`, entityType: 'approval', entityId: approval.id,
          metadataJson: json({ contentId: content.id, versionId: edit.id, channel: 'external_token' }),
          isDemo: content.isDemo, createdAt: at,
        }).run();
      });
      return view(token);
    },
  };
}
