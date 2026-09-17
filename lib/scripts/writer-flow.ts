import { z } from 'zod';
import type { CreativeBrief } from '@/lib/creative/contracts';
import { persistPlannerResultSchema, plannerSessionViewSchema, type PlannerSessionView } from '@/lib/planner/contracts';
import { generateScriptResultSchema, scriptWorkspaceSchema } from './contracts';

export type WriterRequest = <T>(url: string, schema: z.ZodType<T>, init?: RequestInit) => Promise<T>;

/** Resume from server state so a failed script request never re-saves or re-bills its topic. */
export async function writeSelectedScript(
  request: WriterRequest,
  sessionId: string,
  candidateId: string,
  onSaved: (session: PlannerSessionView, contentId: string) => void,
  creativeBrief?: CreativeBrief,
) {
  let session = await request(`/api/ai/planner/${sessionId}`, plannerSessionViewSchema);
  const candidate = session.candidates.find((item) => item.id === candidateId);
  if (!candidate || (!candidate.persistedContentId && (!candidate.selectable || candidate.status !== 'active')))
    throw new Error('这个选题不可使用，请换一个选题或换个角度。');
  let contentId = candidate.persistedContentId;
  if (!contentId) {
    if (session.status !== 'awaiting_selection') throw new Error('这批选题已结束，请重新生成选题。');
    try {
      const saved = await request(`/api/ai/planner/${sessionId}/persist`, persistPlannerResultSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateIds: [candidateId], candidateOverrides: creativeBrief ? [{ candidateId, creativeBrief }] : [] }),
      });
      session = saved.session;
    } catch (error) {
      // The save may have committed even if its HTTP response was lost.
      session = await request(`/api/ai/planner/${sessionId}`, plannerSessionViewSchema).catch(() => { throw error; });
      if (!session.candidates.find((item) => item.id === candidateId)?.persistedContentId) throw error;
    }
    contentId = session.candidates.find((item) => item.id === candidateId)?.persistedContentId ?? null;
  }
  if (!contentId) throw new Error('未能读取已保存的选题，请刷新后重试。');
  onSaved(session, contentId);
  const workspace = await request(`/api/contents/${contentId}/scripts`, scriptWorkspaceSchema);
  if (workspace.content.currentScriptVersionId) return Object.assign(workspace, { fallbackUsed: false });
  const result = await request(`/api/contents/${contentId}/scripts/generate`, generateScriptResultSchema, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  return Object.assign(result.workspace, { fallbackUsed: result.fallbackUsed });
}
