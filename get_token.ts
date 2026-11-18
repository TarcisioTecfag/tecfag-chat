import { db } from "./src/db";
import { channelConfigs } from "./src/db/schema";
import { eq } from "drizzle-orm";

async function getToken() {
  const configs = await db.select().from(channelConfigs).where(eq(channelConfigs.tenantId, "tecfag"));
  
  if (configs.length > 0) {
    console.log("Token:", configs[0].metaAccessToken);
  } else {
    console.error("Config not found");
  }
}

getToken();
