'use client';

import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  accountDefaults, accountSchema, brandDefaults, brandSchema, clientDefaults, clientSchema, storeDefaults, storeSchema,
  createAccountSchema, createBrandSchema, createClientSchema, createStoreSchema,
  type Account, type Brand, type Client, type Hierarchy, type Store,
} from '@/lib/master-data/contracts';
import type { User } from '@/db/validation';
import { accountTypeLabels, cooperationLabels, fetchData, statusLabels } from './common';

type Kind = 'client' | 'brand' | 'store' | 'account';
type Field = { key: string; label: string; type?: 'text' | 'number' | 'date' | 'textarea' | 'list'; required?: boolean; options?: Record<string, string>; max?: number };
const fields: Record<Kind, Field[]> = {
  client: [
    { key: 'clientName', label: '客户名称', required: true }, { key: 'industry', label: '行业', required: true },
    { key: 'subIndustry', label: '细分行业' }, { key: 'cooperationStatus', label: '合作状态', options: cooperationLabels },
    { key: 'contractStart', label: '合同开始', type: 'date' }, { key: 'contractEnd', label: '合同结束', type: 'date' },
    { key: 'monthlyContentTarget', label: '月度内容目标', type: 'number', required: true, max: 2147483647 },
    { key: 'status', label: '状态', options: statusLabels }, { key: 'notes', label: '备注', type: 'textarea' },
  ],
  brand: [
    { key: 'brandName', label: '品牌名称', required: true }, { key: 'industry', label: '行业' },
    { key: 'subIndustry', label: '细分行业' }, { key: 'city', label: '城市' },
    { key: 'brandPositioning', label: '品牌定位', type: 'textarea' },
    { key: 'targetAudienceJson', label: '目标受众', type: 'list' }, { key: 'coreProductsJson', label: '核心产品', type: 'list' },
    { key: 'coreSellingPointsJson', label: '核心卖点', type: 'list' }, { key: 'brandToneJson', label: '品牌语气', type: 'list' },
    { key: 'forbiddenTopicsJson', label: '禁用话题', type: 'list' }, { key: 'status', label: '状态', options: statusLabels },
  ],
  store: [
    { key: 'storeName', label: '门店名称', required: true }, { key: 'city', label: '城市' }, { key: 'district', label: '区县' },
    { key: 'address', label: '地址', type: 'textarea' }, { key: 'storeType', label: '门店类型' },
    { key: 'status', label: '状态', options: statusLabels },
  ],
  account: [
    { key: 'accountName', label: '账号名称', required: true }, { key: 'platform', label: '平台', options: { douyin: '抖音' } },
    { key: 'accountType', label: '账号类型', options: accountTypeLabels }, { key: 'followers', label: '粉丝数（未知可留空）', type: 'number', max: Number.MAX_SAFE_INTEGER },
    { key: 'accountGoalJson', label: '账号目标', type: 'list' }, { key: 'contentStyleJson', label: '内容风格', type: 'list' },
    { key: 'forbiddenStyleJson', label: '禁用风格', type: 'list' }, { key: 'status', label: '状态', options: statusLabels },
  ],
};
const defaults = { client: clientDefaults, brand: brandDefaults, store: storeDefaults, account: accountDefaults };
const inputSchemas = { client: createClientSchema, brand: createBrandSchema, store: createStoreSchema, account: createAccountSchema };
const outputSchemas = { client: clientSchema, brand: brandSchema, store: storeSchema, account: accountSchema };
const paths = { client: 'clients', brand: 'brands', store: 'stores', account: 'accounts' };
const kindLabels = { client: '客户', brand: '品牌', store: '门店', account: '账号' };
type Props = {
  kind: Kind; initial?: Client | Brand | Store | Account; hierarchy?: Hierarchy; owners?: User[];
  parent?: { clientId?: string; brandId?: string; storeId?: string }; onSaved: (id: string) => void;
};
function valuesForForm(initial: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(initial).map(([key, value]) => {
    if (Array.isArray(value)) return [key, value.filter(item => typeof item === 'string').join('\n')];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return [key, `${value}`];
    return [key, ''];
  }));
}
function formText(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value : '';
}
export function MasterDataForm({ kind, initial, hierarchy, owners = [], parent, onSaved }: Props) {
  const values = valuesForForm({ ...defaults[kind], ...parent, ...initial });
  const [clientId, setClientId] = useState(values.clientId || '');
  const [brandId, setBrandId] = useState(values.brandId || '');
  const [storeId, setStoreId] = useState(values.storeId || '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const brandOptions = hierarchy?.brands.filter(b => !clientId || b.clientId === clientId) ?? [];
  const storeOptions = hierarchy?.stores.filter(s => s.brandId === brandId) ?? [];

  async function submit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true); setError('');
    try {
      const input: Record<string, unknown> = {};
      for (const field of fields[kind]) {
        const value = formText(form.get(field.key));
        input[field.key] = field.type === 'list' ? value.split(/[\n,，、]/).map(v => v.trim()).filter(Boolean)
          : field.type === 'number' ? (value === '' && field.key === 'followers' ? null : Number(value))
          : field.type === 'date' ? (value ? new Date(value).toISOString() : null) : value;
      }
      if (kind === 'client') input.ownerUserId = formText(form.get('ownerUserId')) || null;
      if (kind === 'brand' || kind === 'account') input.clientId = clientId;
      if (kind === 'store' || kind === 'account') input.brandId = brandId;
      if (kind === 'account') input.storeId = storeId;
      const payload = inputSchemas[kind].parse(input);
      const collectionUpdate = initial && (kind === 'brand' || kind === 'store');
      const url = '/api/' + paths[kind] + (initial && !collectionUpdate ? '/' + initial.id : '');
      const result = await fetchData<{ id: string }>(url, outputSchemas[kind], {
        method: initial ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectionUpdate ? { ...payload, id: initial.id } : payload),
      });
      onSaved(result.id);
    } catch (reason) {
      setError(reason instanceof z.ZodError ? reason.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；') : reason instanceof Error ? reason.message : '保存失败');
    } finally { setPending(false); }
  }
  return <form onSubmit={submit} className="space-y-5">
    <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
      {(kind === 'brand' || kind === 'account') && <label className="space-y-1.5 text-sm">所属客户
        <NativeSelect className="w-full" value={clientId} required disabled={!!initial && kind === 'brand'} onChange={event => { setClientId(event.target.value); setBrandId(''); setStoreId(''); }}>
          <option value="">请选择客户</option>{hierarchy?.clients.map(c => <option value={c.id} key={c.id}>{c.clientName}{c.status === 'inactive' ? '（停用）' : ''}</option>)}
        </NativeSelect></label>}
      {(kind === 'store' || kind === 'account') && <label className="space-y-1.5 text-sm">所属品牌
        <NativeSelect className="w-full" value={brandId} required disabled={!!initial && kind === 'store'} onChange={event => { setBrandId(event.target.value); setStoreId(''); }}>
          <option value="">请选择品牌</option>{brandOptions.map(b => <option value={b.id} key={b.id}>{b.brandName}</option>)}
        </NativeSelect></label>}
      {kind === 'account' && <label className="space-y-1.5 text-sm">所属门店
        <NativeSelect className="w-full" value={storeId} required onChange={event => setStoreId(event.target.value)}>
          <option value="">请选择门店</option>{storeOptions.map(s => <option value={s.id} key={s.id}>{s.storeName}</option>)}
        </NativeSelect></label>}
      {fields[kind].map(field => <label key={field.key} className={`space-y-1.5 text-sm ${field.type === 'textarea' ? 'sm:col-span-2' : ''}`}>
        <span>{field.label}{field.required && <span className="ml-1 text-rose-600">*</span>}</span>
        {field.options ? <NativeSelect name={field.key} defaultValue={values[field.key]} className="w-full">{Object.entries(field.options).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</NativeSelect>
          : field.type === 'textarea' || field.type === 'list' ? <Textarea name={field.key} defaultValue={values[field.key]} placeholder={field.type === 'list' ? '每行一项，或用逗号分隔' : ''} rows={3} maxLength={field.type === 'list' ? 30100 : 5000} />
          : <Input name={field.key} defaultValue={field.type === 'date' ? values[field.key]?.slice(0, 10) : values[field.key] ?? ''} type={field.type || 'text'} required={field.required} min={field.type === 'number' ? 0 : undefined} max={field.max} step={field.type === 'number' ? 1 : undefined} maxLength={field.type ? undefined : 200} />}
      </label>)}
      {kind === 'client' && <label className="space-y-1.5 text-sm">负责人<NativeSelect className="w-full" name="ownerUserId" defaultValue={values.ownerUserId || ''}><option value="">未分配</option>{owners.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</NativeSelect></label>}
    </fieldset>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    <div className="flex justify-end border-t pt-4"><Button type="submit" size="lg" disabled={pending}>{pending ? '保存中…' : initial ? '保存修改' : `创建${kindLabels[kind]}`}</Button></div>
  </form>;
}
export function EditorDialog(props: Props & { label?: string }) {
  const [open, setOpen] = useState(false);
  const label = props.label || `${props.initial ? '编辑' : '新增'}${kindLabels[props.kind]}`;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button type="button" variant="outline" />}>{label}</DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>填写业务档案，保存后立即生效。列表字段支持每行一项。</DialogDescription></DialogHeader>
      {open && <MasterDataForm {...props} onSaved={id => { setOpen(false); props.onSaved(id); }} />}
    </DialogContent>
  </Dialog>;
}
