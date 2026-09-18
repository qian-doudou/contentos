'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Flame, History, LoaderCircle, RefreshCw, Sparkles, X } from 'lucide-react';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { contentGoals } from '@/db/constants';
import { contentGoalLabels, hookTypeLabels } from '@/lib/content/contracts';
import {
  innovationLevelLabels, onCameraRoleLabels, onCameraRoles, shootingDifficultyByMethod,
  shootingDifficultyLabels, shootingMethodLabels, shootingMethods, shootingRequirementsByMethod,
  storyStructureByInnovation, type CreativeBrief,
} from '@/lib/creative/contracts';
import { accountDetailSchema } from '@/lib/master-data/contracts';
import { plannerPageDataSchema, plannerSessionViewSchema, type PlannerSessionView } from '@/lib/planner/contracts';
import { inspirationSelectionSchema, type InspirationItem } from '@/lib/inspiration/contracts';
import { memoryInitializationResultSchema } from '@/lib/memory/contracts';
import { writeSelectedScript } from '@/lib/scripts/writer-flow';
import { EmptyData, ErrorData, fetchData, LoadingData, RequestError, Tags, useApiData } from '../master-data/common';
import { InspirationPickerDialog } from '../inspiration-picker-dialog';
import { ScriptApprovalPanel } from './script-approval-panel';

const duplicateLabels = { new: '新选题', mild: '有少量相似', remixable: '需突出新角度', high: '与历史高度重复' } as const;
const inspirationStorageKey = 'contentos.inspiration.references';
const durationChoices = [20, 30, 45, 60] as const;
type GoalPreference = 'auto' | (typeof contentGoals)[number];
type InnovationPreference = 'auto' | CreativeBrief['innovationLevel'];

