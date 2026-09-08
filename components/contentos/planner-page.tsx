'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, History, LoaderCircle, RefreshCw, Save, Sparkles, WandSparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { contentGoals } from '@/db/constants';
import { contentGoalLabels, contentTypeLabels, hookTypeLabels } from '@/lib/content/contracts';
import {
  persistPlannerResultSchema, plannerPageDataSchema, plannerSessionViewSchema,
  type PlannerSessionView,
} from '@/lib/planner/contracts';
import { EmptyData, ErrorData, fetchData, LoadingData, useApiData } from './master-data/common';

const duplicateLabels = { new: '新题材', mild: '轻度相似', remixable: '可重构', high: '高度重复' } as const;
const duplicateTone = { new: 'bg-emerald-50 text-emerald-700', mild: 'bg-sky-50 text-sky-700', remixable: 'bg-amber-50 text-amber-700', high: 'bg-rose-50 text-rose-700' } as const;
const qualityLabels = { passed: '质量通过', warning: '有提示', blocked: '质量阻断' } as const;

export function PlannerPage() {
  const page = useApiData('/api/ai/planner', plannerPageDataSchema);
  const [accountId, setAccountId] = useState('');
  const [session, setSession] = useState<PlannerSessionView | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const selectedAccountId = accountId || page.data?.accounts[0]?.id || '';
  const activeAccount = useMemo(() => page.data?.accounts.find((item) => item.id === selectedAccountId) ?? null, [selectedAccountId, page.data]);

  function acceptSession(next: PlannerSessionView) {
    setSession(next);
    setSelected(new Set(next.candidates.filter((item) => item.selectable && item.status === 'active').map((item) => item.id)));
  }

  async function generate(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending('generate'); setMessage(''); setSession(null); setSelected(new Set());
    try {
      const result = await fetchData('/api/ai/planner', plannerSessionViewSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: form.get('accountId'), plannedCount: Number(form.get('plannedCount')),
          shootDate: form.get('shootDate') || null, primaryGoal: form.get('primaryGoal'),
          specialRequirements: form.get('specialRequirements') || null }),
      });
      acceptSession(result);
      setMessage('候选已生成并完成历史去重与质量检查；尚未写入内容库，也尚未扣除 Points。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '生成失败'); }
    finally { setPending(null); }
  }

  async function persist() {
    if (!session || selected.size === 0) return;
    setPending('persist'); setMessage('');
    try {
      const result = await fetchData(`/api/ai/planner/${session.id}/persist`, persistPlannerResultSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateIds: [...selected] }),
      });
      setSession(result.session); setSelected(new Set()); page.reload();
      setMessage(`已写入 ${result.contentIds.length} 条 Content，并在同一事务扣除 ${result.billedPoints} Points。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setPending(null); }
  }

  async function reangle(candidateId: string, alternativeAngle?: string) {
    if (!session) return;
    setPending(candidateId); setMessage('');
    try {
      const result = await fetchData(`/api/ai/planner/${session.id}/candidates/${candidateId}/reangle`, plannerSessionViewSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alternativeAngle: alternativeAngle || null }),
      });
      acceptSession(result);
      setMessage('已生成新角度并重新执行 Top10 检索、duplicate_judge 与质量检查；旧候选版本已保留。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '换角度失败'); }
    finally { setPending(null); }
  }

  if (page.loading) return <LoadingData />;
  if (page.error) return <ErrorData error={page.error} retry={page.reload} />;
  if (!page.data) return null;
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">AI 运营</p><h1 className="page-title">AI Content Planner</h1>
          <p className="page-description">只填写本次任务，品牌定位、产品和账号风格由服务端 Context Builder 自动装配。</p></div>
        <div className="flex gap-2"><Badge variant="outline">{page.data.mode === 'mock' ? '确定性 Mock' : '百炼实时模式'}</Badge>
          <Badge variant="secondary">余额 {page.data.remainingPoints} Points</Badge>
          <Button variant="outline" nativeButton={false} render={<Link href="/ops/runs" />}><History />Run Trace</Button></div>
      </header>

      <section className="grid gap-5 xl:grid-cols-[minmax(360px,0.72fr)_minmax(0,1.28fr)]">
        <form className="surface-card space-y-5" onSubmit={generate}>
          <div><h2 className="text-lg font-semibold">本次策划请求</h2><p className="mt-1 text-sm text-slate-500">表单严格限定 5 个输入字段。</p></div>
          {page.data.accounts.length ? <fieldset disabled={pending !== null || !page.data.permissions.canPlan} className="space-y-4">
            <label className="block space-y-1.5 text-sm" htmlFor="planner-account">抖音账号
              <NativeSelect id="planner-account" name="accountId" value={selectedAccountId} onChange={(event) => setAccountId(event.target.value)} className="w-full">
                {page.data.accounts.map((item) => <option key={item.id} value={item.id} disabled={!item.canWrite}>{item.clientName} / {item.accountName}{item.canWrite ? '' : '（只读）'}</option>)}
              </NativeSelect></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm" htmlFor="planner-count">候选数量（1–20）<Input id="planner-count" name="plannedCount" type="number" min={1} max={20} defaultValue={4} required /></label>
              <label className="block space-y-1.5 text-sm" htmlFor="planner-date">拍摄日期（可选）<Input id="planner-date" name="shootDate" type="date" /></label>
            </div>
            <label className="block space-y-1.5 text-sm" htmlFor="planner-goal">本次首要目标
              <NativeSelect id="planner-goal" name="primaryGoal" defaultValue={activeAccount?.currentPlan?.primaryGoal ?? 'exposure'} className="w-full">
                {contentGoals.map((goal) => <option key={goal} value={goal}>{contentGoalLabels[goal]}</option>)}
              </NativeSelect></label>
            <label className="block space-y-1.5 text-sm" htmlFor="planner-requirements">特殊要求（可选）
              <Textarea id="planner-requirements" name="specialRequirements" maxLength={2000} placeholder="例如：本次集中在门店内拍摄；不要出现具体价格。" /></label>
            <Button className="w-full" type="submit">{pending === 'generate' ? <LoaderCircle className="animate-spin" /> : <WandSparkles />}生成候选（暂不写库）</Button>
          </fieldset> : <EmptyData title="暂无可策划账号" description="请先建立账号并为当前运营人员分配客户。" />}
          <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">生成前检查额度，但仅在已选候选成功写入 Content 后扣除 {page.data.plannerPointCost ?? '未知'} Points；生成失败不扣点。</p>
        </form>

        <aside className="surface-card space-y-4">
          <div><h2 className="font-semibold">当前月度计划缺口</h2><p className="mt-1 text-sm text-slate-500">由数据库中的计划目标与已创建 Content 实时计算，不调用 LLM。</p></div>
          {!activeAccount?.currentPlan ? <EmptyData title="本月暂无计划" description="仍可生成候选，保存后内容不会关联月度计划。" /> : <>
            <div className="rounded-xl border bg-slate-50 p-4"><p className="font-medium">{activeAccount.currentPlan.year} 年 {activeAccount.currentPlan.month} 月 · {contentGoalLabels[activeAccount.currentPlan.primaryGoal]}</p>
              <p className="mt-1 text-sm text-slate-500">计划总量 {activeAccount.currentPlan.plannedContentCount} 条</p></div>
            <div className="grid gap-3 sm:grid-cols-2">{activeAccount.gaps.map((gap) => <div className="rounded-xl border p-3" key={gap.contentType}>
              <div className="flex justify-between gap-2"><span className="font-medium">{contentTypeLabels[gap.contentType]}</span><Badge className={gap.gap ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'} variant="secondary">缺口 {gap.gap}</Badge></div>
              <p className="mt-2 text-xs text-slate-500">目标 {gap.targetCount} 条 · 当前 {gap.actualCount} 条 · 占比 {gap.percentage}%</p></div>)}</div>
          </>}
        </aside>
      </section>

      {message && <output className={`block rounded-xl border p-4 text-sm ${message.includes('失败') || message.includes('不足') ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-cyan-200 bg-cyan-50 text-cyan-800'}`}>{message}</output>}

      {session && <section className="space-y-4">
        <div className="surface-card flex flex-wrap items-center justify-between gap-4">
          <div><div className="flex items-center gap-2"><Sparkles className="size-5 text-cyan-600" /><h2 className="text-lg font-semibold">策划候选</h2><Badge variant="outline">Run {session.run.status}</Badge></div>
            <p className="mt-2 max-w-4xl text-sm text-slate-600">{session.planningSummary}</p></div>
          {session.status === 'awaiting_selection' && <Button disabled={pending !== null || selected.size === 0} onClick={() => void persist()}>{pending === 'persist' ? <LoaderCircle className="animate-spin" /> : <Save />}保存已选 {selected.size} 条</Button>}
          {session.status === 'completed' && <Button nativeButton={false} render={<Link href="/contents" />}><CheckCircle2 />查看已保存内容</Button>}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">{session.candidates.map((candidate) => {
          const checked = selected.has(candidate.id);
          const disabled = session.status !== 'awaiting_selection' || !candidate.selectable || pending !== null;
          return <article key={candidate.id} className={`surface-card space-y-4 ${candidate.duplicateLevel === 'high' || candidate.qualityStatus === 'blocked' ? 'border-rose-200' : checked ? 'border-cyan-300 ring-2 ring-cyan-100' : ''}`}>
            <div className="flex items-start gap-3"><input aria-label={`选择候选：${candidate.title}`} type="checkbox" className="mt-1 size-4 accent-cyan-600" checked={checked} disabled={disabled} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(candidate.id); else next.delete(candidate.id); return next; })} />
              <div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2"><Badge variant="secondary" className={duplicateTone[candidate.duplicateLevel]}>{duplicateLabels[candidate.duplicateLevel]}</Badge>
                <Badge variant="outline">{qualityLabels[candidate.qualityStatus]}</Badge><Badge variant="outline">v{candidate.revision}</Badge></div>
                <h3 className="mt-3 text-lg font-semibold">{candidate.title}</h3><p className="mt-1 text-sm text-slate-500">{contentTypeLabels[candidate.contentType]} · {contentGoalLabels[candidate.contentGoal]} · {hookTypeLabels[candidate.hookType]}</p></div></div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-400">Topic</dt><dd className="mt-1">{candidate.topic}</dd></div><div><dt className="text-xs text-slate-400">Angle</dt><dd className="mt-1">{candidate.angle}</dd></div><div><dt className="text-xs text-slate-400">Hook</dt><dd className="mt-1">{candidate.hookIdea}</dd></div><div><dt className="text-xs text-slate-400">Core Message</dt><dd className="mt-1">{candidate.coreMessage}</dd></div></dl>
            <div className="rounded-xl bg-slate-50 p-3 text-sm"><p className="font-medium">去重结论</p><p className="mt-1 text-slate-600">{candidate.duplicateReason}</p></div>
            {candidate.qualityIssues.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><p className="flex items-center gap-2 font-medium text-amber-800"><AlertTriangle className="size-4" />质量提示</p><ul className="mt-2 list-disc space-y-1 pl-5 text-amber-700">{candidate.qualityIssues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul></div>}
            {candidate.similarContents.length > 0 && (candidate.duplicateLevel === 'remixable' || candidate.duplicateLevel === 'high') && <details className="rounded-xl border p-3 text-sm"><summary className="cursor-pointer font-medium">查看相似历史内容（{candidate.similarContents.length}）</summary><div className="mt-3 space-y-2">{candidate.similarContents.slice(0, 5).map((item) => <div className="rounded-lg bg-slate-50 p-3" key={item.contentId}><div className="flex justify-between gap-2"><span>{item.title}</span><span className="text-xs text-slate-400">规则 {Math.round(item.ruleScore.combined * 100)}%</span></div><p className="mt-1 text-xs text-slate-500">{item.angle}</p></div>)}</div></details>}
            {session.status === 'awaiting_selection' && <div className="flex flex-wrap gap-2 border-t pt-4"><Button variant="outline" size="sm" disabled={pending !== null} onClick={() => void reangle(candidate.id, candidate.alternativeAngles[0])}>{pending === candidate.id ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}换角度并重新去重</Button>
              {candidate.duplicateLevel === 'high' && <span className="self-center text-xs text-rose-600">高度重复，默认不可勾选</span>}</div>}
          </article>;
        })}</div>
      </section>}
    </div>
  );
}
