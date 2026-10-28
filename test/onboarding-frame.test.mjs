import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOnboardingSource as load } from "./helpers/onboarding-harness.mjs";

const { mapTrainingRect } = load("src/lib/onboarding/frame-geometry.ts");
const { placeTourCard } = load("src/lib/onboarding/spotlight-layout.ts");
const { isTrainingSaveRequest } = load("src/lib/onboarding/frame-controller.ts");
const { createTrainingStore, handleTrainingRequest } = load("src/lib/onboarding/frame-store.ts", { "@/lib/ai-persona": { getAiPersona: () => ({ name: "Assistente de teste" }) } });
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const overlap = (a, b) => Math.max(0, Math.min(a.left+a.width,b.left+b.width)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top));

test("iframe coordinates compensate density instead of dropping a visible right-hand button", () => {
  const target = rect(1400, 30, 130, 32), frame = rect(0, 36, 1280, 684);
  const mapped = mapTrainingRect(target, frame, 1600, 855);
  assert.equal(mapped.left, 1120); assert.equal(mapped.width, 104);
  assert.equal(mapped.top, 60); assert.ok(mapped.right <= frame.right);
  assert.equal(mapTrainingRect(rect(1700,0,100,30),frame,1600,855),null);
  assert.equal(mapTrainingRect(target,frame,0,0),null);
});

test("guide remains outside the real drawer and leaves indicated field clickable", () => {
  const drawer = rect(930,36,350,684), field = rect(942,170,320,40);
  const card = placeTourCard(field,{width:1280,height:720},{width:320,height:260},drawer);
  assert.equal(overlap(card,field),0);assert.equal(overlap(card,drawer),0);
  assert.ok(card.left >= 12 && card.top >= 12 && card.left+card.width<=1268 && card.top+card.height<=708);
  for (const field of [rect(5,5,100,30),rect(100,620,220,40),rect(200,200,170,44)]) {
    const mobile=placeTourCard(field,{width:390,height:720},{width:320,height:250});
    assert.equal(overlap(mobile,field),0);
    assert.ok(mobile.left>=12 && mobile.left+mobile.width<=378);
  }
});

test("background access checks cannot certify saving a negotiation", () => {
  assert.equal(isTrainingSaveRequest("crm.new-deal-save","/api/chats","POST"),false);
  assert.equal(isTrainingSaveRequest("crm.new-deal-save","/api/crm/deals","GET"),false);
  assert.equal(isTrainingSaveRequest("crm.new-deal-save","/api/crm/deals","DELETE"),false);
  assert.equal(isTrainingSaveRequest("crm.new-deal-save","/api/crm/deals","POST"),true);
  assert.equal(isTrainingSaveRequest("tasks.new-save","/api/crm/deals","POST"),false);
  assert.equal(isTrainingSaveRequest("tasks.new-save","/api/crm/deals/demo:deal-1/activities","POST"),true);
});

function store(tenantId="tenant-a") { return createTrainingStore({tenantId,operatorId:"training-op",operatorName:"Operador fictício",role:"operator",permissions:{views:{chat:true,crm:true},chat:{},crm:{},contacts:{}},allowedChannels:["whatsapp"],isCommercialConsultant:false}); }
const post = body => ({method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});

test("real form API creates only in its own memory run and rejects invalid data", async () => {
  const first=store(),second=store(),foreign=store("tenant-b"),count=first.deals.length,existingIds=first.deals.map(d=>d.id);
  assert.equal((await handleTrainingRequest(first,"/api/crm/deals",post({title:""}))).status,422);
  const response=await handleTrainingRequest(first,"/api/crm/deals",post({title:"Treinamento",pipelineId:first.pipelines[0].id,stageId:first.pipelines[0].stages[0].id,tenantId:"tenant-b"}));
  assert.equal(response.status,201);const {deal}=await response.json();assert.equal(deal.tenantId,"tenant-a");
  assert.ok(!existingIds.includes(deal.id),"Creating a lesson must not overwrite an existing fixture");
  assert.equal(first.primaryDealId,existingIds[0]);
  assert.equal(first.deals.length,count+1);assert.equal(second.deals.length,count);assert.equal(foreign.deals.length,count);
  assert.equal((await handleTrainingRequest(first,"https://external.invalid/unimplemented",post({}))).status,501);
  assert.equal((await handleTrainingRequest(first,"/api/auth/logout",post({}))).status,403);
});

test("training API respects session identity and exposes real CRM response shapes", async () => {
  const memory=store(),session=await (await handleTrainingRequest(memory,"/api/auth/session?tenantId=foreign")).json();
  assert.equal(session.tenantId,"tenant-a");assert.equal(session.operator.id,"training-op");
  assert.deepEqual((await(await handleTrainingRequest(memory,"/api/crm/stage-settings")).json()).settings,[]);
  const summary=await(await handleTrainingRequest(memory,`/api/crm/pipelines/${memory.pipelines[0].id}/stages-summary`)).json();
  assert.equal(summary.stages.length,3);
  assert.ok(Array.isArray(await(await handleTrainingRequest(memory,"/api/valentina/messages")).json()));
});
