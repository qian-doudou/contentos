import { db } from '@/db/client';
import { masterDataService } from '@/lib/master-data/service';

// Local MVP identity is server-owned. Stage 03 will replace this with a verified session.
// No request header, cookie, query or body may select the organization/user.
export function localContextIds() {
  return {
    organizationId: process.env.LOCAL_ORGANIZATION_ID || '0198f744-8e18-7ae2-a780-52a0e20c1931',
    userId: process.env.LOCAL_USER_ID || '0198f744-8e18-7ae2-a780-52a0e20c1932',
  };
}
export function currentMasterData() {
  const { organizationId, userId } = localContextIds();
  return masterDataService(db, organizationId, userId);
}
