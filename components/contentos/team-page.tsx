'use client';

import { useMemo, useState } from 'react';
import { BriefcaseBusiness, Check, KeyRound, Minus, ShieldCheck, SlidersHorizontal, UserPlus, UserRoundCheck, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { permissionCodes, permissionEffects, userRoles } from '@/db/constants';
import {
  roleLabels, teamDataSchema, type TeamData, type TeamMember, type WorkspaceAccess,
} from '@/lib/auth/contracts';
import { ConfirmationDialog } from '@/components/contentos/confirmation-dialog';
import { EmptyData, ErrorData, fetchData, LoadingData, useApiData } from '@/components/contentos/master-data/common';

type PermissionCode = (typeof permissionCodes)[number];
type PermissionEffect = (typeof permissionEffects)[number];
type PermissionDraft = Record<PermissionCode, { effect: PermissionEffect | 'inherit'; expiresAt: string }>;

const roleTone: Record<string, string> = {
  owner: 'bg-violet-50 text-violet-700', admin: 'bg-blue-50 text-blue-700', operator: 'bg-cyan-50 text-cyan-700',
  photographer: 'bg-amber-50 text-amber-700', editor: 'bg-fuchsia-50 text-fuchsia-700', viewer: 'bg-slate-100 text-slate-600',
};
const workspaceLabels: Record<keyof WorkspaceAccess, string> = {
  scripts: 'AI 写脚本', masterData: '客户与账号', contents: '内容运营', shoots: '拍摄管理', edits: '剪辑审核',
  ai: 'AI 运营', analytics: '运营数据', ops: '运营中心', skills: 'AI Skill', evals: '评测中心', team: '团队', settings: '系统设置',
};

function toLocalDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function permissionDraft(member?: TeamMember): PermissionDraft {
  const now = Date.now();
  return Object.fromEntries(permissionCodes.map(code => {
    const item = member?.permissionOverrides.find(override => override.permissionCode === code
      && (!override.expiresAt || Date.parse(override.expiresAt) > now));
    return [code, { effect: item?.effect ?? 'inherit', expiresAt: toLocalDateTime(item?.expiresAt ?? null) }];
  })) as PermissionDraft;
}

function workspaceNames(access: WorkspaceAccess) {
  return Object.entries(access).filter(([, allowed]) => allowed).map(([key]) => workspaceLabels[key as keyof WorkspaceAccess]);
}

function previewWorkspaces(role: TeamMember['role'], clients: Array<{ roleOverride: TeamMember['role'] | null }>, effective: Record<PermissionCode, boolean>): WorkspaceAccess {
  const effectiveRoles = [role, ...clients.flatMap(item => item.roleOverride ? [item.roleOverride] : [])];
  const canReadClients = ['owner', 'admin', 'operator', 'viewer'].some(item => effectiveRoles.includes(item as TeamMember['role']));
  const canWriteClients = role === 'owner' || role === 'admin'
    || clients.some(item => ['owner', 'admin', 'operator'].includes(item.roleOverride ?? role));
  return {
    scripts: effective['ai.test'] && canWriteClients,
    masterData: canReadClients,
    contents: canReadClients,
    shoots: ['owner', 'admin', 'operator', 'viewer', 'photographer'].includes(role),
    edits: ['owner', 'admin', 'operator', 'viewer', 'editor'].includes(role),
    ai: effective['ai.test'],
    analytics: canReadClients,
    ops: effective['ops.read'],
    skills: effective['skills.read'],
    evals: effective['eval.read'],
    team: effective['team.read'],
    settings: effective['ai.settings'],
  };
}

function AccountPermissionDialog({ data, member, onSaved }: { data: TeamData; member?: TeamMember; onSaved: (name: string) => void }) {
  const creating = !member;
  const formKey = member?.id ?? 'new';
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(member?.name ?? '');
  const [role, setRole] = useState<TeamMember['role']>(member?.role ?? 'operator');
  const [status, setStatus] = useState<TeamMember['status']>(member?.status ?? 'active');
  const [clients, setClients] = useState(member?.clientAccess.map(item => ({ clientId: item.clientId, roleOverride: item.roleOverride })) ?? []);
  const [draft, setDraft] = useState(() => permissionDraft(member));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const effective = useMemo(() => Object.fromEntries(data.permissionCatalog.map(item => {
    const selection = draft[item.code].effect;
    return [item.code, item.overridable && selection !== 'inherit' ? selection === 'allow' : data.roleDefaults[role][item.code]];
  })) as Record<PermissionCode, boolean>, [data.permissionCatalog, data.roleDefaults, draft, role]);
  const actorRole = data.members.find(item => item.id === data.permissions.currentUserId)?.role;
  const assignableRoles = actorRole === 'owner' ? userRoles : userRoles.filter(item => !['owner', 'admin'].includes(item));
  const visibleWorkspaces = workspaceNames(previewWorkspaces(role, clients, effective));

  function resetForm() {
    setName(member?.name ?? '');
    setRole(member?.role ?? 'operator');
    setStatus(member?.status ?? 'active');
    setClients(member?.clientAccess.map(item => ({ clientId: item.clientId, roleOverride: item.roleOverride })) ?? []);
    setDraft(permissionDraft(member));
    setReason('');
    setError('');
    setConfirming(false);
  }

  function changeOpen(next: boolean) {
    if (next) resetForm();
    setOpen(next);
  }

  function toggleClient(clientId: string, checked: boolean) {
    setClients(current => checked
      ? [...current, { clientId, roleOverride: null }]
      : current.filter(item => item.clientId !== clientId));
  }

  function requestSave() {
    if (creating && name.trim().length < 2) { setError('账号名称至少需要 2 个字'); return; }
    if (reason.trim().length < 2) { setError('请填写至少 2 个字的变更原因'); return; }
    const expired = permissionCodes.some(code => draft[code].effect !== 'inherit'
      && draft[code].expiresAt && new Date(draft[code].expiresAt).getTime() <= Date.now());
    if (expired) { setError('权限有效期必须晚于当前时间'); return; }
    setError(''); setConfirming(true);
  }

  async function save() {
    setPending(true); setError('');
    try {
      await fetchData(creating ? '/api/team' : `/api/team/${member.id}`, teamDataSchema, {
        method: creating ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(creating ? { name: name.trim() } : {}),
          role,
          status,
          clientAccess: clients,
          permissionOverrides: data.permissionCatalog.flatMap(item => {
            const selection = draft[item.code];
            if (!item.overridable || selection.effect === 'inherit') return [];
            return [{ permissionCode: item.code, effect: selection.effect, expiresAt: selection.expiresAt ? new Date(selection.expiresAt).toISOString() : null }];
          }),
          changeReason: reason.trim(),
        }),
      });
      setConfirming(false); setOpen(false); onSaved(creating ? name.trim() : member.name);
    } catch (cause) {
      setConfirming(false);
      setError(cause instanceof Error ? cause.message : creating ? '账号创建失败' : '权限更新失败');
    } finally { setPending(false); }
  }

  return <>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={<Button size={creating ? 'default' : 'sm'} variant={creating ? 'default' : 'outline'} disabled={!creating && !member?.canManage} />}>{creating ? <><UserPlus />添加账号</> : <><SlidersHorizontal />权限设置</>}</DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader><DialogTitle>{creating ? '添加团队账号' : `${member?.name} · 角色与权限`}</DialogTitle><DialogDescription>{creating ? '创建成员身份并一次性分配角色、客户范围和用户权限。账号创建后会立即出现在本地开发身份切换器中。' : '先由角色给出默认权限，再叠加客户范围和用户特例。显式禁止优先于默认允许。'}</DialogDescription></DialogHeader>
        <div className={`grid gap-4 rounded-xl border bg-slate-50 p-4 ${creating ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          {creating && <label className="space-y-1.5 text-sm" htmlFor="new-member-name">账号名称<Input id="new-member-name" maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="例：运营小李" /></label>}
          <label className="space-y-1.5 text-sm" htmlFor={`member-role-${formKey}`}>组织角色<NativeSelect id={`member-role-${formKey}`} className="w-full" value={role} onChange={event => setRole(event.target.value as TeamMember['role'])}>{assignableRoles.map(item => <option key={item} value={item}>{roleLabels[item]}</option>)}</NativeSelect></label>
          <label className="space-y-1.5 text-sm" htmlFor={`member-status-${formKey}`}>成员状态<NativeSelect id={`member-status-${formKey}`} className="w-full" value={status} onChange={event => setStatus(event.target.value as TeamMember['status'])}><option value="active">启用</option><option value="inactive">停用</option></NativeSelect></label>
        </div>
        <section className="space-y-3"><div><h3 className="font-semibold">客户范围</h3><p className="mt-1 text-xs text-slate-500">Owner / Admin 默认可访问全组织；其他角色根据客户分配和客户内角色读写数据。</p></div>
          <div className="grid gap-2 sm:grid-cols-2">{data.clients.map(client => {
            const selection = clients.find(item => item.clientId === client.id);
            return <div className="rounded-lg border p-3" key={client.id}><div className="flex items-center gap-2"><Checkbox aria-label={`授权客户 ${client.name}`} checked={Boolean(selection)} onCheckedChange={checked => toggleClient(client.id, Boolean(checked))} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{client.name}</span>{client.status === 'inactive' && <Badge variant="outline">已停用</Badge>}</div>{selection && <NativeSelect aria-label={`${client.name} 客户内角色`} className="mt-2 w-full" value={selection.roleOverride ?? 'inherit'} onChange={event => setClients(current => current.map(item => item.clientId === client.id ? { ...item, roleOverride: event.target.value === 'inherit' ? null : event.target.value as TeamMember['role'] } : item))}><option value="inherit">继承组织角色</option><option value="viewer">客户内只读</option><option value="operator">客户内运营</option></NativeSelect>}</div>;
          })}</div>
        </section>
        <section className="space-y-3"><div><h3 className="font-semibold">用户权限特例</h3><p className="mt-1 text-xs text-slate-500">只在个别成员与角色默认不同时设置；“继承角色”最容易维护。</p></div>
          <div className="space-y-2">{data.permissionCatalog.map(item => <div className="grid gap-2 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_9rem_12rem] md:items-center" key={item.code}><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{item.label}</p><Badge variant="outline">{item.group}</Badge>{!item.overridable && <Badge variant="secondary">仅角色决定</Badge>}</div><p className="mt-1 text-xs text-slate-500">{item.description}</p></div><NativeSelect aria-label={`${item.label} 权限`} disabled={!item.overridable} value={draft[item.code].effect} onChange={event => setDraft(current => ({ ...current, [item.code]: { ...current[item.code], effect: event.target.value as PermissionEffect | 'inherit' } }))}><option value="inherit">继承角色</option><option value="allow">特别允许</option><option value="deny">显式禁止</option></NativeSelect><Input aria-label={`${item.label} 有效期`} type="datetime-local" disabled={!item.overridable || draft[item.code].effect === 'inherit'} value={draft[item.code].expiresAt} onChange={event => setDraft(current => ({ ...current, [item.code]: { ...current[item.code], expiresAt: event.target.value } }))} /></div>)}</div>
        </section>
        <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-4"><h3 className="text-sm font-semibold text-cyan-950">保存后工作区预览</h3><div className="mt-3 flex flex-wrap gap-2"><Badge className="bg-white text-cyan-800">工作台</Badge>{visibleWorkspaces.map(item => <Badge className="bg-white text-cyan-800" key={item}>{item}</Badge>)}</div><p className="mt-3 text-xs text-cyan-800">有效功能权限 {Object.values(effective).filter(Boolean).length} 项；客户范围 {clients.length} 个。</p></section>
        <label className="space-y-1.5 text-sm" htmlFor={`permission-reason-${formKey}`}>{creating ? '创建原因' : '变更原因'} <span className="text-rose-600">*</span><Textarea id={`permission-reason-${formKey}`} value={reason} onChange={event => setReason(event.target.value)} maxLength={500} placeholder="例：负责仁爱宠物医院运营，临时开通评测查看权限" /></label>
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button disabled={pending} onClick={requestSave}><ShieldCheck />{creating ? '预览并创建' : '预览并保存'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmationDialog open={confirming} onOpenChange={setConfirming} pending={pending} title={creating ? `确认创建“${name.trim()}”账号？` : `确认更新“${member?.name}”的权限？`} description={`将角色设为“${roleLabels[role]}”，授权 ${clients.length} 个客户，配置 ${permissionCodes.filter(code => draft[code].effect !== 'inherit').length} 项用户特例。${creating ? '账号创建' : '变更'}会立即影响导航和后端访问，并记入审计日志。`} confirmLabel={creating ? '确认创建账号' : '确认更新权限'} destructive={status === 'inactive' || permissionCodes.some(code => draft[code].effect === 'deny')} onConfirm={() => void save()} />
  </>;
}

export function TeamPage() {
  const state = useApiData('/api/team', teamDataSchema);
  const [notice, setNotice] = useState('');
  if (state.loading) return <LoadingData />;
  if (state.error) return <ErrorData error={state.error} retry={state.reload} />;
  if (!state.data) return null;
  const data = state.data;
  const activeCount = data.members.filter(member => member.status === 'active').length;
  const assignedCount = data.members.filter(member => member.clientCount > 0).length;
  const overrideCount = data.members.reduce((sum, member) => sum + member.permissionOverrides.filter(item => !item.expiresAt || Date.parse(item.expiresAt) > Date.now()).length, 0);
  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">组织与权限</p><h1 className="page-title">团队权限中心</h1><p className="page-description">用角色定义默认能力，用客户范围限制数据，只在必要时为单个用户设置例外。</p></div>{data.permissions.canManage && <AccountPermissionDialog data={data} onSaved={name => { setNotice(`${name} 的账号已创建`); state.reload(); }} />}</header>
    {notice && <output className="block rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</output>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
      { label: '团队成员', value: data.members.length, icon: UsersRound },
      { label: '启用成员', value: activeCount, icon: UserRoundCheck },
      { label: '有客户范围', value: assignedCount, icon: BriefcaseBusiness },
      { label: '有效用户特例', value: overrideCount, icon: KeyRound },
    ].map(item => <Card key={item.label}><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-sm font-medium text-slate-500">{item.label}</CardTitle><item.icon className="size-4 text-cyan-700" /></CardHeader><CardContent><p className="text-3xl font-semibold tabular-nums">{item.value}</p></CardContent></Card>)}</section>
    <details className="surface-card !p-0">
      <summary aria-label="展开或收起角色权限基线" className="cursor-pointer list-none p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">角色权限基线</h2><p className="mt-1 text-sm text-slate-500">系统角色提供可预测的默认能力；用户特例只覆盖标记为可调整的权限。</p></div><Badge variant="outline">{userRoles.length} 个角色</Badge></div></summary>
      <div className="overflow-x-auto border-t"><Table><TableHeader><TableRow><TableHead className="min-w-56">权限</TableHead>{userRoles.map(role => <TableHead className="text-center" key={role}>{roleLabels[role]}</TableHead>)}</TableRow></TableHeader><TableBody>{data.permissionCatalog.map(item => <TableRow key={item.code}><TableCell><p className="font-medium">{item.label}</p><p className="mt-1 text-xs text-slate-500">{item.group} · {item.overridable ? '可设用户特例' : '仅角色决定'}</p></TableCell>{userRoles.map(role => <TableCell className="text-center" key={role}>{data.roleDefaults[role][item.code] ? <><Check className="mx-auto size-4 text-emerald-600" /><span className="sr-only">允许</span></> : <><Minus className="mx-auto size-4 text-slate-300" /><span className="sr-only">不允许</span></>}</TableCell>)}</TableRow>)}</TableBody></Table></div>
    </details>
    <section className="surface-card !p-0"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-5"><div><h2 className="font-semibold">成员有效权限</h2><p className="mt-1 text-sm text-slate-500">客户范围、当前任务和最终可见工作区集中展示，避免只看到一个“负责客户数”。</p></div><Badge variant="outline">{data.members.length} 人</Badge></div>
      {data.members.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>成员</TableHead><TableHead>角色</TableHead><TableHead>客户范围</TableHead><TableHead>当前任务</TableHead><TableHead>可见工作区</TableHead><TableHead>状态</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{data.members.map(member => {
        const workspaces = workspaceNames(member.workspaceAccess);
        const activeOverrides = member.permissionOverrides.filter(item => !item.expiresAt || Date.parse(item.expiresAt) > Date.now());
        return <TableRow key={member.id}><TableCell><p className="font-medium">{member.name}</p><div className="mt-1 flex gap-1">{member.id === data.permissions.currentUserId && <Badge variant="outline">当前用户</Badge>}{member.isDemo && <Badge variant="outline">演示</Badge>}</div></TableCell><TableCell><Badge variant="secondary" className={roleTone[member.role]}>{roleLabels[member.role]}</Badge>{activeOverrides.length > 0 && <p className="mt-2 text-xs text-amber-700">{activeOverrides.length} 项权限特例</p>}</TableCell><TableCell className="max-w-64">{['owner', 'admin'].includes(member.role) ? <Badge variant="secondary">全组织</Badge> : member.clientAccess.length ? <div className="flex flex-wrap gap-1">{member.clientAccess.map(item => <Badge variant="outline" key={item.clientId}>{item.clientName}{item.roleOverride ? ` · ${roleLabels[item.roleOverride]}` : ''}</Badge>)}</div> : <span className="text-sm text-slate-400">未分配客户</span>}</TableCell><TableCell><div className="space-y-1 text-xs text-slate-600"><p>拍摄 {member.taskCounts.shoots}</p><p>剪辑 {member.taskCounts.edits}</p><p>审核 {member.taskCounts.approvals}</p></div></TableCell><TableCell className="max-w-72"><div className="flex flex-wrap gap-1"><Badge variant="outline">工作台</Badge>{workspaces.slice(0, 4).map(item => <Badge variant="outline" key={item}>{item}</Badge>)}{workspaces.length > 4 && <Badge variant="secondary">+{workspaces.length - 4}</Badge>}</div></TableCell><TableCell><Badge variant="secondary" className={member.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}>{member.status === 'active' ? '启用' : '停用'}</Badge></TableCell><TableCell className="text-right"><AccountPermissionDialog data={data} member={member} onSaved={name => { setNotice(`${name} 的权限已更新`); state.reload(); }} /></TableCell></TableRow>;
      })}</TableBody></Table></div> : <EmptyData title="暂无成员" description="当前组织还没有可显示的团队成员。" />}
    </section>
  </div>;
}
