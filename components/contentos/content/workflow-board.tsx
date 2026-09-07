'use client';

import { useState } from 'react';
import { GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { contentStatusLabels, contentTransitionResultSchema, type ContentList } from '@/lib/content/contracts';
import { fetchData } from '@/components/contentos/master-data/common';
import { kanbanColumns, manualNextStatuses, type ContentStatus } from '@/lib/content/workflow';
import { formatLocalDate } from './common';

const statusTone: Partial<Record<ContentStatus, string>> = {
  IDEA: 'bg-slate-100 text-slate-700', SCRIPTING: 'bg-sky-50 text-sky-700', WAITING_APPROVAL: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-emerald-50 text-emerald-700', WAITING_SHOOT: 'bg-cyan-50 text-cyan-700', SHOT: 'bg-indigo-50 text-indigo-700',
  EDITING: 'bg-violet-50 text-violet-700', REVISION: 'bg-orange-50 text-orange-700', WAITING_REVIEW: 'bg-amber-50 text-amber-700',
  READY_TO_PUBLISH: 'bg-teal-50 text-teal-700', PUBLISHED: 'bg-emerald-50 text-emerald-700', REVIEWED: 'bg-slate-100 text-slate-700',
};

export function WorkflowStatusBadge({ status }: { status: ContentStatus }) {
  return <Badge variant="secondary" className={statusTone[status]}>{contentStatusLabels[status]}</Badge>;
}

export function WorkflowBoard({ data, onChanged }: { data: ContentList; onChanged: () => void }) {
  const [items, setItems] = useState(data.items);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  async function transition(contentId: string, newStatus: ContentStatus) {
    const current = items.find(item => item.id === contentId);
    if (!current || pendingIds.includes(contentId)) return;
    const previousStatus = current.status;
    setMessage('');
    setPendingIds(value => [...value, contentId]);
    setItems(value => value.map(item => item.id === contentId ? { ...item, status: newStatus } : item));
    try {
      const result = await fetchData(`/api/contents/${contentId}/transition`, contentTransitionResultSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus, reason: `看板操作：${contentStatusLabels[previousStatus]} → ${contentStatusLabels[newStatus]}` }),
      });
      setItems(value => value.map(item => item.id === contentId ? result.content : item));
      setMessage(`已将「${current.title}」更新为${contentStatusLabels[newStatus]}`);
      onChanged();
    } catch (error) {
      setItems(value => value.map(item => item.id === contentId ? { ...item, status: previousStatus } : item));
      setMessage(error instanceof Error ? `状态未变更：${error.message}` : '状态未变更');
    } finally {
      setPendingIds(value => value.filter(id => id !== contentId));
    }
  }

  function drop(event: React.DragEvent<HTMLElement>, columnStatuses: readonly ContentStatus[]) {
    event.preventDefault();
    const contentId = event.dataTransfer.getData('text/content-id');
    const current = items.find(item => item.id === contentId);
    if (!current) return;
    const candidates = manualNextStatuses(current.status).filter(status => columnStatuses.includes(status));
    if (candidates.length !== 1) {
      setMessage('该拖拽不对应唯一的合法状态转换，原状态已保留。');
      return;
    }
    void transition(contentId, candidates[0]);
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
      <span>当前页 {items.length} / {data.total} 条；拖拽或使用卡片按钮只会调用合法状态 API。</span>
      {message && <output className="font-medium text-cyan-800">{message}</output>}
    </div>
    <div className="grid auto-cols-[18rem] grid-flow-col gap-3 overflow-x-auto pb-3">
      {kanbanColumns.map(column => {
        const cards = items.filter(item => (column.statuses as readonly ContentStatus[]).includes(item.status));
        return <section key={column.id} className="min-h-96 rounded-xl border bg-slate-50/80 p-3">
          <button type="button" className="mb-3 flex w-full items-center justify-between rounded-lg text-left" onDragOver={event => event.preventDefault()} onDrop={event => drop(event, column.statuses)}><span className="font-semibold">{column.label}</span><Badge variant="outline">{cards.length}</Badge></button>
          <div className="space-y-3">{cards.map(item => {
            const account = data.options.accounts.find(option => option.id === item.accountId);
            const writable = Boolean(account?.canWrite);
            const next = manualNextStatuses(item.status);
            return <article key={item.id} className="rounded-xl border bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2"><a className="font-medium leading-5 text-slate-900 hover:text-cyan-800" href={`/contents/${item.id}`}>{item.title}</a><div className="flex items-center gap-1">{item.overdue ? <Badge variant="destructive">已逾期</Badge> : item.dueSoon ? <Badge className="bg-amber-50 text-amber-700">临近截止</Badge> : null}{writable && next.length > 0 && <button type="button" draggable={!pendingIds.includes(item.id)} onDragStart={event => event.dataTransfer.setData('text/content-id', item.id)} className="cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100" aria-label={`拖拽「${item.title}」`}><GripVertical className="size-4" /></button>}</div></div>
              <p className="mt-2 text-xs text-slate-500">{item.accountName} · {formatLocalDate(item.deadline)}</p>
              <div className="mt-3"><WorkflowStatusBadge status={item.status} /></div>
              {writable && next.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{next.map(status => <Button key={status} size="sm" variant="outline" disabled={pendingIds.includes(item.id)} onClick={() => void transition(item.id, status)}>{contentStatusLabels[status]}</Button>)}</div>}
              {writable && next.length === 0 && item.status !== 'REVIEWED' && <p className="mt-3 text-xs text-slate-400">下一步需由对应业务事务触发</p>}
            </article>;
          })}{cards.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-slate-400">暂无内容</p>}</div>
        </section>;
      })}
    </div>
  </div>;
}