function Stepper({ step }: { step: number }) {
  return <ol aria-label="脚本生成进度" className="grid grid-cols-3 gap-3 rounded-lg border border-[#e9e9e7] bg-white p-4">
    {['确认账号和资料', '选择AI推荐方向', '拿到脚本'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={`flex items-center gap-2 text-sm ${step >= index + 1 ? 'font-medium text-[#37352f]' : 'text-[#9b9a97]'}`}><span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${step >= index + 1 ? 'bg-[#e7f3f8] text-[#0b6e99]' : 'bg-[#f1f1ef]'}`}>{step > index + 1 ? <Check className="size-3.5" /> : index + 1}</span>{label}</li>)}
  </ol>;
}

function ProfileField({ label, values }: { label: string; values: string[] }) {
  return <div><p className="mb-2 text-xs font-medium text-slate-500">{label}</p><Tags values={values} /></div>;
}

function AccountContext({ accountId }: { accountId: string }) {
  const state = useApiData(`/api/accounts/${accountId}`, accountDetailSchema);
  if (state.loading) return <output className="text-sm text-[#787774]">正在读取品牌资料…</output>;
  if (state.error) return <div className="text-sm text-amber-800">品牌资料展示失败。<Button variant="link" onClick={state.reload}>重新读取</Button><p>生成时仍由服务端重新读取已保存资料。</p></div>;
  if (!state.data) return null;
  const { brand, account, client, store, permissions } = state.data;
  return <section className="rounded-xl border border-cyan-100 bg-cyan-50/50 p-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="flex items-center gap-2 font-medium text-cyan-950"><CheckCircle2 className="size-4 text-[#0f7b6c]" />AI 将参考以下客户资料</p><p className="mt-1 text-sm text-cyan-800">{client.clientName} / {brand.brandName} / {store.storeName} / {account.accountName}</p></div><Button type="button" variant="outline" nativeButton={false} render={<Link href={`/clients/${client.id}`} />}>{permissions.canWrite ? '前往客户资料修改' : '查看客户资料'}</Button></div>
    <details className="mt-4 rounded-lg border border-cyan-100 bg-white/90 p-4"><summary className="cursor-pointer font-medium text-cyan-950">查看已带入的具体资料</summary><div className="mt-4 space-y-5 border-t pt-4"><div><p className="mb-2 text-xs font-medium text-slate-500">品牌定位</p><p className="text-sm leading-6">{brand.brandPositioning || '未填写'}</p></div><div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3"><ProfileField label="目标受众" values={brand.targetAudienceJson} /><ProfileField label="核心产品" values={brand.coreProductsJson} /><ProfileField label="核心卖点" values={brand.coreSellingPointsJson} /><ProfileField label="品牌语气" values={brand.brandToneJson} /><ProfileField label="账号目标" values={account.accountGoalJson} /><ProfileField label="内容风格" values={account.contentStyleJson} /><ProfileField label="禁用话题" values={brand.forbiddenTopicsJson} /><ProfileField label="禁用风格" values={account.forbiddenStyleJson} /></div><p className="text-xs leading-5 text-slate-500">门店地址：{[store.city, store.district, store.address].filter(Boolean).join(' ') || '未填写'}。AI 还会在后台读取当前月计划和同账号历史内容。</p></div></details>
  </section>;
}

export function ScriptWriterPage() {
  const page = useApiData('/api/ai/planner', plannerPageDataSchema);
  const params = useSearchParams();
  const [accountId, setAccountId] = useState(params.get('accountId') || '');
  const [extra, setExtra] = useState('');
  const [session, setSession] = useState<PlannerSessionView | null>(null);
  const [selected, setSelected] = useState('');
  const [contentId, setContentId] = useState(params.get('contentId') || '');
  const [pending, setPending] = useState('');
  const [pendingElapsed, setPendingElapsed] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [retryAction, setRetryAction] = useState<'topics' | 'script' | null>(null);
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [restoredSessionId, setRestoredSessionId] = useState('');
  const [inspirations, setInspirations] = useState<InspirationItem[]>([]);
  const [directionBatch, setDirectionBatch] = useState(0);
  const [goalPreference, setGoalPreference] = useState<GoalPreference>('auto');
  const [shootingRole, setShootingRole] = useState<CreativeBrief['onCameraRole']>('ai_recommended');
  const [innovationPreference, setInnovationPreference] = useState<InnovationPreference>('auto');
  const [creativeEdits, setCreativeEdits] = useState<Record<string, CreativeBrief>>({});
  const locked = useRef(false);
  const sessionParam = params.get('sessionId');
  const inspirationParam = params.get('inspirations');
  const restoring = Boolean(sessionParam && session?.id !== sessionParam && restoredSessionId !== sessionParam);
  const writableAccounts = page.data?.accounts.filter((item) => item.canWrite) ?? [];
  const activeAccount = writableAccounts.find((item) => item.id === accountId) ?? writableAccounts[0];
  const selectedAccountId = activeAccount?.id ?? '';
  const estimate = page.data?.plannerPointCost !== null && page.data?.scriptPointCost !== null && page.data
    ? page.data.plannerPointCost + page.data.scriptPointCost : null;
  const selectedCandidate = session?.candidates.find(candidate => candidate.id === selected) ?? null;
  const selectedBrief = selectedCandidate ? creativeEdits[selectedCandidate.id] ?? selectedCandidate.creativeBrief : null;

  function beginPending(value: string) {
    setPending(value);
    setPendingElapsed(0);
    setRetryAction(null);
  }

  useEffect(() => {
    if (!pending) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setPendingElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [pending]);

  function updateCreative(candidateId: string, changes: Partial<CreativeBrief>) {
    const candidate = session?.candidates.find(item => item.id === candidateId);
    if (!candidate) return;
    setCreativeEdits(current => ({
      ...current,
      [candidateId]: { ...(current[candidateId] ?? candidate.creativeBrief), ...changes },
    }));
  }

  function cycleSellingPoint(candidateId: string) {
    const candidate = session?.candidates.find(item => item.id === candidateId);
    if (!candidate) return;
    const brief = creativeEdits[candidateId] ?? candidate.creativeBrief;
    const index = brief.sellingPointOptions.indexOf(brief.sellingPoint);
    updateCreative(candidateId, { sellingPoint: brief.sellingPointOptions[(index + 1) % brief.sellingPointOptions.length] });
  }

  function cycleHook(candidateId: string) {
    const candidate = session?.candidates.find(item => item.id === candidateId);
    if (!candidate) return;
    const brief = creativeEdits[candidateId] ?? candidate.creativeBrief;
    const index = brief.hookOptions.findIndex(option => option.type === brief.hookType && option.text === brief.hookText);
    const next = brief.hookOptions[(index + 1) % brief.hookOptions.length];
    updateCreative(candidateId, { hookType: next.type, hookText: next.text });
  }

  useEffect(() => {
    if (inspirationParam !== '1') return;
    const timer = window.setTimeout(() => {
      try {
        const parsed = inspirationSelectionSchema.safeParse(JSON.parse(sessionStorage.getItem(inspirationStorageKey) ?? 'null'));
        if (parsed.success) setInspirations(parsed.data);
      } catch { sessionStorage.removeItem(inspirationStorageKey); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [inspirationParam]);

  function rememberInspirations(items: InspirationItem[]) {
    setInspirations(items);
    const query = new URLSearchParams(window.location.search);
    if (items.length) {
      sessionStorage.setItem(inspirationStorageKey, JSON.stringify(items));
      query.set('inspirations', '1');
    } else {
      sessionStorage.removeItem(inspirationStorageKey);
      query.delete('inspirations');
    }
    window.history.replaceState(null, '', `/scripts/new${query.size ? `?${query}` : ''}`);
  }

  useEffect(() => {
    if (!sessionParam) return;
    const controller = new AbortController();
    void fetchData(`/api/ai/planner/${sessionParam}`, plannerSessionViewSchema, { signal: controller.signal }).then((value) => {
      if (controller.signal.aborted) return;
      setSession(value); setAccountId(value.accountId);
      setDirectionBatch(1);
      const saved = value.candidates.find((item) => item.persistedContentId);
      if (saved) { setContentId(saved.persistedContentId!); setSelected(saved.id); }
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason : new Error('无法恢复选题')); })
      .finally(() => { if (!controller.signal.aborted) setRestoredSessionId(sessionParam); });
    return () => controller.abort();
  }, [sessionParam]);

  function rememberSession(value: PlannerSessionView) {
    setSession(value);
    const query = new URLSearchParams({ sessionId: value.id });
    window.history.replaceState(null, '', `/scripts/new?${query}`);
  }

  async function generateTopics() {
    if (!activeAccount || locked.current) return;
    locked.current = true; beginPending('topics'); setError(null); setNotice('');
    try {
      const inspirationBrief = inspirations.length ? [
        '以下为用户选择的公开爆款参考。只借鉴选题角度、开场结构和节奏，不复制标题或原文，不沿用其中未经品牌资料验证的事实：',
        ...inspirations.map((item, index) => `${index + 1}. ${item.title}｜${item.author}｜${item.excerpt.slice(0, 220)}`),
      ].join('\n') : '';
      const nextBatch = directionBatch + 1;
      const previousBatch = session?.candidates.length
        ? `这是换一批请求，必须避开上一批的标题与重点：${session.candidates.map(item => `${item.title}（${item.topic}）`).join('；')}`
        : '';
      const specialRequirements = [
        '同时生成核心卖点、创意概念和视频钩子；三条必须在钩子机制、叙事结构和拍摄形式上有明显差异。客户资料只作为事实与品牌边界，不是创意模板。',
        innovationPreference === 'auto' ? '创意强度：分别提供稳妥型、创新型和突破型。' : `创意强度偏好：${innovationPreference}。`,
        `出镜条件：${shootingRole}。`,
        `AI 方向批次：${nextBatch}。请自主决定每条候选最合适的视频效果（content_goal）和重点内容（topic），候选之间尽量覆盖不同效果与不同重点，让用户选择；不要要求用户预先指定。`,
        previousBatch, extra.trim(), inspirationBrief,
      ].filter(Boolean).join('\n').slice(0, 2000) || null;
      const value = await fetchData('/api/ai/planner', plannerSessionViewSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccountId, plannedCount: 3, shootDate: null,
          primaryGoal: goalPreference === 'auto' ? activeAccount.currentPlan?.primaryGoal ?? 'exposure' : goalPreference,
          specialRequirements }),
      });
      setSelected(''); setContentId(''); setCreativeEdits({}); setDirectionBatch(nextBatch); rememberSession(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error('选题生成失败，请重试'));
      setRetryAction('topics');
    }
    finally { locked.current = false; setPending(''); }
  }

  async function reangle(candidateId: string, angle?: string) {
    if (!session || locked.current) return;
    locked.current = true; beginPending(candidateId); setError(null);
    try {
      const value = await fetchData(`/api/ai/planner/${session.id}/candidates/${candidateId}/reangle`, plannerSessionViewSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alternativeAngle: angle || null }),
      });
      if (selected === candidateId) setSelected('');
      rememberSession(value);
    } catch (reason) { setError(reason instanceof Error ? reason : new Error('换角度失败')); }
    finally { locked.current = false; setPending(''); }
  }

  async function writeScript() {
    if (!session || !selected || locked.current) return;
    locked.current = true; beginPending('saving'); setError(null); setNotice('');
    try {
      const result = await writeSelectedScript(fetchData, session.id, selected, (saved, id) => {
        setContentId(id); setSession(saved); beginPending('script');
      }, selectedBrief ?? undefined);
      setNotice(result.fallbackUsed
        ? '当前未配置 API Key，本次为演示脚本，不是千问生成。请配置 Key 后生成正式脚本。'
        : '脚本已保存。可以直接阅读、复制口播，或修改后提交审核。');
      setRevision((value) => value + 1); page.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error('脚本生成失败'));
      setRetryAction('script');
    }
    finally { locked.current = false; setPending(''); }
  }

  async function initializeMemory() {
    const targetAccountId = session?.accountId ?? selectedAccountId;
    if (!targetAccountId || locked.current) return;
    locked.current = true; beginPending('memory'); setError(null);
    try {
      await fetchData('/api/memories/initialize', memoryInitializationResultSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: targetAccountId }),
      });
      setNotice('已确认品牌资料。点击“AI 生成脚本”继续。'); setRevision((value) => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason : new Error('资料确认失败')); }
    finally { locked.current = false; setPending(''); }
  }

  if (page.loading || restoring) return <LoadingData />;
  if (page.error) return <ErrorData error={page.error} retry={page.reload} />;
  if (!page.data) return null;
  const step = contentId ? 3 : session ? 2 : 1;
  const canGenerate = page.data.permissions.canPlan && estimate !== null && page.data.remainingPoints >= estimate;
  return <div className="mx-auto max-w-5xl space-y-7">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">脚本生成</p><h1 className="page-title">今天，拍点什么？</h1><p className="page-description">确认账号资料，让 AI 推荐完整视频方向；选中后微调拍摄参数，再生成脚本。</p></div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{page.data.mode === 'mock' ? '演示生成' : '千问已配置'}</Badge><Badge variant="secondary">可用 {page.data.remainingPoints} 积分</Badge><Button variant="ghost" nativeButton={false} render={<Link href="/contents" />}><History />内容与脚本</Button><Button variant="ghost" nativeButton={false} render={<Link href={selectedAccountId ? `/ai/inspiration?${new URLSearchParams({ accountId: selectedAccountId })}` : '/ai/inspiration'} />}><Flame />完整灵感库</Button><Button variant="ghost" nativeButton={false} render={<Link href="/ai/planner" />}>批量策划</Button></div></header>
    <Stepper step={step} />
    {error && <div role="alert" className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><p>{error instanceof z.ZodError ? '返回结果格式异常，请重试。' : error.message}</p>{contentId && <p>选题已保存，重试只生成脚本，不会再次保存选题。已完成的选题策划费用保留，失败的脚本不扣积分。</p>}{error instanceof RequestError && error.requestId && <p className="text-xs text-rose-600">请求编号：{error.requestId}</p>}<div className="flex flex-wrap gap-2">{error instanceof RequestError && error.code === 'ACTIVE_MEMORY_REQUIRED' && <Button variant="outline" disabled={Boolean(pending)} onClick={() => void initializeMemory()}>确认已有品牌资料并继续</Button>}{retryAction === 'topics' && <Button variant="outline" disabled={Boolean(pending)} onClick={() => void generateTopics()}><RefreshCw />重试生成方向</Button>}{retryAction === 'script' && <Button variant="outline" disabled={Boolean(pending)} onClick={() => void writeScript()}><RefreshCw />只重试生成脚本</Button>}<Button variant="ghost" onClick={() => { setError(null); setRetryAction(null); if (sessionParam && !session) window.location.assign('/scripts/new'); }}>关闭提示</Button></div></div>}
    {notice && <output className="block rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</output>}
    {session?.run.fallbackUsed && !contentId && <output className="block rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">这批选题来自演示模式或历史降级模板，不是千问生成。若已配置 Key，请点击“换一批”重新生成真实 AI 选题。</output>}
    {pending && <output aria-live="polite" className="flex items-center gap-3 rounded-md border border-[#c9e3ec] bg-[#e7f3f8] p-5"><LoaderCircle className="size-5 shrink-0 animate-spin text-[#0b6e99]" /><span><span className="block font-medium text-[#37352f]">{pending === 'topics' ? '正在为你想选题，并检查历史重复…' : pending === 'saving' ? '正在保存你选中的选题…' : pending === 'script' ? '正在写口播和分镜…' : pending === 'memory' ? '正在确认品牌资料…' : '正在换角度，并重新检查重复…'}</span><span className="mt-1 block text-sm text-[#5f5e5a]">已等待 {pendingElapsed} 秒。{pendingElapsed < 15 ? '正在准备上下文并等待千问返回。' : '页面没有卡住；异常请求会自动结束，失败不会扣除本次 AI 积分。'}</span></span></output>}
    {!session && !contentId && <section className="surface-card space-y-6 sm:!p-7">
      {!writableAccounts.length ? <EmptyData title="还没有可生成脚本的账号" description="请先进入客户详情添加品牌、门店和账号；已有账号请联系负责人分配客户。"><Button nativeButton={false} render={<Link href="/clients" />}>前往客户管理</Button></EmptyData> : <>
        <label htmlFor="writer-account" className="block space-y-2 text-base font-medium">给哪个账号写？<NativeSelect id="writer-account" value={selectedAccountId} disabled={Boolean(pending)} className="h-11 w-full" onChange={(event) => { setAccountId(event.target.value); setDirectionBatch(0); }}>
          {writableAccounts.map((account) => <option key={account.id} value={account.id}>{account.clientName} · {account.accountName}</option>)}
        </NativeSelect></label>
        <AccountContext key={selectedAccountId} accountId={selectedAccountId} />
        <section className="rounded-xl border border-[#e9e9e7] bg-white p-5"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">本次创作偏好</h2><Badge variant="secondary">都可智能推荐</Badge></div><p className="mt-1 text-sm text-slate-500">客户资料只限定真实事实和品牌边界，AI 会在这个边界内生成不同创意。</p><div className="mt-4 grid gap-4 md:grid-cols-3">
          <label htmlFor="writer-goal" className="space-y-1.5 text-sm"><span className="font-medium">想达到的效果</span><NativeSelect id="writer-goal" className="h-10 w-full" value={goalPreference} onChange={(event) => setGoalPreference(event.target.value as GoalPreference)}><option value="auto">AI 推荐（参考月度计划）</option>{contentGoals.map(goal => <option key={goal} value={goal}>{contentGoalLabels[goal]}</option>)}</NativeSelect></label>
          <label htmlFor="writer-role" className="space-y-1.5 text-sm"><span className="font-medium">本次出镜条件</span><NativeSelect id="writer-role" className="h-10 w-full" value={shootingRole} onChange={(event) => setShootingRole(event.target.value as CreativeBrief['onCameraRole'])}>{onCameraRoles.map(role => <option key={role} value={role}>{onCameraRoleLabels[role]}</option>)}</NativeSelect></label>
          <label htmlFor="writer-innovation" className="space-y-1.5 text-sm"><span className="font-medium">创意强度</span><NativeSelect id="writer-innovation" className="h-10 w-full" value={innovationPreference} onChange={(event) => setInnovationPreference(event.target.value as InnovationPreference)}><option value="auto">AI 推荐（三种强度）</option>{Object.entries(innovationLevelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label>
        </div><p className="mt-3 text-xs text-slate-500">时长会由 AI 根据创意推荐，选中方向后可再调整。</p></section>
        <section className={`rounded-xl border p-5 ${inspirations.length ? 'border-orange-200 bg-orange-50/60' : 'border-dashed bg-slate-50/70'}`}><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="flex items-center gap-2 font-semibold"><Flame className="size-4 text-orange-600" />爆款参考 <Badge variant="secondary">选填</Badge></h2><p className="mt-1 text-sm text-slate-600">直接搜索公开爆款，选中的角度和结构会跟随本次 AI 选题。</p></div><InspirationPickerDialog key={selectedAccountId} value={inspirations} onChange={rememberInspirations} defaultQuery={activeAccount?.accountName || '本地生活短视频'} /></div>{inspirations.length > 0 && <><div className="mt-4 grid gap-2 md:grid-cols-2">{inspirations.map(item => <div className="rounded-lg border border-orange-100 bg-white/90 p-3" key={`${item.platform}:${item.sourceId}`}><p className="line-clamp-2 text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.author} · 热度 {item.hotScore}</p></div>)}</div><Button type="button" size="sm" variant="ghost" className="mt-3" onClick={() => rememberInspirations([])}><X />清除全部参考</Button></>}</section>
        <details className="rounded-md border border-[#e9e9e7] p-4"><summary className="cursor-pointer text-sm text-[#787774]">给 AI 的补充要求（选填）</summary><Textarea aria-label="补充想法" value={extra} disabled={Boolean(pending)} onChange={(event) => setExtra(event.target.value)} maxLength={1500} className="mt-3" placeholder="例如：避免促销感，多讲老板本人。留空时由 AI 根据资料、计划和历史内容决定。" /></details>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5"><p className="max-w-xl text-sm leading-6 text-slate-500">AI 会同时给出 3 组包含创意、钩子、结构、时长和拍法的完整方向，你只需比较选择。{estimate === null ? '生成能力暂未配置，请联系负责人。' : `选中保存 ${page.data.plannerPointCost} 积分 + 脚本生成 ${page.data.scriptPointCost} 积分，各自成功后计费。`}{estimate !== null && page.data.remainingPoints < estimate && ' 当前积分不足，请联系负责人。'}</p><Button className="h-12 min-w-52 px-6 text-base" disabled={!canGenerate || Boolean(pending)} onClick={() => void generateTopics()}>{pending === 'topics' ? <><LoaderCircle className="animate-spin" />正在生成方向…</> : <><Sparkles />AI 生成 3 组方向<ArrowRight /></>}</Button></div>
      </>}
    </section>}
    {session && !contentId && <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">选择一组视频方向</h2><p className="mt-1 text-sm text-slate-500">{session.accountName} · 第 {Math.max(directionBatch, 1)} 批 · AI 已决定每组效果与重点，并检查历史重复</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={Boolean(pending)} onClick={() => { setSession(null); setSelected(''); setError(null); window.history.replaceState(null, '', `/scripts/new?accountId=${session.accountId}`); }}><ArrowLeft />返回修改偏好</Button><Button disabled={Boolean(pending) || !canGenerate} onClick={() => void generateTopics()}>{pending === 'topics' ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}{pending === 'topics' ? '正在换一批…' : '不满意，换一批'}</Button></div></div>
      <RadioGroup value={selected} onValueChange={(value) => setSelected(String(value))} aria-label="AI推荐视频方向" className="grid items-start gap-4 lg:grid-cols-3">
        {session.candidates.map((candidate) => {
          const brief = creativeEdits[candidate.id] ?? candidate.creativeBrief;
          return <article key={candidate.id} className={`surface-card flex h-full min-w-0 flex-col !p-0 ${selected === candidate.id ? '!border-[#2383e2] ring-2 ring-[#d3e5ef]' : ''}`}>
            <label htmlFor={`candidate-${candidate.id}`} className={`flex flex-1 gap-3 p-5 ${candidate.selectable ? 'cursor-pointer' : 'opacity-65'}`}>
              <RadioGroupItem id={`candidate-${candidate.id}`} className="mt-1" value={candidate.id} disabled={!candidate.selectable || Boolean(pending) || session.status !== 'awaiting_selection'} />
              <span className="min-w-0 flex-1">
                <span className="mb-5 flex flex-wrap gap-2">
                  <Badge className="bg-cyan-50 text-cyan-800">{contentGoalLabels[candidate.contentGoal]}</Badge>
                  <Badge className="bg-violet-50 text-violet-800">{innovationLevelLabels[brief.innovationLevel]}</Badge>
                  <Badge variant="secondary">{brief.targetDurationSeconds} 秒</Badge>
                  <Badge variant="secondary">拍摄{shootingDifficultyLabels[brief.shootingDifficulty]}</Badge>
                  <Badge variant={candidate.selectable ? 'outline' : 'destructive'}>{candidate.qualityStatus === 'blocked' ? '存在事实或风格风险' : duplicateLabels[candidate.duplicateLevel]}</Badge>
                </span>
                <span className="block text-xs font-medium text-slate-400">核心创意</span>
                <span className="mt-1 block text-lg font-semibold leading-7 text-slate-900">{brief.creativeConcept}</span>
                <span className="mt-5 block text-xs font-medium text-slate-400">核心卖点</span>
                <span className="mt-1 block text-sm font-medium leading-6 text-slate-700">{brief.sellingPoint}</span>
                <span className="mt-5 block text-xs font-medium text-slate-400">视频钩子 · {hookTypeLabels[brief.hookType]}</span>
                <span className="mt-1 block rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-800">“{brief.hookText}”</span>
                <span className="mt-5 block text-xs font-medium text-slate-400">故事怎么讲</span>
                <span className="mt-2 block space-y-2">{brief.storyStructure.map((item, index) => <span key={`${candidate.id}:${item}`} className="flex gap-2 text-sm leading-5 text-slate-600"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-medium text-slate-500">{index + 1}</span>{item}</span>)}</span>
                <span className="mt-5 block text-xs font-medium text-slate-400">适合发生在</span>
                <span className="mt-1 block text-sm leading-6 text-slate-600">{brief.audienceMoment}</span>
                <span className="mt-5 block border-t pt-4 text-xs text-slate-400">建议标题</span>
                <span className="mt-1 block text-sm font-medium leading-6 text-slate-700">{candidate.title}</span>
              </span>
            </label>
            <div className="space-y-3 border-t p-4">
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><div><dt className="text-slate-400">拍摄形式</dt><dd className="mt-0.5 font-medium text-slate-700">{shootingMethodLabels[brief.shootingMethod]}</dd></div><div><dt className="text-slate-400">建议出镜</dt><dd className="mt-0.5 font-medium text-slate-700">{onCameraRoleLabels[brief.onCameraRole]}</dd></div><div className="col-span-2"><dt className="text-slate-400">拍摄要求</dt><dd className="mt-0.5 leading-5 text-slate-700">{brief.shootingRequirements.join('、')}</dd></div><div className="col-span-2"><dt className="text-slate-400">结尾行动</dt><dd className="mt-0.5 leading-5 text-slate-700">{brief.ctaStrategy}</dd></div></dl>
              <details className="text-sm"><summary className="cursor-pointer text-[#787774]">为什么推荐 / 相似内容</summary><p className="mt-3 leading-6">{candidate.recommendedReason}</p><p className="mt-2 leading-6 text-[#787774]">{candidate.duplicateReason}</p>{candidate.qualityIssues.map((issue) => <p key={`${issue.code}:${issue.field}`} className="mt-2 text-amber-800">{issue.message}</p>)}{candidate.similarContents.slice(0, 5).map((item) => <Link key={item.contentId} href={`/contents/${item.contentId}`} target="_blank" className="mt-2 block text-[#0b6e99] underline">{item.title}</Link>)}</details>
              <Button variant="outline" className="h-10 w-full" disabled={Boolean(pending) || session.status !== 'awaiting_selection'} onClick={() => void reangle(candidate.id, candidate.alternativeAngles[0])}><RefreshCw />整套换个角度</Button>
            </div>
          </article>;
        })}
      </RadioGroup>
      {selectedCandidate && selectedBrief && <section className="rounded-xl border border-cyan-200 bg-cyan-50/40 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold text-cyan-950">生成脚本前，再确认一下</h3><p className="mt-1 text-sm leading-6 text-cyan-800">保留这套核心创意，只调整执行参数。卖点和钩子只能从 AI 已验证的备选中切换。</p></div><Badge className="bg-cyan-100 text-cyan-900">已选择</Badge></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label htmlFor="selected-duration" className="space-y-1.5 text-sm"><span className="font-medium">视频时长</span><NativeSelect id="selected-duration" className="h-10 w-full bg-white" value={selectedBrief.targetDurationSeconds} onChange={(event) => updateCreative(selectedCandidate.id, { targetDurationSeconds: Number(event.target.value) as CreativeBrief['targetDurationSeconds'] })}>{durationChoices.map(value => <option key={value} value={value}>{value} 秒</option>)}</NativeSelect></label>
          <label htmlFor="selected-method" className="space-y-1.5 text-sm"><span className="font-medium">拍摄形式</span><NativeSelect id="selected-method" className="h-10 w-full bg-white" value={selectedBrief.shootingMethod} onChange={(event) => { const method = event.target.value as CreativeBrief['shootingMethod']; updateCreative(selectedCandidate.id, { shootingMethod: method, shootingDifficulty: shootingDifficultyByMethod[method], shootingRequirements: shootingRequirementsByMethod[method] }); }}>{shootingMethods.map(value => <option key={value} value={value}>{shootingMethodLabels[value]}</option>)}</NativeSelect></label>
          <label htmlFor="selected-role" className="space-y-1.5 text-sm"><span className="font-medium">谁来出镜</span><NativeSelect id="selected-role" className="h-10 w-full bg-white" value={selectedBrief.onCameraRole} onChange={(event) => updateCreative(selectedCandidate.id, { onCameraRole: event.target.value as CreativeBrief['onCameraRole'] })}>{onCameraRoles.map(value => <option key={value} value={value}>{onCameraRoleLabels[value]}</option>)}</NativeSelect></label>
          <label htmlFor="selected-innovation" className="space-y-1.5 text-sm"><span className="font-medium">创意强度</span><NativeSelect id="selected-innovation" className="h-10 w-full bg-white" value={selectedBrief.innovationLevel} onChange={(event) => { const level = event.target.value as CreativeBrief['innovationLevel']; updateCreative(selectedCandidate.id, { innovationLevel: level, storyStructure: storyStructureByInnovation[level] }); }}>{Object.entries(innovationLevelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-cyan-100 bg-white p-4"><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium text-slate-500">当前核心卖点</p><Button type="button" size="sm" variant="outline" disabled={selectedBrief.sellingPointOptions.length < 2} onClick={() => cycleSellingPoint(selectedCandidate.id)}><RefreshCw />换一个卖点</Button></div><p className="mt-3 text-sm font-medium leading-6 text-slate-800">{selectedBrief.sellingPoint}</p></div>
          <div className="rounded-lg border border-cyan-100 bg-white p-4"><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium text-slate-500">当前视频钩子 · {hookTypeLabels[selectedBrief.hookType]}</p><Button type="button" size="sm" variant="outline" disabled={selectedBrief.hookOptions.length < 2} onClick={() => cycleHook(selectedCandidate.id)}><RefreshCw />换一个钩子</Button></div><p className="mt-3 text-sm font-medium leading-6 text-slate-800">“{selectedBrief.hookText}”</p></div>
        </div>
        {creativeEdits[selectedCandidate.id] && <div className="mt-4 flex justify-end"><Button type="button" size="sm" variant="ghost" onClick={() => setCreativeEdits(current => { const next = { ...current }; delete next[selectedCandidate.id]; return next; })}>恢复 AI 推荐</Button></div>}
      </section>}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[#e9e9e7] bg-white p-5"><p className="text-sm text-[#5f5e5a]">{selected ? '创意方向和拍摄参数已确认。接下来自动写出口播、画面和分镜。' : '先选择上面一组创意方向，再调整拍摄参数。'}<span className="mt-1 block text-[#9b9a97]">只保存你选中的这一条。{estimate !== null ? `本次完整生成共 ${estimate} 积分。` : ''}</span></p><Button className="h-10 px-5" disabled={!selected || !selectedBrief || Boolean(pending) || !canGenerate || session.status !== 'awaiting_selection'} onClick={() => void writeScript()}><Sparkles />按这个方向生成脚本<ArrowRight /></Button></div>
    </section>}
    {contentId && !pending && <><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="flex items-center gap-2 font-semibold text-emerald-950"><CheckCircle2 className="size-5" />脚本已保存到内容与脚本</p><p className="mt-1 text-sm leading-6 text-emerald-800">当前版本、后续 V2 和客户审核记录都会保存在这条内容下，可从左侧“内容与脚本”继续处理。</p></div><div className="flex flex-wrap gap-2"><Button size="sm" nativeButton={false} render={<Link href="/contents" />}>打开内容与脚本</Button><Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/contents/${contentId}#scripts`} />}>查看内容详情</Button></div></div></div><div className="flex flex-wrap items-center justify-between gap-3"><Link className="text-sm text-cyan-800 underline" href={`/contents/${contentId}`}>查看完整内容与拍摄进度</Link><Button variant="outline" onClick={() => window.location.assign('/scripts/new')}>再写一条</Button></div><ScriptApprovalPanel key={`${contentId}:${revision}`} contentId={contentId} onContentChanged={() => {}} /></>}
  </div>;
}
