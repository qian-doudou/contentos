import { seedDemoData } from '../db/seed';

const result = seedDemoData();
console.log(`Seed complete: ${result.organizationId}, ${result.userCount} demo users.`);

