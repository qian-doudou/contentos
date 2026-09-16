'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { contentGoals } from '@/db/constants';
import { contentGoalLabels, contentTypeLabels } from '@/lib/content/contracts';
import { accountDetailSchema } from '@/lib/master-data/contracts';
import { plannerPageDataSchema, plannerSessionViewSchema, type PlannerSessionView } from '@/lib/planner/contracts';
import { memoryInitializationResultSchema } from '@/lib/memory/contracts';
import { writeSelectedScript } from '@/lib/scripts/writer-flow';
import { EmptyData, ErrorData, fetchData, LoadingData, RequestError, useApiData } from '../master-data/common';
import { ScriptApprovalPanel } from './script-approval-panel';

type Goal = (typeof contentGoals)[number];
const goalOptions: Array<{ value: Goal | 'auto'; label: string; description: string }> = [
  { value: 'auto', label: '帮我推荐', description: '结合本月计划来安排' },
  { value: 'exposure', label: '让更多人知道', description: '吸引本地人看见门店' },
  { value: 'trust', label: '让顾客信任', description: '讲人物、产品与真实细节' },
  { value: 'conversion', label: '带动到店下单', description: '帮助顾客做消费决定' },
];
const duplicateLabels = { new: '新选题', mild: '有少量相似', remixable: '需突出新角度', high: '与历史高度重复' } as const;

function Stepper({ step }: { step: number }) {
  return <ol aria-label="写脚本进度" className="grid grid-cols-3 gap-3 rounded-lg border border-[#e9e9e7] bg-white p-4">
    {['选账号和方向', '选一个AI选题', '拿到脚本'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={`flex items-center gap-2 text-sm ${step >= index + 1 ? 'font-medium text-[#37352f]' : 'text-[#9b9a97]'}`}><span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${step >= index + 1 ? 'bg-[#e7f3f8] text-[#0b6e99]' : 'bg-[#f1f1ef]'}`}>{step > index + 1 ? <Check className="size-3.5" /> : index + 1}</span>{label}</li>)}
  </ol>;
}

function AccountContext({ accountId, product, onProduct }: { accountId: string; product: string; onProduct: (value: string) => void }) {
  const state = useApiData(`/api/accounts/${accountId}`, accountDetailSchema);
  if (state.loading) return <output className="text-sm text-[#787774]">正在读取品牌资料…</output>;
  if (state.error) return <div className="text-sm text-amber-800">品牌资料展示失败。<Button variant="link" onClick={state.reload}>重新读取</Button><p>生成时仍由服务端重新读取已保存资料。</p></div>;
  if (!state.data) return null;
  const { brand, account } = state.data;
  return <div className="space-y-4">
    <div className="rounded-md border border-[#e9e9e7] bg-[#f7f7f5] p-4 text-sm leading-6"><p className="flex items-center gap-2 font-medium text-[#37352f]"><CheckCircle2 className="size-4 text-[#0f7b6c]" />已带入 {brand.brandName} 的品牌资料</p><p className="mt-2 text-[#5f5e5a]">{brand.brandPositioning || '定位尚未填写'}{account.contentStyleJson.length ? ` · ${account.contentStyleJson.join('、')}` : ''}</p><p className="mt-1 text-[#787774]">有效品牌记忆与历史内容会自动参考，无需重新填写。</p></div>
    {brand.coreProductsJson.length > 0 && <fieldset><legend className="mb-2 text-sm font-medium">这次想重点讲什么？<span className="ml-2 font-normal text-slate-400">可直接跳过</span></legend><RadioGroup value={product} onValueChange={(value) => onProduct(String(value))} className="flex flex-wrap gap-2" aria-label="重点产品">
      {['', ...new Set(brand.coreProductsJson)].map((value) => <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${product === value ? 'border-[#2383e2] bg-[#e7f3f8] text-[#0b6e99]' : 'border-[#e9e9e7] bg-white hover:bg-[#f7f7f5]'}`}><RadioGroupItem value={value} />{value || 'AI帮我选'}</label>)}
    </RadioGroup></fieldset>}
  </div>;
}

