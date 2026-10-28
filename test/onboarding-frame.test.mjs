import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("saving a task retains the DTO required to render it in the operator agenda", async () => {
  const memory=store(),deal=memory.deals[0];
  const response=await handleTrainingRequest(memory,`/api/crm/deals/${deal.id}/activities`,post({title:"Retorno fictício",dueDate:new Date(Date.now()+86400000).toISOString(),assignedToOperatorId:"training-op"}));
  assert.equal(response.status,200);const {activity}=await response.json();
  const agenda=await(await handleTrainingRequest(memory,"/api/tasks")).json();
  const task=agenda.tasks.find(t=>t.id===activity.id);
  assert.equal(task.name,"Retorno fictício");assert.equal(task.deal.id,deal.id);
  assert.ok(task.client.name);assert.ok(task.client.phone);assert.ok(task.chatConversationId);
});

test("save receipts reject background, failed, duplicate, stale and disposed requests", async () => {
  const previousElement=globalThis.Element, previousObserver=globalThis.MutationObserver;
  class Control extends EventTarget {
    disabled=false; submit=true; option=false; expanded=false;
    contains(el){return el===this;}
    closest(selector){return selector.includes('button[')&&this.submit || selector.includes('[role="option"]')&&this.option ? this : null;}
    getAttribute(key){return key==="aria-expanded"&&this.expanded ? "true" : null;}
    scrollIntoView(){}
  }
  globalThis.Element=Control;
  globalThis.MutationObserver=class{observe(){}disconnect(){}};
  try {
    const control=new Control(), doc=Object.assign(new EventTarget(),{documentElement:{dataset:{trainingInstalled:"run"}},body:{}});
    let status=200,release,delay=false;
    const originalFetch=async()=> delay ? new Promise(resolve=>{release=()=>resolve(new Response("{}",{status}));}) : new Response("{}",{status});
    const win=Object.assign(new EventTarget(),{document:doc,location:{href:"https://training.invalid/chat"},fetch:originalFetch,requestAnimationFrame:fn=>{queueMicrotask(fn);return 1;},cancelAnimationFrame(){}});
    const controllerCode=load("src/lib/onboarding/frame-controller.ts",{"./frame-targets":{resolveTrainingTarget:()=>control,TRAINING_TARGETS:{"crm.new-deal-save":{event:"save"},"crm.search":{event:"input"},"crm.pipeline":{event:"change"}},PARENT_TRAINING_TARGETS:{}}});
    const receipts=[];
    controllerCode.registerTrainingSurface(win,"navigation",()=>true);
    controllerCode.registerTrainingSurface(win,"crm",()=>true);
    const bridge=controllerCode.installTrainingController(win,{runId:"run",onReceipt:(id)=>receipts.push(id),onTarget(){},onError(){}});
    const step=id=>({id,view:"crm",chapterId:"crm",surface:"crm.toolbar",mode:"I"});
    const click=(target=control)=>{const event=new Event("click");Object.defineProperty(event,"target",{value:target});doc.dispatchEvent(event);};
    await bridge.prepare(step("crm.new-deal-save"));
    await win.fetch("/api/crm/deals",{method:"POST"}); assert.equal(receipts.length,0,"A background POST is not practice");
    click();await win.fetch("/api/chats",{method:"POST"});assert.equal(receipts.length,0,"Wrong operation");
    status=422;await win.fetch("/api/crm/deals",{method:"POST"});assert.equal(receipts.length,0,"Validation failure");
    status=200;click();await Promise.all([win.fetch("/api/crm/deals",{method:"POST"}),win.fetch("/api/crm/deals",{method:"POST"})]);assert.deepEqual(receipts,["crm.new-deal-save"],"Single practice, single receipt");
    click();delay=true;const stale=win.fetch("/api/crm/deals",{method:"POST"});await bridge.prepare(step("crm.search"));release();await stale;assert.equal(receipts.length,1,"Previous step response");
    delay=false;await bridge.prepare(step("crm.pipeline"));control.submit=false;control.expanded=true;click();assert.equal(receipts.length,1,"Opening a picker is not changing it");
    const option=new Control();option.option=true;option.submit=false;click(option);assert.equal(receipts.length,2,"A portal option selection is recognized");
    control.submit=true;await bridge.prepare(step("crm.new-deal-save"));click();delay=true;const pending=win.fetch("/api/crm/deals",{method:"POST"});bridge.dispose();release();await pending;assert.equal(receipts.length,2,"No receipt after pause/unmount");assert.equal(win.fetch,originalFetch,"Child transport wrapper removed");
  } finally {globalThis.Element=previousElement;globalThis.MutationObserver=previousObserver;}
});

test("training store normalizes conversation channels and supports chat task, catalog, and connection endpoints", async () => {
  const memory = store();
  assert.ok(memory.conversations.every(c => memory.allowedChannels.includes(c.channel)), "All demo conversations must match allowedChannels");
  assert.ok(memory.conversations[0].messages.some(m => m.text.includes("[LOCAL_MEDIA:image:")));
  assert.ok(memory.conversations[0].messages.some(m => m.text.includes("[LOCAL_MEDIA:audio:")));

  const tagTaskFail = await handleTrainingRequest(memory, "/api/chats/tag-task", post({ conversationId: memory.conversations[0].id, tagName: "" }));
  assert.equal(tagTaskFail.status, 422);

  const beforeTasks = memory.tasks.length;
  const tagTaskOk = await handleTrainingRequest(memory, "/api/chats/tag-task", post({ conversationId: memory.conversations[0].id, tagName: "Enviar ficha VSF", dueDate: "2026-10-30", dueTime: "10:00", taskType: "task" }));
  assert.equal(tagTaskOk.status, 200);
  assert.equal(memory.tasks.length, beforeTasks + 1);
  assert.ok(memory.conversations[0].tags.includes("Enviar ficha VSF"));

  const catalogRes = await (await handleTrainingRequest(memory, "/api/valentina/catalog-images?tenantId=tenant-a")).json();
  assert.equal(catalogRes.items.length, 1);
  assert.equal(catalogRes.items[0].sku, "PAMQGPAU079");

  const connRes = await (await handleTrainingRequest(memory, "/api/whatsapp/connections")).json();
  assert.equal(connRes.canSwitchDuringAttendance, true);
  assert.equal(connRes.connections.length, 2);

  const resolveRes = await (await handleTrainingRequest(memory, "/api/chats/resolve?key=qualquer-chave")).json();
  assert.equal(resolveRes.conversationId, memory.conversations[0].id);
});

test("frame-bootstrap is explicitly invoked by __root.tsx and protected from production tree-shaking in package.json", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.notEqual(pkg.sideEffects, false, "package.json must not set sideEffects: false globally or Rollup will strip frame-bootstrap");
  assert.ok(
    Array.isArray(pkg.sideEffects) && pkg.sideEffects.includes("./src/lib/onboarding/frame-bootstrap.ts"),
    "package.json sideEffects must include ./src/lib/onboarding/frame-bootstrap.ts",
  );
  const rootSource = readFileSync("src/routes/__root.tsx", "utf8");
  assert.match(rootSource, /bootstrapTrainingFrameIfPresent\(\)/, "__root.tsx must explicitly invoke bootstrapTrainingFrameIfPresent()");
});

