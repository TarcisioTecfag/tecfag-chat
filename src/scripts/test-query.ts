import { db } from "../db";
import { aiReports, aiReportVersions, aiReportFeedback } from "./src/db/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const tenantId = "valem";
  console.log("Querying aiReports for tenantId:", tenantId);

  const baseReports = await db
    .select()
    .from(aiReports)
    .where(eq(aiReports.tenantId, tenantId))
    .orderBy(desc(aiReports.generatedAt))
    .limit(200);

  console.log("baseReports count:", baseReports.length);
  if (baseReports.length > 0) {
    console.log("First baseReport id:", baseReports[0].id);
    console.log("First baseReport tenantId:", baseReports[0].tenantId);
    console.log("First baseReport reportData present:", !!baseReports[0].reportData);
  }

  process.exit(0);
}

main().catch(console.error);
