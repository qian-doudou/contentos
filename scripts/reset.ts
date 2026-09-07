import { seedDemoData } from '../db/seed';

const result = seedDemoData({ reset: true });
console.log(`Demo reset complete: ${result.organizationId}, ${result.userCount} demo users.`);

