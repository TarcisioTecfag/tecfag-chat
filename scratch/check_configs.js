import { db } from "../src/db/index.js";
import { channelConfigs } from "../src/db/schema.js";

(async () => {
  const configs = await db.select().from(channelConfigs);
  console.log(JSON.stringify(configs, null, 2));
  process.exit(0);
})();
