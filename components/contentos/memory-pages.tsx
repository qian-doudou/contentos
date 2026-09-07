'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  BrainCircuit,
  DatabaseZap,
  History,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { memoryTypes } from '@/db/constants';
import { hierarchySchema } from '@/lib/master-data/contracts';
import {
  contextBuildResultSchema,
  memoryInitializationResultSchema,
  memoryListSchema,
  memoryMutationSchema,
  memorySchema,
  type ContextBuildResult,
  type Memory,
} from '@/lib/memory/contracts';
import {
  EmptyData,
  ErrorData,
  fetchData,
  LoadingData,
  useApiData,
} from './master-data/common';

const typeLabels = {
  brand: '品牌事实',
  preference: '偏好',
  content_pattern: '内容规律',
  performance_pattern: '表现规律',
  strategy: '策略',
  temporary: '临时记忆',
} as const;
const sourceLabels = {
  brand_profile: '已确认品牌档案',
  confirmed_preference: '已确认偏好',
  confirmed_performance: '已确认表现规律',
  confirmed_strategy: '已确认策略复盘',
  manual: '人工新增',
} as const;
const statusLabels = {
  active: 'Active',
  inactive: '已停用',
  superseded: '已替代',
  expired: '已过期',
} as const;
type FormState = {
  scopeType: 'brand' | 'account';
  memoryKey: string;
  memoryType: (typeof memoryTypes)[number];
  valueJson: string;
  summary: string;
  importance: string;
  confidence: string;
  effectiveAt: string;
  expiresAt: string;
};
const blankForm: FormState = {
  scopeType: 'account',
  memoryKey: '',
  memoryType: 'preference',
  valueJson: '""',
  summary: '',
  importance: '3',
  confidence: '1',
  effectiveAt: '',
  expiresAt: '',
};

function localInputValue(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function effectiveState(memory: Memory) {
  if (memory.status !== 'active') return statusLabels[memory.status];
  const time = Date.now();
  if (Date.parse(memory.effectiveAt) > time) return '未生效';
  if (memory.expiresAt && Date.parse(memory.expiresAt) <= time)
    return '已超过有效期';
  return '有效';
}

function MemoryCard({
  memory,
  canWrite,
  onReplace,
  onChanged,
}: {
  memory: Memory;
  canWrite: boolean;
  onReplace: (memory: Memory) => void;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function deactivate() {
    setPending(true);
    setError('');
    try {
      await fetchData(`/api/memories/${memory.id}/deactivate`, memorySchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '在 Memory 管理页人工停用' }),
      });
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '停用失败');
    } finally {
      setPending(false);
    }
  }
  const state = effectiveState(memory);
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-sm font-semibold text-slate-900">
              {memory.memoryKey}
            </code>
            <Badge variant="secondary">{typeLabels[memory.memoryType]}</Badge>
            <Badge
              className={
                state === '有效' ? 'bg-emerald-50 text-emerald-700' : ''
              }
              variant="secondary"
            >
              {state}
            </Badge>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            {memory.summary}
          </p>
        </div>
        {canWrite && memory.status === 'active' && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReplace(memory)}
            >
              <History />
              新增替代
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => void deactivate()}
            >
              停用
            </Button>
          </div>
        )}
      </div>
      <pre className="mt-3 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        {JSON.stringify(memory.valueJson, null, 2)}
      </pre>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
        <span>范围：{memory.scopeType === 'brand' ? '品牌' : '账号'}</span>
        <span>重要度：{memory.importance}/5</span>
        <span>置信度：{memory.confidence}</span>
        <span>来源：{sourceLabels[memory.sourceType]}</span>
        <span>
          生效：{new Date(memory.effectiveAt).toLocaleString('zh-CN')}
        </span>
        {memory.expiresAt && (
          <span>
            失效：{new Date(memory.expiresAt).toLocaleString('zh-CN')}
          </span>
        )}
      </div>
      {memory.sourceId && (
        <p className="mt-2 break-all font-mono text-[11px] text-slate-400">
          source_id: {memory.sourceId}
        </p>
      )}
      {memory.supersedesMemoryId && (
        <p className="mt-1 break-all font-mono text-[11px] text-slate-400">
          supersedes: {memory.supersedesMemoryId}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </article>
  );
}

