import { z } from 'zod';
import { permissionCodes, permissionEffects, userRoles, userStatuses } from '@/db/constants';
import { organizationSchema, userSchema } from '@/db/validation';

export const devIdentityInputSchema = z.object({ userId: z.uuid() }).strict();
export const workspaceAccessSchema = z.object({
  scripts: z.boolean(),
  masterData: z.boolean(),
  contents: z.boolean(),
  shoots: z.boolean(),
  edits: z.boolean(),
  ai: z.boolean(),
  analytics: z.boolean(),
  ops: z.boolean(),
  skills: z.boolean(),
  evals: z.boolean(),
  team: z.boolean(),
  settings: z.boolean(),
});
export const devIdentityDataSchema = z.object({
  organization: organizationSchema,
  currentUser: userSchema,
  users: z.array(userSchema),
  switchingEnabled: z.boolean(),
  workspaceAccess: workspaceAccessSchema,
});
export const permissionMapSchema = z.record(z.enum(permissionCodes), z.boolean());
export const userPermissionOverrideSchema = z.object({
  id: z.uuid(),
  permissionCode: z.enum(permissionCodes),
  effect: z.enum(permissionEffects),
  reason: z.string(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  grantedBy: z.uuid(),
  grantedByName: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export const clientAccessSchema = z.object({
  clientId: z.uuid(),
  clientName: z.string(),
  roleOverride: z.enum(userRoles).nullable(),
});
export const teamMemberSchema = userSchema.extend({
  clientCount: z.number().int().nonnegative(),
  clientAccess: z.array(clientAccessSchema),
  permissionOverrides: z.array(userPermissionOverrideSchema),
  effectivePermissions: permissionMapSchema,
  workspaceAccess: workspaceAccessSchema,
  taskCounts: z.object({ shoots: z.number().int().nonnegative(), edits: z.number().int().nonnegative(), approvals: z.number().int().nonnegative() }),
  canManage: z.boolean(),
});
export const teamDataSchema = z.object({
  members: z.array(teamMemberSchema),
  roleCounts: z.record(z.enum(userRoles), z.number().int().nonnegative()),
  clients: z.array(z.object({ id: z.uuid(), name: z.string(), status: z.enum(['active', 'inactive']) })),
  permissionCatalog: z.array(z.object({
    code: z.enum(permissionCodes),
    group: z.enum(['业务管理', 'AI 与质量', '组织与系统']),
    label: z.string(),
    description: z.string(),
    overridable: z.boolean(),
  })),
  roleDefaults: z.record(z.enum(userRoles), permissionMapSchema),
  permissions: z.object({ canManage: z.boolean(), currentUserId: z.uuid() }),
});
const teamMemberAccessFields = {
  role: z.enum(userRoles),
  status: z.enum(userStatuses),
  clientAccess: z.array(z.object({ clientId: z.uuid(), roleOverride: z.enum(userRoles).nullable() })).max(500),
  permissionOverrides: z.array(z.object({
    permissionCode: z.enum(permissionCodes),
    effect: z.enum(permissionEffects),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
  })).max(permissionCodes.length),
  changeReason: z.string().trim().min(2).max(500),
} as const;

function validateTeamMemberAccess(
  value: { clientAccess: Array<{ clientId: string }>; permissionOverrides: Array<{ permissionCode: string }> },
  context: z.RefinementCtx,
) {
  if (new Set(value.clientAccess.map(item => item.clientId)).size !== value.clientAccess.length)
    context.addIssue({ code: 'custom', path: ['clientAccess'], message: '客户范围不能重复' });
  if (new Set(value.permissionOverrides.map(item => item.permissionCode)).size !== value.permissionOverrides.length)
    context.addIssue({ code: 'custom', path: ['permissionOverrides'], message: '用户权限不能重复' });
}

export const teamMemberCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  ...teamMemberAccessFields,
}).strict().superRefine(validateTeamMemberAccess);
export const teamMemberUpdateSchema = z.object(teamMemberAccessFields).strict().superRefine(validateTeamMemberAccess);

export const roleLabels: Record<(typeof userRoles)[number], string> = {
  owner: '所有者',
  admin: '管理员',
  operator: '运营',
  photographer: '摄影',
  editor: '剪辑',
  viewer: '查看者',
};

export type DevIdentityData = z.infer<typeof devIdentityDataSchema>;
export type WorkspaceAccess = z.infer<typeof workspaceAccessSchema>;
export type TeamData = z.infer<typeof teamDataSchema>;
export type TeamMember = z.infer<typeof teamMemberSchema>;
export type TeamMemberCreate = z.infer<typeof teamMemberCreateSchema>;
export type TeamMemberUpdate = z.infer<typeof teamMemberUpdateSchema>;
