'use client';

/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions -- Native drag events live on the whole card; links and state buttons remain keyboard-accessible. */

import Link from 'next/link';
import { useState } from 'react';
import { Eye, GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  contentBoardSchema, contentStatusLabels, contentTransitionResultSchema, type ContentBoard, type ContentBoardColumn,
} from '@/lib/content/contracts';
import { fetchData } from '@/components/contentos/master-data/common';
import { manualNextStatuses, type ContentStatus } from '@/lib/content/workflow';
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

export function WorkflowBoard({ data, query, onChanged }: { data: ContentBoard; query: string; onChanged: () => void }) {
  const [columns, setColumns] = useState(data.columns);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [loadingColumns, setLoadingColumns] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState('');
  const [dropColumnId, setDropColumnId] = useState('');
  const [message, setMessage] = useState('');
  const items = columns.flatMap(column => column.items);

  function placeItem(value: ContentBoardColumn[], item: ContentBoardColumn['items'][number]) {
    return value.map(column => {
      const hadItem = column.items.some(current => current.id === item.id);
      const acceptsItem = (column.statuses as ContentStatus[]).includes(item.status);
      const remaining = column.items.filter(current => current.id !== item.id);
      return {
        ...column,
        items: acceptsItem ? [item, ...remaining] : remaining,
        total: column.total + (acceptsItem ? 1 : 0) - (hadItem ? 1 : 0),
      };
    });
  }

  async function loadMore(column: ContentBoardColumn) {
    if (loadingColumns.includes(column.id) || column.items.length >= column.total) return;
    setMessage('');
    setLoadingColumns(value => [...value, column.id]);
    try {
      const next = new URLSearchParams(query);
      next.set('column', column.id);
      next.set('page', String(column.page + 1));
      next.set('pageSize', String(column.pageSize));
      const result = await fetchData(`/api/contents/board?${next.toString()}`, contentBoardSchema);
      const incoming = result.columns[0];
      if (!incoming) throw new Error('看板分栏响应为空');
      setColumns(value => value.map(current => current.id === column.id ? {
        ...incoming,
        items: [...current.items, ...incoming.items.filter(item => !current.items.some(existing => existing.id === item.id))],
      } : current));
    } catch (error) {
      setMessage(error instanceof Error ? `加载失败：${error.message}` : '加载失败');
    } finally {
      setLoadingColumns(value => value.filter(id => id !== column.id));
    }
  }

  async function transition(contentId: string, newStatus: ContentStatus) {
    const current = items.find(item => item.id === contentId);
    if (!current || pendingIds.includes(contentId)) return;
    const previousStatus = current.status;
    setMessage('');
    setPendingIds(value => [...value, contentId]);
    setColumns(value => placeItem(value, { ...current, status: newStatus }));
    try {
      const result = await fetchData(`/api/contents/${contentId}/transition`, contentTransitionResultSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus, reason: `看板操作：${contentStatusLabels[previousStatus]} → ${contentStatusLabels[newStatus]}` }),
      });
      setColumns(value => placeItem(value, result.content));
      setMessage(`已将「${current.title}」更新为${contentStatusLabels[newStatus]}`);
      onChanged();
    } catch (error) {
      setColumns(value => placeItem(value, { ...current, status: previousStatus }));
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
      <span>已显示 {items.length} / {data.total} 条；拖动整张卡片可切换合法状态，点击“查看详情”进入完整档案。</span>
      {message && <output className="font-medium text-cyan-800">{message}</output>}
    </div>
    <div className="grid auto-cols-[18rem] grid-flow-col gap-3 overflow-x-auto pb-3">
      {columns.map(column => {
        const cards = column.items;
        return <section
          key={column.id}
          className={`min-h-96 rounded-xl border p-3 transition-colors ${dropColumnId === column.id ? 'border-cyan-400 bg-cyan-50' : 'bg-slate-50/80'}`}
          onDragEnter={() => draggingId && setDropColumnId(column.id)}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
          onDrop={event => { setDropColumnId(''); drop(event, column.statuses); }}
        >
          <div className="mb-3 flex w-full items-center justify-between rounded-lg"><span className="font-semibold">{column.label}</span><Badge variant="outline">{column.total}</Badge></div>
          <div className="space-y-3">{cards.map(item => {
            const account = data.options.accounts.find(option => option.id === item.accountId);
            const writable = Boolean(account?.canWrite);
            const next = manualNextStatuses(item.status);
            const draggable = writable && next.length > 0 && !pendingIds.includes(item.id);
            return <article
              key={item.id}
              aria-label={`${item.title} 内容卡片`}
              className={`rounded-xl border bg-white p-3 shadow-sm transition ${draggable ? 'cursor-grab hover:border-cyan-300 active:cursor-grabbing' : ''} ${draggingId === item.id ? 'opacity-50' : ''}`}
              draggable={draggable}
              onDragEnd={() => { setDraggingId(''); setDropColumnId(''); }}
              onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/content-id', item.id); setDraggingId(item.id); }}
            >
              <div className="flex items-start justify-between gap-2"><Link className="font-medium leading-5 text-slate-900 hover:text-cyan-800" href={`/contents/${item.id}`}>{item.title}</Link><div className="flex items-center gap-1">{item.overdue ? <Badge variant="destructive">已逾期</Badge> : item.dueSoon ? <Badge className="bg-amber-50 text-amber-700">临近截止</Badge> : null}{draggable && <span aria-hidden="true" className="rounded p-1 text-slate-400"><GripVertical className="size-4" /></span>}</div></div>
              <p className="mt-2 text-xs text-slate-500">{item.accountName} · {formatLocalDate(item.deadline)}</p>
              <div className="mt-3 flex items-center justify-between gap-2"><WorkflowStatusBadge status={item.status} /><Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/contents/${item.id}`} />}><Eye />查看详情</Button></div>
              {writable && next.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{next.map(status => <Button key={status} size="sm" variant="outline" disabled={pendingIds.includes(item.id)} onClick={() => void transition(item.id, status)}>{contentStatusLabels[status]}</Button>)}</div>}
              {writable && next.length === 0 && item.status !== 'REVIEWED' && <p className="mt-3 text-xs text-slate-400">下一步需由对应业务事务触发</p>}
            </article>;
          })}{cards.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-slate-400">暂无内容</p>}
            {cards.length < column.total && <Button className="w-full" size="sm" variant="outline" disabled={loadingColumns.includes(column.id)} onClick={() => void loadMore(column)}>{loadingColumns.includes(column.id) ? '加载中…' : `加载更多（剩余 ${column.total - cards.length}）`}</Button>}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