export function MemoryPanel({
  accountId,
  compact = false,
}: {
  accountId: string;
  compact?: boolean;
}) {
  const state = useApiData(
    `/api/memories?accountId=${encodeURIComponent(accountId)}&pageSize=100`,
    memoryListSchema,
  );
  const [form, setForm] = useState<FormState>(blankForm);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [focus, setFocus] = useState('');
  const [context, setContext] = useState<ContextBuildResult | null>(null);
  if (state.loading) return <LoadingData />;
  if (state.error)
    return <ErrorData error={state.error} retry={state.reload} />;
  if (!state.data) return null;
  const data = state.data;
  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const useAsReplacement = (memory: Memory) => {
    setForm({
      scopeType: memory.scopeType,
      memoryKey: memory.memoryKey,
      memoryType: memory.memoryType,
      valueJson: JSON.stringify(memory.valueJson, null, 2),
      summary: memory.summary,
      importance: String(memory.importance),
      confidence: String(memory.confidence),
      effectiveAt: localInputValue(memory.effectiveAt),
      expiresAt: localInputValue(memory.expiresAt),
    });
    setNotice(
      '已带入旧版本；保存后将新增记录并把当前 Active 版本标记为 superseded。',
    );
  };
  async function save(
    event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault();
    setPending(true);
    setNotice('');
    try {
      const valueJson = JSON.parse(form.valueJson) as unknown;
      const result = await fetchData('/api/memories', memoryMutationSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          scopeType: form.scopeType,
          memoryKey: form.memoryKey,
          memoryType: form.memoryType,
          valueJson,
          summary: form.summary,
          importance: Number(form.importance),
          confidence: Number(form.confidence),
          effectiveAt: form.effectiveAt
            ? new Date(form.effectiveAt).toISOString()
            : undefined,
          expiresAt: form.expiresAt
            ? new Date(form.expiresAt).toISOString()
            : null,
        }),
      });
      setNotice(
        result.replacedMemoryId
          ? '新版本已生效，旧版本已标记为 superseded。'
          : '记忆已创建。',
      );
      setForm(blankForm);
      state.reload();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setPending(false);
    }
  }
  async function initialize() {
    setPending(true);
    setNotice('');
    try {
      const result = await fetchData(
        '/api/memories/initialize',
        memoryInitializationResultSchema,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId }),
        },
      );
      setNotice(
        `已初始化 ${result.created.length} 条，跳过 ${result.skippedKeys.length} 条未变更档案。`,
      );
      state.reload();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '初始化失败');
    } finally {
      setPending(false);
    }
  }
  async function buildContext() {
    setPending(true);
    setNotice('');
    try {
      const result = await fetchData(
        '/api/context/build',
        contextBuildResultSchema,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId, focus }),
        },
      );
      setContext(result);
      setNotice(`上下文快照 ${result.snapshotId} 已保存。`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '构建失败');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-5">
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-100 bg-cyan-50/70 p-4">
          <div>
            <p className="font-medium text-cyan-950">
              {data.account.brandName} / {data.account.name}
            </p>
            <p className="mt-1 text-sm text-cyan-800">
              品牌与账号记忆共用同一个可追溯视图。
            </p>
          </div>
          <Badge variant="outline">{data.total} 条历史</Badge>
        </div>
      )}
      {notice && (
        <output className="block rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
          {notice}
        </output>
      )}
      <section className="surface-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">长期 Memory</h2>
            <p className="mt-1 text-sm text-slate-500">
              仅 Active、已生效且未过期记忆进入生产上下文。
            </p>
          </div>
          {data.permissions.canWrite && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => void initialize()}
            >
              <RefreshCw />
              从档案初始化
            </Button>
          )}
        </div>
        {data.items.length ? (
          <div className="grid gap-3">
            {data.items.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                canWrite={data.permissions.canWrite}
                onReplace={useAsReplacement}
                onChanged={state.reload}
              />
            ))}
          </div>
        ) : (
          <EmptyData
            title="暂无长期记忆"
            description="可从已确认品牌与账号档案初始化，或人工新增。"
          />
        )}
      </section>
      {data.permissions.canWrite && (
        <form className="surface-card space-y-4" onSubmit={save}>
          <div>
            <h2 className="font-semibold">人工新增 / 替代</h2>
            <p className="mt-1 text-sm text-slate-500">
              相同 scope + key 保存时会新增替代，不会覆盖旧正文。
            </p>
          </div>
          <fieldset className="grid gap-4 md:grid-cols-2" disabled={pending}>
            <label htmlFor="memory-scope" className="space-y-1.5 text-sm">
              范围
              <NativeSelect
                id="memory-scope"
                className="w-full"
                value={form.scopeType}
                onChange={(event) =>
                  setField(
                    'scopeType',
                    event.target.value as FormState['scopeType'],
                  )
                }
              >
                <option value="account">账号</option>
                <option value="brand">品牌</option>
              </NativeSelect>
            </label>
            <label htmlFor="memory-type" className="space-y-1.5 text-sm">
              类型
              <NativeSelect
                id="memory-type"
                className="w-full"
                value={form.memoryType}
                onChange={(event) =>
                  setField(
                    'memoryType',
                    event.target.value as FormState['memoryType'],
                  )
                }
              >
                {memoryTypes.map((value) => (
                  <option value={value} key={value}>
                    {typeLabels[value]}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label htmlFor="memory-key" className="space-y-1.5 text-sm">
              Memory key
              <Input
                id="memory-key"
                required
                maxLength={160}
                placeholder="promotion.group_buy_price"
                value={form.memoryKey}
                onChange={(event) => setField('memoryKey', event.target.value)}
              />
            </label>
            <label htmlFor="memory-summary" className="space-y-1.5 text-sm">
              摘要
              <Input
                id="memory-summary"
                required
                maxLength={1000}
                placeholder="已确认的事实或偏好"
                value={form.summary}
                onChange={(event) => setField('summary', event.target.value)}
              />
            </label>
            <label
              htmlFor="memory-value"
              className="space-y-1.5 text-sm md:col-span-2"
            >
              JSON 值
              <Textarea
                id="memory-value"
                className="min-h-28 font-mono text-xs"
                required
                value={form.valueJson}
                onChange={(event) => setField('valueJson', event.target.value)}
              />
            </label>
            <label htmlFor="memory-importance" className="space-y-1.5 text-sm">
              重要度 1–5
              <Input
                id="memory-importance"
                type="number"
                min="1"
                max="5"
                step="1"
                required
                value={form.importance}
                onChange={(event) => setField('importance', event.target.value)}
              />
            </label>
            <label htmlFor="memory-confidence" className="space-y-1.5 text-sm">
              置信度 0–1
              <Input
                id="memory-confidence"
                type="number"
                min="0"
                max="1"
                step="0.01"
                required
                value={form.confidence}
                onChange={(event) => setField('confidence', event.target.value)}
              />
            </label>
            <label
              htmlFor="memory-effective-at"
              className="space-y-1.5 text-sm"
            >
              生效时间（留空即现在）
              <Input
                id="memory-effective-at"
                type="datetime-local"
                value={form.effectiveAt}
                onChange={(event) =>
                  setField('effectiveAt', event.target.value)
                }
              />
            </label>
            <label htmlFor="memory-expires-at" className="space-y-1.5 text-sm">
              失效时间（可选）
              <Input
                id="memory-expires-at"
                type="datetime-local"
                value={form.expiresAt}
                onChange={(event) => setField('expiresAt', event.target.value)}
              />
            </label>
          </fieldset>
          <div className="flex justify-end">
            <Button disabled={pending}>
              <Plus />
              {pending ? '保存中…' : '保存新版本'}
            </Button>
          </div>
        </form>
      )}
      {data.permissions.canBuildContext && (
        <section className="surface-card space-y-4">
          <div className="flex items-start gap-3">
            <span className="card-icon">
              <DatabaseZap />
            </span>
            <div>
              <h2 className="font-semibold">确定性 Context Builder</h2>
              <p className="mt-1 text-sm text-slate-500">
                按 L0–L4 与固定预算组装并保存快照；不调用 LLM。
              </p>
            </div>
          </div>
          <label htmlFor="context-focus" className="space-y-1.5 text-sm">
            当前关注点（用于确定性相关性排序）
            <Textarea
              id="context-focus"
              maxLength={1000}
              placeholder="例如：菏泽本地团购转化"
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
            />
          </label>
          <Button disabled={pending} onClick={() => void buildContext()}>
            <BrainCircuit />
            构建并保存快照
          </Button>
          {context && (
            <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
              {JSON.stringify(context, null, 2)}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}

export function MemoryPage() {
  const hierarchy = useApiData('/api/accounts', hierarchySchema);
  const [accountId, setAccountId] = useState('');
  const selectedAccountId = accountId || hierarchy.data?.accounts[0]?.id || '';
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">AI CONTEXT</p>
          <h1 className="page-title">长期记忆</h1>
          <p className="page-description">
            管理已确认事实、偏好与策略，以可追溯快照为后续 AI
            任务提供受控上下文。
          </p>
        </div>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/ai" />}
        >
          <ShieldCheck />
          AI 运营
        </Button>
      </header>
      {hierarchy.loading ? (
        <LoadingData />
      ) : hierarchy.error ? (
        <ErrorData error={hierarchy.error} retry={hierarchy.reload} />
      ) : (
        hierarchy.data &&
        (hierarchy.data.accounts.length ? (
          <>
            <section className="surface-card">
              <label
                htmlFor="memory-account"
                className="flex flex-wrap items-center gap-3 text-sm font-medium"
              >
                账号
                <NativeSelect
                  id="memory-account"
                  className="min-w-64"
                  value={selectedAccountId}
                  onChange={(event) => setAccountId(event.target.value)}
                >
                  {hierarchy.data.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {
                        hierarchy.data?.brands.find(
                          (brand) => brand.id === account.brandId,
                        )?.brandName
                      }{' '}
                      / {account.accountName}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            </section>
            {selectedAccountId && (
              <MemoryPanel
                key={selectedAccountId}
                accountId={selectedAccountId}
              />
            )}
          </>
        ) : (
          <section className="surface-card">
            <EmptyData
              title="暂无可访问账号"
              description="请先创建客户、品牌、门店与账号，或由管理员分配客户权限。"
            />
          </section>
        ))
      )}
    </div>
  );
}