export function ScriptWriterPage() {
  const page = useApiData('/api/ai/planner', plannerPageDataSchema);
  const params = useSearchParams();
  const [accountId, setAccountId] = useState(params.get('accountId') || '');
  const [goal, setGoal] = useState<Goal | 'auto'>('auto');
  const [product, setProduct] = useState('');
  const [extra, setExtra] = useState('');
  const [session, setSession] = useState<PlannerSessionView | null>(null);
  const [selected, setSelected] = useState('');
  const [contentId, setContentId] = useState(params.get('contentId') || '');
  const [pending, setPending] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [restoredSessionId, setRestoredSessionId] = useState('');
  const locked = useRef(false);
  const sessionParam = params.get('sessionId');
  const restoring = Boolean(sessionParam && session?.id !== sessionParam && restoredSessionId !== sessionParam);
  const writableAccounts = page.data?.accounts.filter((item) => item.canWrite) ?? [];
  const activeAccount = writableAccounts.find((item) => item.id === accountId) ?? writableAccounts[0];
  const selectedAccountId = activeAccount?.id ?? '';
  const estimate = page.data?.plannerPointCost !== null && page.data?.scriptPointCost !== null && page.data
    ? page.data.plannerPointCost + page.data.scriptPointCost : null;

  useEffect(() => {
    if (!sessionParam) return;
    const controller = new AbortController();
    void fetchData(`/api/ai/planner/${sessionParam}`, plannerSessionViewSchema, { signal: controller.signal }).then((value) => {
      if (controller.signal.aborted) return;
      setSession(value); setAccountId(value.accountId);
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
    locked.current = true; setPending('topics'); setError(null); setNotice('');
    try {
      const value = await fetchData('/api/ai/planner', plannerSessionViewSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccountId, plannedCount: 3, shootDate: null,
          primaryGoal: goal === 'auto' ? activeAccount.currentPlan?.primaryGoal ?? 'exposure' : goal,
          specialRequirements: [product ? `优先围绕已保存的产品或服务“${product}”构思。` : '', extra.trim()].filter(Boolean).join('\n') || null }),
      });
      setSelected(''); setContentId(''); rememberSession(value);
    } catch (reason) { setError(reason instanceof Error ? reason : new Error('选题生成失败，请重试')); }
    finally { locked.current = false; setPending(''); }
  }

  async function reangle(candidateId: string, angle?: string) {
    if (!session || locked.current) return;
    locked.current = true; setPending(candidateId); setError(null);
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
    locked.current = true; setPending('saving'); setError(null); setNotice('');
    try {
      const result = await writeSelectedScript(fetchData, session.id, selected, (saved, id) => {
        setContentId(id); setSession(saved); setPending('script');
      });
      setNotice(result.fallbackUsed
        ? '当前未配置 API Key，本次为演示脚本，不是千问生成。请配置 Key 后生成正式脚本。'
        : '脚本已保存。可以直接阅读、复制口播，或修改后提交审核。');
      setRevision((value) => value + 1); page.reload();
    } catch (reason) { setError(reason instanceof Error ? reason : new Error('脚本生成失败')); }
    finally { locked.current = false; setPending(''); }
  }

  async function initializeMemory() {
    const targetAccountId = session?.accountId ?? selectedAccountId;
    if (!targetAccountId || locked.current) return;
    locked.current = true; setPending('memory'); setError(null);
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
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">AI 写脚本</p><h1 className="page-title">今天，拍点什么？</h1><p className="page-description">选账号、挑选题，AI把口播和分镜写好。</p></div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{page.data.mode === 'mock' ? '演示生成' : '千问已配置'}</Badge><Badge variant="secondary">可用 {page.data.remainingPoints} 积分</Badge><Button variant="ghost" nativeButton={false} render={<Link href="/ai/planner" />}>批量策划</Button></div></header>
    <Stepper step={step} />
    {error && <div role="alert" className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><p>{error instanceof z.ZodError ? '返回结果格式异常，请重试。' : error.message}</p>{contentId && <p>选题已保存，重试只生成脚本，不会再次保存选题。已完成的选题策划费用保留，失败的脚本不扣积分。</p>}{error instanceof RequestError && error.code === 'ACTIVE_MEMORY_REQUIRED' && <Button variant="outline" disabled={Boolean(pending)} onClick={() => void initializeMemory()}>确认已有品牌资料并初始化记忆</Button>}{!contentId && <Button variant="outline" onClick={() => { setError(null); if (sessionParam && !session) window.location.assign('/scripts/new'); }}>继续选择</Button>}</div>}
    {notice && <output className="block rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</output>}
    {session?.run.fallbackUsed && !contentId && <output className="block rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">这批选题来自演示模式或历史降级模板，不是千问生成。若已配置 Key，请点击“换一批”重新生成真实 AI 选题。</output>}
    {pending && <output aria-live="polite" className="flex items-center gap-3 rounded-md border border-[#c9e3ec] bg-[#e7f3f8] p-5"><LoaderCircle className="size-5 shrink-0 animate-spin text-[#0b6e99]" /><span><span className="block font-medium text-[#37352f]">{pending === 'topics' ? '正在为你想选题，并检查历史重复…' : pending === 'saving' ? '正在保存你选中的选题…' : pending === 'script' ? '正在写口播和分镜…' : pending === 'memory' ? '正在确认品牌资料…' : '正在换角度，并重新检查重复…'}</span><span className="mt-1 block text-sm text-[#5f5e5a]">这可能需要一点时间，请保持页面打开。</span></span></output>}
    {!session && !contentId && <section className="surface-card space-y-6 sm:!p-7">
      {!writableAccounts.length ? <EmptyData title="还没有可写脚本的账号" description="先添加一个品牌账号；已有账号请联系负责人分配客户。"><Button nativeButton={false} render={<Link href="/accounts" />}>查看品牌与账号</Button></EmptyData> : <>
        <label htmlFor="writer-account" className="block space-y-2 text-base font-medium">给哪个账号写？<NativeSelect id="writer-account" value={selectedAccountId} disabled={Boolean(pending)} className="h-11 w-full" onChange={(event) => { setAccountId(event.target.value); setProduct(''); setGoal('auto'); }}>
          {writableAccounts.map((account) => <option key={account.id} value={account.id}>{account.clientName} · {account.accountName}</option>)}
        </NativeSelect></label>
        <fieldset disabled={Boolean(pending)}><legend className="mb-3 text-base font-medium">这条视频想达到什么效果？</legend><RadioGroup aria-label="视频目标" value={goal} onValueChange={(value) => setGoal(value as Goal | 'auto')} className="grid gap-3 sm:grid-cols-2">
          {goalOptions.map((option) => <label key={option.value} htmlFor={`goal-${option.value}`} className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors ${goal === option.value ? 'border-[#2383e2] bg-[#e7f3f8]' : 'border-[#e9e9e7] hover:bg-[#f7f7f5]'}`}><RadioGroupItem id={`goal-${option.value}`} className="mt-1" value={option.value} /><span><span className="block font-medium text-[#37352f]">{option.label}</span><span className="mt-1 block text-sm text-[#787774]">{option.value === 'auto' && activeAccount?.currentPlan ? `本月重点：${contentGoalLabels[activeAccount.currentPlan.primaryGoal]}` : option.description}</span></span></label>)}
        </RadioGroup></fieldset>
        <fieldset disabled={Boolean(pending)}><AccountContext key={selectedAccountId} accountId={selectedAccountId} product={product} onProduct={setProduct} /></fieldset>
        <details className="rounded-md border border-[#e9e9e7] p-4"><summary className="cursor-pointer text-sm text-[#787774]">还有特别想说的？（选填）</summary><Textarea aria-label="补充想法" value={extra} disabled={Boolean(pending)} onChange={(event) => setExtra(event.target.value)} maxLength={1500} className="mt-3" placeholder="例如：这次想讲老板为什么坚持手切。留空也可以。" /></details>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5"><p className="max-w-xl text-sm leading-6 text-slate-500">先给你 3 个选题，选中后再写脚本。{estimate === null ? '生成能力暂未配置，请联系负责人。' : `选题保存 ${page.data.plannerPointCost} 积分 + 脚本生成 ${page.data.scriptPointCost} 积分，各自成功后计费。`}{estimate !== null && page.data.remainingPoints < estimate && ' 当前积分不足，请联系负责人。'}</p><Button className="h-12 min-w-48 px-6 text-base" disabled={!canGenerate || Boolean(pending)} onClick={() => void generateTopics()}>{pending === 'topics' ? <><LoaderCircle className="animate-spin" />正在生成选题…</> : <><Sparkles />帮我想 3 个选题<ArrowRight /></>}</Button></div>
      </>}
    </section>}
    {session && !contentId && <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">挑一个你想拍的</h2><p className="mt-1 text-sm text-slate-500">{session.accountName} · 已参考品牌资料并检查历史内容</p></div><Button variant="outline" disabled={Boolean(pending)} onClick={() => { setSession(null); setSelected(''); setError(null); window.history.replaceState(null, '', `/scripts/new?accountId=${session.accountId}`); }}><ArrowLeft />调整方向</Button></div>
      <RadioGroup value={selected} onValueChange={(value) => setSelected(String(value))} aria-label="AI选题" className="grid items-start gap-4 lg:grid-cols-3">
        {session.candidates.map((candidate) => <article key={candidate.id} className={`surface-card flex h-full min-w-0 flex-col !p-0 ${selected === candidate.id ? '!border-[#2383e2] ring-2 ring-[#d3e5ef]' : ''}`}>
          <label htmlFor={`candidate-${candidate.id}`} className={`flex flex-1 gap-3 p-5 ${candidate.selectable ? 'cursor-pointer' : 'opacity-65'}`}><RadioGroupItem id={`candidate-${candidate.id}`} className="mt-1" value={candidate.id} disabled={!candidate.selectable || Boolean(pending) || session.status !== 'awaiting_selection'} /><span className="min-w-0"><span className="mb-3 flex flex-wrap gap-2"><Badge variant="secondary">{contentTypeLabels[candidate.contentType]}</Badge><Badge variant={candidate.selectable ? 'outline' : 'destructive'}>{candidate.qualityStatus === 'blocked' ? '存在事实或风格风险' : duplicateLabels[candidate.duplicateLevel]}</Badge></span><span className="block text-lg font-semibold leading-7">{candidate.title}</span><span className="mt-4 block text-sm text-slate-400">开头可以这样说</span><span className="mt-1 block text-base leading-7 text-slate-700">“{candidate.hookIdea}”</span><span className="mt-4 block text-sm leading-6 text-slate-500">{candidate.angle}</span></span></label>
          <div className="space-y-3 border-t p-4"><details className="text-sm"><summary className="cursor-pointer text-[#787774]">为什么推荐 / 相似内容</summary><p className="mt-3 leading-6">{candidate.recommendedReason}</p><p className="mt-2 leading-6 text-[#787774]">{candidate.duplicateReason}</p>{candidate.qualityIssues.map((issue) => <p key={`${issue.code}:${issue.field}`} className="mt-2 text-amber-800">{issue.message}</p>)}{candidate.similarContents.slice(0, 5).map((item) => <Link key={item.contentId} href={`/contents/${item.contentId}`} target="_blank" className="mt-2 block text-[#0b6e99] underline">{item.title}</Link>)}</details><Button variant="outline" className="h-10 w-full" disabled={Boolean(pending) || session.status !== 'awaiting_selection'} onClick={() => void reangle(candidate.id, candidate.alternativeAngles[0])}><RefreshCw />换个角度</Button></div>
        </article>)}
      </RadioGroup>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[#e9e9e7] bg-white p-5"><p className="text-sm text-[#5f5e5a]">{selected ? '选题已选好。接下来自动写出口播、开场和分镜。' : '点选上面一个选题，再开始写脚本。'}<span className="mt-1 block text-[#9b9a97]">只保存你选中的这一条。{estimate !== null ? `本次完整生成共 ${estimate} 积分。` : ''}</span></p><Button className="h-10 px-5" disabled={!selected || Boolean(pending) || !canGenerate || session.status !== 'awaiting_selection'} onClick={() => void writeScript()}><Sparkles />就写这个脚本<ArrowRight /></Button></div>
    </section>}
    {contentId && !pending && <><div className="flex flex-wrap items-center justify-between gap-3"><Link className="text-sm text-cyan-800 underline" href={`/contents/${contentId}`}>查看完整内容与拍摄进度</Link><Button variant="outline" onClick={() => window.location.assign('/scripts/new')}>再写一条</Button></div><ScriptApprovalPanel key={`${contentId}:${revision}`} contentId={contentId} onContentChanged={() => {}} /></>}
  </div>;
}
