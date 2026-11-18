import { db } from "../src/db/index.js";
import * as schema from "../src/db/schema.js";

// Manually mapping schema
const channelConfigs = schema.channelConfigs;

(async () => {
  try {
    const configs = await db.select().from(channelConfigs);
    console.log("Channel Configs:");
    configs.forEach(c => {
      console.log(`Tenant: ${c.tenantId}, PhoneID: ${c.metaPhoneNumberId}`);
    });
  } catch (e) {
    console.error("Error fetching configs:", e);
  }
  process.exit(0);
})();
