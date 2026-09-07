import { z } from 'zod';
import { userRoles } from '@/db/constants';
import { organizationSchema, userSchema } from '@/db/validation';

export const devIdentityInputSchema = z.object({ userId: z.uuid() }).strict();
export const devIdentityDataSchema = z.object({
  organization: organizationSchema,
  currentUser: userSchema,
  users: z.array(userSchema),
  switchingEnabled: z.boolean(),
});
export const teamMemberSchema = userSchema.extend({ clientCount: z.number().int().nonnegative() });
export const teamDataSchema = z.object({
  members: z.array(teamMemberSchema),
  roleCounts: z.record(z.enum(userRoles), z.number().int().nonnegative()),
});

export const roleLabels: Record<(typeof userRoles)[number], string> = {
  owner: '所有者',
  admin: '管理员',
  operator: '运营',
  photographer: '摄影',
  editor: '剪辑',
  viewer: '查看者',
};

export type DevIdentityData = z.infer<typeof devIdentityDataSchema>;
export type TeamData = z.infer<typeof teamDataSchema>;
