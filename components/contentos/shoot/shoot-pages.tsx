'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { z } from 'zod';
import {
  AlertTriangle, CalendarDays, Camera, ChevronLeft, CircleAlert, Clock3, List,
  MapPin, Plus, RotateCcw, Save, UserRound, UsersRound, X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { EmptyData, ErrorData, fetchData, LoadingData, RequestError, Tags, useApiData } from '@/components/contentos/master-data/common';
import { ConfirmationDialog } from '@/components/contentos/confirmation-dialog';
import { shootDetailSchema, shootItemStatusLabels, shootListSchema, shootStatusLabels } from '@/lib/shoots/contracts';

type ShootListData = z.infer<typeof shootListSchema>;
type ShootDetailData = z.infer<typeof shootDetailSchema>;
type ShootItem = ShootDetailData['items'][number];
type ShootItemAction = 'shot' | 'missing_shots' | 'rescheduled' | 'cancelled' | 'remove';

const shootTone: Record<string, string> = {
  planned: 'bg-cyan-50 text-cyan-700', in_progress: 'bg-blue-50 text-blue-700', completed: 'bg-emerald-50 text-emerald-700',
  partially_completed: 'bg-amber-50 text-amber-800', cancelled: 'bg-slate-100 text-slate-600', rescheduled: 'bg-violet-50 text-violet-700',
};
const itemTone: Record<string, string> = {
  planned: 'bg-cyan-50 text-cyan-700', shot: 'bg-emerald-50 text-emerald-700', missing_shots: 'bg-amber-50 text-amber-800',
  rescheduled: 'bg-violet-50 text-violet-700', cancelled: 'bg-slate-100 text-slate-600',
};

function ShootHeading({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">拍摄管理</p><h1 className="page-title">{title}</h1><p className="page-description">{description}</p></div><div className="flex flex-wrap gap-2">{children}</div></header>;
}

function ShootStatusBadge({ value }: { value: keyof typeof shootStatusLabels }) {
  return <Badge className={shootTone[value]}>{shootStatusLabels[value]}</Badge>;
}

function ShootFormDialog({ data, initial, onSaved }: {
  data: ShootListData | ShootDetailData;
  initial?: ShootDetailData['shoot'];
  onSaved: (detail: ShootDetailData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const initialClientId = initial?.clientId || data.options.clients[0]?.id || '';
  const initialStore = data.options.stores.find((store) => store.id === initial?.storeId)
    || data.options.stores.find((store) => store.clientId === initialClientId);
  const initialOperator = data.options.operators.find((operator) => operator.id === initial?.operatorId)
    || data.options.operators.find((operator) => operator.clientIds.includes(initialClientId));
  const [clientId, setClientId] = useState(initialClientId);
  const [storeId, setStoreId] = useState(initialStore?.id || '');
  const [operatorId, setOperatorId] = useState(initialOperator?.id || '');
  const [location, setLocation] = useState(initial?.location || initialStore?.location || '');
  const stores = data.options.stores.filter((store) => store.clientId === clientId);
  const operators = data.options.operators.filter((operator) => operator.clientIds.includes(clientId));
  function changeClient(nextClientId: string) {
    setClientId(nextClientId);
    const nextStore = data.options.stores.find((store) => store.clientId === nextClientId);
    setStoreId(nextStore?.id || '');
    setLocation(nextStore?.location || '');
    setOperatorId(data.options.operators.find((operator) => operator.clientIds.includes(nextClientId))?.id || '');
  }
  function changeStore(nextStoreId: string) {
    setStoreId(nextStoreId);
    setLocation(data.options.stores.find((store) => store.id === nextStoreId)?.location || '');
  }
  async function submit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault(); setPending(true); setError('');
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(['clientId', 'storeId', 'shootDate', 'startTime', 'endTime', 'operatorId', 'photographerId', 'location', 'notes']
      .flatMap((key) => {
        const value = form.get(key);
        return typeof value === 'string' ? [[key, value]] : [];
      }));
    try {
      const saved = await fetchData(initial ? `/api/shoots/${initial.id}` : '/api/shoots', shootDetailSchema, {
        method: initial ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      setOpen(false); onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally { setPending(false); }
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant={initial ? 'outline' : 'default'} />}>
      {initial ? <><Save />编辑排期</> : <><Plus />新建拍摄</>}
    </DialogTrigger>
    <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{initial ? '编辑拍摄排期' : '新建拍摄排期'}</DialogTitle><DialogDescription>拍摄数量与整体状态由 Checklist 自动计算。</DialogDescription></DialogHeader>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <label className="space-y-1.5 text-sm" htmlFor="shoot-form-client">客户<NativeSelect id="shoot-form-client" name="clientId" value={clientId} disabled={!!initial?.itemCount} onChange={(event) => changeClient(event.target.value)} required><option value="">请选择</option>{data.options.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</NativeSelect></label>
        <label className="space-y-1.5 text-sm" htmlFor="shoot-form-store">门店<NativeSelect id="shoot-form-store" name="storeId" value={storeId} disabled={!!initial?.itemCount} onChange={(event) => changeStore(event.target.value)} required><option value="">请选择</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</NativeSelect></label>
        <label className="space-y-1.5 text-sm" htmlFor="shoot-form-date">拍摄日期<Input id="shoot-form-date" name="shootDate" type="date" defaultValue={initial?.shootDate || format(new Date(), 'yyyy-MM-dd')} required /></label>
        <div className="grid grid-cols-2 gap-3"><label className="space-y-1.5 text-sm" htmlFor="shoot-form-start">开始<Input id="shoot-form-start" name="startTime" type="time" defaultValue={initial?.startTime || '09:00'} required /></label><label className="space-y-1.5 text-sm" htmlFor="shoot-form-end">结束<Input id="shoot-form-end" name="endTime" type="time" defaultValue={initial?.endTime || '11:00'} required /></label></div>
        <label className="space-y-1.5 text-sm" htmlFor="shoot-form-operator">运营<NativeSelect id="shoot-form-operator" name="operatorId" value={operatorId} onChange={(event) => setOperatorId(event.target.value)} required><option value="">请选择</option>{operators.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</NativeSelect></label>
        <label className="space-y-1.5 text-sm" htmlFor="shoot-form-photographer">摄影<NativeSelect id="shoot-form-photographer" name="photographerId" defaultValue={initial?.photographerId || data.options.photographers[0]?.id || ''} required><option value="">请选择</option>{data.options.photographers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</NativeSelect></label>
        <label className="space-y-1.5 text-sm sm:col-span-2" htmlFor="shoot-form-location">地点<Input id="shoot-form-location" name="location" maxLength={500} value={location} onChange={(event) => setLocation(event.target.value)} /></label>
        <label className="space-y-1.5 text-sm sm:col-span-2" htmlFor="shoot-form-notes">备注<Textarea id="shoot-form-notes" name="notes" maxLength={5000} defaultValue={initial?.notes || ''} /></label>
        {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 sm:col-span-2" role="alert">{error}</p>}
        <DialogFooter className="sm:col-span-2"><Button type="submit" disabled={pending}>{pending ? '保存中…' : '保存排期'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function ShootCard({ item }: { item: ShootListData['items'][number] }) {
  const progress = item.itemCount ? Math.round(item.shotCount / item.itemCount * 100) : 0;
  return <Link href={`/shoots/${item.id}`} className="block rounded-xl border bg-white p-4 transition hover:border-cyan-300 hover:shadow-sm">
    <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-900">{item.clientName} · {item.storeName}</p><p className="mt-1 text-sm text-slate-500">{item.shootDate} {item.startTime}–{item.endTime}</p></div><ShootStatusBadge value={item.status} /></div>
    <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><p className="flex items-center gap-2 text-slate-600"><UserRound className="size-4" />{item.photographerName}</p><p className="flex items-center gap-2 text-slate-600"><Camera className="size-4" />{item.shotCount}/{item.itemCount} 已拍</p></div>
    <Progress className="mt-4" value={progress}><ProgressLabel>拍摄进度</ProgressLabel><ProgressValue>{() => `${progress}%`}</ProgressValue></Progress>
  </Link>;
}

export function ShootListPage() {
  const params = useSearchParams();
  const router = useRouter();
  const query = params.toString();
  const state = useApiData(`/api/shoots?${query}`, shootListSchema);
  const [selectedDate, setSelectedDate] = useState<Date>();
  function filter(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const next = new URLSearchParams();
    new FormData(event.currentTarget).forEach((value, key) => { if (typeof value === 'string' && value) next.set(key, value); });
    next.set('page', '1'); router.push(`/shoots?${next.toString()}`);
  }
  function page(value: number) { const next = new URLSearchParams(query); next.set('page', String(value)); router.push(`/shoots?${next.toString()}`); }
  if (state.loading) return <LoadingData />;
  if (state.error) return <ErrorData error={state.error} retry={state.reload} />;
  if (!state.data) return null;
  const data = state.data;
  const selectedKey = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;
  const calendarItems = selectedKey ? data.items.filter((item) => item.shootDate === selectedKey) : data.items;
  const shootDates = data.items.map((item) => new Date(`${item.shootDate}T00:00:00`));
  return <div className="space-y-6">
    <ShootHeading title="拍摄排期" description="按日期查看门店拍摄，并由 Checklist 驱动内容状态。">
      {data.permissions.canCreate && data.options.clients.length > 0 && <ShootFormDialog data={data} onSaved={(detail) => router.push(`/shoots/${detail.shoot.id}`)} />}
    </ShootHeading>
    <form className="surface-card grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-6" key={query} onSubmit={filter}>
      <label className="space-y-1.5 text-sm" htmlFor="shoot-filter-client">客户<NativeSelect id="shoot-filter-client" name="clientId" defaultValue={params.get('clientId') || ''}><option value="">全部客户</option>{data.options.clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label>
      <label className="space-y-1.5 text-sm" htmlFor="shoot-filter-status">状态<NativeSelect id="shoot-filter-status" name="status" defaultValue={params.get('status') || ''}><option value="">全部状态</option>{Object.entries(shootStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label>
      <label className="space-y-1.5 text-sm" htmlFor="shoot-filter-from">开始日期<Input id="shoot-filter-from" name="dateFrom" type="date" defaultValue={params.get('dateFrom') || ''} /></label>
      <label className="space-y-1.5 text-sm" htmlFor="shoot-filter-to">结束日期<Input id="shoot-filter-to" name="dateTo" type="date" defaultValue={params.get('dateTo') || ''} /></label>
      <input type="hidden" name="pageSize" value={params.get('pageSize') || '20'} /><Button type="submit">查询</Button><Button type="button" variant="ghost" onClick={() => router.push('/shoots')}>清空</Button>
    </form>
    <Tabs defaultValue="calendar">
      <TabsList><TabsTrigger value="calendar"><CalendarDays />日历</TabsTrigger><TabsTrigger value="list"><List />列表</TabsTrigger></TabsList>
      <TabsContent value="calendar" className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <section className="surface-card flex justify-center self-start overflow-x-auto"><Calendar mode="single" locale={zhCN} selected={selectedDate} onSelect={setSelectedDate} modifiers={{ hasShoot: shootDates }} modifiersClassNames={{ hasShoot: 'font-semibold text-cyan-700' }} /></section>
        <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="font-semibold">{selectedKey || '当前查询范围'}</h2><Badge variant="outline">{calendarItems.length} 场</Badge></div>{calendarItems.length ? <div className="grid gap-3 xl:grid-cols-2">{calendarItems.map((item) => <ShootCard key={item.id} item={item} />)}</div> : <div className="surface-card"><EmptyData title="当日没有拍摄" description="选择其他日期，或新建拍摄排期。" /></div>}</section>
      </TabsContent>
      <TabsContent value="list" className="surface-card !p-0">
        {data.items.length ? <><div className="grid gap-3 p-4 md:hidden">{data.items.map((item) => <ShootCard key={item.id} item={item} />)}</div><div className="hidden overflow-x-auto md:block"><Table><TableHeader><TableRow><TableHead>日期 / 时间</TableHead><TableHead>客户 / 门店</TableHead><TableHead>运营 / 摄影</TableHead><TableHead>Checklist</TableHead><TableHead>状态</TableHead></TableRow></TableHeader><TableBody>{data.items.map((item) => <TableRow key={item.id}><TableCell><Link className="font-medium text-cyan-800 hover:underline" href={`/shoots/${item.id}`}>{item.shootDate}</Link><p className="mt-1 text-xs text-slate-500">{item.startTime}–{item.endTime}</p></TableCell><TableCell>{item.clientName}<p className="mt-1 text-xs text-slate-500">{item.storeName}</p></TableCell><TableCell>{item.operatorName}<p className="mt-1 text-xs text-slate-500">{item.photographerName}</p></TableCell><TableCell>{item.shotCount}/{item.itemCount} 已拍{item.issueCount > 0 && <p className="mt-1 text-xs text-amber-700">{item.issueCount} 条缺镜</p>}</TableCell><TableCell><ShootStatusBadge value={item.status} /></TableCell></TableRow>)}</TableBody></Table></div></> : <EmptyData title="暂无拍摄排期" description="当前筛选范围没有可显示的拍摄任务。" />}
        <div className="flex items-center justify-between border-t p-4"><span className="text-sm text-slate-500">第 {data.page} 页 · 共 {data.total} 场</span><div className="flex gap-2"><Button variant="outline" disabled={data.page <= 1} onClick={() => page(data.page - 1)}>上一页</Button><Button variant="outline" disabled={data.page * data.pageSize >= data.total} onClick={() => page(data.page + 1)}>下一页</Button></div></div>
      </TabsContent>
    </Tabs>
  </div>;
}

function shotLines(shots: Array<Record<string, unknown>>, versionId: string) {
  const seen = new Map<string, number>();
  return shots.map((shot) => {
    const signature = JSON.stringify(shot);
    const occurrence = (seen.get(signature) ?? 0) + 1;
    seen.set(signature, occurrence);
    return {
      key: `${versionId}:${signature}:${occurrence}`,
      text: Object.entries(shot).map(([key, value]) => `${key}：${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' · '),
    };
  });
}

function ShootChecklistItem({ item, data, pending, fields, setFields, act }: {
  item: ShootItem;
  data: ShootDetailData;
  pending: boolean;
  fields: { missingShots: string; note: string; newShootId: string };
  setFields: (value: { missingShots: string; note: string; newShootId: string }) => void;
  act: (action: ShootItemAction) => void;
}) {
  const actionable = ['planned', 'missing_shots'].includes(item.shootItemStatus);
  return <article className="rounded-xl border bg-white p-4 sm:p-5">
    <div className="flex items-start gap-3"><Checkbox aria-label={`标记${item.title}已拍`} checked={item.shootItemStatus === 'shot'} disabled={!data.permissions.canExecute || !actionable || pending} onCheckedChange={() => act('shot')} className="mt-1 size-5" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">{item.title}</h3><Badge className={itemTone[item.shootItemStatus]}>{shootItemStatusLabels[item.shootItemStatus]}</Badge><Badge variant="outline">脚本 V{item.scriptVersionNo}</Badge></div><p className="mt-2 text-sm font-medium text-cyan-800">Hook：{item.hookText || item.approvedScript.hook}</p></div></div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2"><div><p className="text-sm text-slate-500">人物</p><div className="mt-2"><Tags values={item.peopleJson} /></div></div><div><p className="text-sm text-slate-500">产品</p><p className="mt-2 text-sm text-slate-800">{item.productText || item.approvedScript.product_integration || '未填写'}</p></div></div>
    <div className="mt-5 rounded-xl bg-slate-50 p-4"><p className="text-sm font-semibold">已批准脚本</p><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{item.approvedScript.spoken_script}</p><div className="mt-4 space-y-2"><p className="text-sm font-semibold">Shots</p>{shotLines(item.approvedScript.shots, item.approvedScriptVersionId).map((shot) => <p className="rounded-lg border bg-white px-3 py-2 text-sm leading-6 text-slate-700" key={shot.key}>{shot.text}</p>)}</div></div>
    {item.missingShots && <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><strong>缺失镜头：</strong>{item.missingShots}</div>}
    {item.note && <p className="mt-3 text-sm text-slate-500">备注：{item.note}</p>}
    {actionable && data.permissions.canExecute && <div className="mt-5 space-y-3 border-t pt-4"><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5 text-sm" htmlFor={`missing-${item.id}`}>缺失镜头<Textarea id={`missing-${item.id}`} maxLength={3000} value={fields.missingShots} onChange={(event) => setFields({ ...fields, missingShots: event.target.value })} placeholder="例：缺锅底火焰特写" /></label><label className="space-y-1.5 text-sm" htmlFor={`note-${item.id}`}>原因 / 备注<Textarea id={`note-${item.id}`} maxLength={3000} value={fields.note} onChange={(event) => setFields({ ...fields, note: event.target.value })} placeholder="改期或取消时必填" /></label></div><label className="block space-y-1.5 text-sm" htmlFor={`target-${item.id}`}>改期到（可留空，进入待重新排期）<NativeSelect id={`target-${item.id}`} value={fields.newShootId} onChange={(event) => setFields({ ...fields, newShootId: event.target.value })}><option value="">暂不关联新拍摄</option>{data.rescheduleTargets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</NativeSelect></label><div className="grid gap-2 sm:flex sm:flex-wrap"><Button disabled={pending || !fields.missingShots.trim()} variant="outline" onClick={() => act('missing_shots')}><CircleAlert />记录缺镜</Button><Button disabled={pending || !fields.note.trim()} variant="outline" onClick={() => act('rescheduled')}><RotateCcw />改期</Button><Button disabled={pending || !fields.note.trim()} variant="outline" onClick={() => act('cancelled')}><X />取消此项</Button></div></div>}
    {actionable && data.permissions.canSchedule && data.shoot.status === 'planned' && <div className="mt-3"><Button variant="ghost" disabled={pending} onClick={() => act('remove')}><X />从未执行排期移除</Button></div>}
  </article>;
}

export function ShootDetailPage({ id }: { id: string }) {
  const state = useApiData(`/api/shoots/${id}`, shootDetailSchema);
  const [contentId, setContentId] = useState('');
  const [pending, setPending] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ item: ShootItem; action: 'shot' | 'cancelled' | 'remove' } | null>(null);
  const [itemFields, setItemFields] = useState<Record<string, { missingShots: string; note: string; newShootId: string }>>({});
  const defaults = useMemo(() => Object.fromEntries((state.data?.items || []).map((item) => [item.id, {
    missingShots: item.missingShots, note: item.note, newShootId: '',
  }])), [state.data]);
  if (state.loading) return <LoadingData />;
  if (state.error) return <ErrorData error={state.error} retry={state.reload} />;
  if (!state.data) return null;
  const data = state.data;
  const progress = data.shoot.itemCount ? Math.round(data.shoot.shotCount / data.shoot.itemCount * 100) : 0;
  async function addContent() {
    if (!contentId) return;
    setPending('add'); setError(''); setNotice('');
    try {
      await fetchData(`/api/shoots/${id}/items`, shootDetailSchema, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentId }) });
      setContentId(''); setNotice('内容已加入拍摄，状态已同步。'); state.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '加入失败'); }
    finally { setPending(''); }
  }
  async function act(item: ShootItem, action: ShootItemAction) {
    const fields = itemFields[item.id] || defaults[item.id] || { missingShots: '', note: '', newShootId: '' };
    setPending(item.id); setError(''); setNotice('');
    try {
      await fetchData(`/api/shoots/${id}/items/${item.id}/action`, shootDetailSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, missingShots: fields.missingShots, note: fields.note, newShootId: fields.newShootId || null }),
      });
      setNotice(action === 'shot' ? '已标记拍摄完成，Content 已进入 SHOT。' : '拍摄 Checklist 已更新。'); state.reload();
    } catch (cause) {
      setError(cause instanceof RequestError ? `${cause.message}${cause.requestId ? `（${cause.requestId}）` : ''}` : cause instanceof Error ? cause.message : '更新失败');
    } finally { setPending(''); }
  }
  const confirmationCopy = confirmation ? {
    shot: {
      title: `确认将“${confirmation.item.title}”标记为已拍？`,
      description: '确认后 Checklist 项会进入已拍终态，内容从 WAITING_SHOOT 推进到 SHOT，并进入后续剪辑流程。',
      confirmLabel: '确认标记已拍',
      destructive: false,
    },
    cancelled: {
      title: `确认取消“${confirmation.item.title}”？`,
      description: '确认后该项会记为已取消，内容从 WAITING_SHOOT 退回 APPROVED；需要重新排期才能继续。',
      confirmLabel: '确认取消此项',
      destructive: true,
    },
    remove: {
      title: `确认从当前排期移除“${confirmation.item.title}”？`,
      description: '确认后该项会保留为已取消历史，内容从 WAITING_SHOOT 退回 APPROVED；不能在本页直接撤销。',
      confirmLabel: '确认移出排期',
      destructive: true,
    },
  }[confirmation.action] : null;
  async function confirmShootAction() {
    if (!confirmation) return;
    await act(confirmation.item, confirmation.action);
    setConfirmation(null);
  }
  return <div className="space-y-6">
    <ShootHeading title={`${data.shoot.clientName} · ${data.shoot.shootDate}`} description={`${data.shoot.storeName} / ${data.shoot.startTime}–${data.shoot.endTime}`}>
      <Button variant="outline" nativeButton={false} render={<Link href="/shoots" />}><ChevronLeft />拍摄列表</Button>
      {data.permissions.canEdit && <ShootFormDialog data={data} initial={data.shoot} onSaved={() => { setNotice('排期资料已更新。'); state.reload(); }} />}
    </ShootHeading>
    {(notice || error) && <output className={`block rounded-xl p-3 text-sm ${error ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-800'}`}>{error || notice}</output>}
    <section className="surface-card"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><ShootStatusBadge value={data.shoot.status} />{data.shoot.isDemo && <Badge variant="outline">演示</Badge>}</div><div className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4"><p className="flex items-center gap-2"><Clock3 className="size-4 text-slate-400" />{data.shoot.shootDate} {data.shoot.startTime}–{data.shoot.endTime}</p><p className="flex items-center gap-2"><MapPin className="size-4 text-slate-400" />{data.shoot.location || '未填地点'}</p><p className="flex items-center gap-2"><UsersRound className="size-4 text-slate-400" />运营：{data.shoot.operatorName}</p><p className="flex items-center gap-2"><Camera className="size-4 text-slate-400" />摄影：{data.shoot.photographerName}</p></div>{data.shoot.notes && <p className="mt-4 text-sm leading-6 text-slate-600">{data.shoot.notes}</p>}</div><div className="min-w-48"><Progress value={progress}><ProgressLabel>Checklist</ProgressLabel><ProgressValue>{() => `${data.shoot.shotCount}/${data.shoot.itemCount}`}</ProgressValue></Progress></div></div></section>
    {data.permissions.canSchedule && <section className="surface-card"><div className="flex flex-wrap items-end gap-3"><label className="min-w-64 flex-1 space-y-1.5 text-sm" htmlFor="shoot-add-content">加入已批准内容<NativeSelect id="shoot-add-content" value={contentId} onChange={(event) => setContentId(event.target.value)}><option value="">选择 APPROVED 内容</option>{data.eligibleContents.map((content) => <option key={content.id} value={content.id}>{content.pendingReschedule ? '[待重新排期] ' : ''}{content.title}</option>)}</NativeSelect></label><Button disabled={!contentId || pending === 'add'} onClick={() => void addContent()}><Plus />加入 Checklist</Button></div>{!data.eligibleContents.length && <p className="mt-3 text-sm text-slate-500">当前门店没有可排期的 APPROVED 内容。内容必须具有活动已批准脚本。</p>}</section>}
    <section><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">拍摄内容 Checklist</h2><Badge variant="outline">{data.items.length} 条</Badge></div>{data.items.length ? <div className="space-y-4">{data.items.map((item) => <ShootChecklistItem key={item.id} item={item} data={data} pending={pending === item.id} fields={itemFields[item.id] || defaults[item.id] || { missingShots: '', note: '', newShootId: '' }} setFields={(value) => setItemFields((current) => ({ ...current, [item.id]: value }))} act={(action) => { if (action === 'shot' || action === 'cancelled' || action === 'remove') setConfirmation({ item, action }); else void act(item, action); }} />)}</div> : <div className="surface-card"><EmptyData title="Checklist 为空" description="加入具有活动已批准脚本的 APPROVED 内容后，可在此执行拍摄。" /></div>}</section>
    {data.items.some((item) => item.shootItemStatus === 'missing_shots') && <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><div className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" />存在缺失镜头</div><p className="mt-2">内容保留 WAITING_SHOOT，可在补拍后勾选已拍，或改期到新拍摄。</p></section>}
    {confirmationCopy && <ConfirmationDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !pending) setConfirmation(null); }} title={confirmationCopy.title} description={confirmationCopy.description} confirmLabel={confirmationCopy.confirmLabel} destructive={confirmationCopy.destructive} pending={Boolean(pending)} onConfirm={() => void confirmShootAction()} />}
  </div>;
}
