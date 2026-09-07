'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  contentHistorySchema, contentStatusLabels, contentStatusTriggerLabels, contentTransitionResultSchema, type Content,
} from '@/lib/content/contracts';
import { fetchData, RequestError, useApiData } from '@/components/contentos/master-data/common';
import { contentTransitionRules, manualNextStatuses, type ContentStatus } from '@/lib/content/workflow';
import { WorkflowStatusBadge } from './workflow-board';

export function ContentWorkflowPanel({ content, onChanged }: { content: Content; onChanged: () => void }) {
  const history = useApiData(`/api/contents/${content.id}/history`, contentHistorySchema);
  const nextStatuses = manualNextStatuses(content.status);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const restricted = contentTransitionRules.filter(rule => rule.from === content.status && rule.trigger !== 'manual');

  async function transition(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextStatus = form.get('newStatus') as ContentStatus | null;
    if (!nextStatus) return;
    setPending(true); setMessage('');
    try {
      await fetchData(`/api/contents/${content.id}/transition`, contentTransitionResultSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newStatus: nextStatus, reason }),
      });
      setReason('');
      setMessage('状态已更新');
      history.reload();
      onChanged();
    } catch (error) {
      setMessage(error instanceof RequestError ? `${error.message}（${error.code}）` : error instanceof Error ? error.message : '状态更新失败');
    } finally { setPending(false); }
  }

  return <section className="surface-card">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">内容工作流</h2><p className="mt-1 text-sm text-slate-500">状态变更与日志写入在同一数据库事务内完成。</p></div><WorkflowStatusBadge status={content.status} /></div>
    {nextStatuses.length > 0 && history.data?.permissions.canWrite && <form className="mt-5 grid items-end gap-3 md:grid-cols-[1fr_2fr_auto]" onSubmit={transition}>
      <label htmlFor="workflow-next-status" className="space-y-1.5 text-sm">下一状态<NativeSelect id="workflow-next-status" className="w-full" name="newStatus" defaultValue={nextStatuses[0]}>{nextStatuses.map(status => <option key={status} value={status}>{contentStatusLabels[status]}</option>)}</NativeSelect></label>
      <label htmlFor="workflow-reason" className="space-y-1.5 text-sm">变更原因<Input id="workflow-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} required placeholder="例：客户审核通过" /></label>
      <Button type="submit" disabled={pending || !reason.trim()}>{pending ? '更新中…' : '确认转换'}</Button>
    </form>}
    {restricted.length > 0 && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">后续可达状态 {restricted.map(rule => contentStatusLabels[rule.to]).join('、')} 需由拍摄或发布业务 API 在同一事务中触发，此处不可直接修改。</p>}
    {message && <output className="mt-4 block text-sm font-medium text-cyan-800">{message}</output>}
    <div className="mt-6 border-t pt-5"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">状态时间线</h3>{history.data && <Badge variant="outline">{history.data.items.length} 条</Badge>}</div>
      {history.loading ? <p className="text-sm text-slate-500">正在加载状态日志…</p> : history.error ? <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{history.error.message}<Button className="ml-2" size="sm" variant="outline" onClick={history.reload}>重试</Button></div> : history.data?.items.length ? <ol className="space-y-4">{history.data.items.map(item => <li key={item.id} className="relative border-l-2 border-cyan-100 pl-4"><div className="flex flex-wrap items-center gap-2"><WorkflowStatusBadge status={item.previousStatus} /><span className="text-slate-400">→</span><WorkflowStatusBadge status={item.newStatus} /><Badge variant="outline">{contentStatusTriggerLabels[item.triggerType]}</Badge></div><p className="mt-2 text-sm text-slate-700">{item.reason}</p><p className="mt-1 text-xs text-slate-500">{item.operatorName} · {new Date(item.createdAt).toLocaleString('zh-CN')}</p></li>)}</ol> : <p className="text-sm text-slate-500">暂无状态变更记录。新建内容从选题构思开始。</p>}
    </div>
  </section>;
}
