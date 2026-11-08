import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const temporary=await mkdtemp(join(tmpdir(),'inbox-support-'));
after(()=>rm(temporary,{recursive:true,force:true}));
const output=join(temporary,'support.mjs');
await build({entryPoints:['workers/lib/support-store.ts'],bundle:true,platform:'node',format:'esm',outfile:output});
const {SupportStore}=await import(pathToFileURL(output).href);
function fixture(){
 const db=new DatabaseSync(':memory:');
 const sql={exec(query,...params){const result=db.prepare(query).all(...params);return{toArray:()=>result};}};
 const store=new SupportStore(sql);
 const input={mailboxId:'support@one.test',threadId:'thread-1',emailId:'email-1',subject:'Help with export',sender:'customer@example.test',date:'2026-11-08T12:00:00.000Z'};
 return{store,input,create:()=>store.registerInbound(input)};
}
test('intake retries keep one case and one event; new customer mail reopens a resolved case',()=>{
 const f=fixture();const first=f.create();assert.equal(f.create().id,first.id);assert.equal(f.store.getEvents(first.id).length,1);
 const resolved=f.store.updateCase(first.id,{expectedVersion:first.version,operationId:'resolve-123',status:'resolved',summary:'Export checked',nextAction:''},'agent');
 const next=f.store.registerInbound({...f.input,emailId:'email-2',date:'2026-11-08T12:05:00.000Z'});
 assert.equal(next.id,first.id);assert.equal(next.status,'pending');assert.equal(next.version,resolved.version+1);
});
test('stale claims cannot take over an already claimed case',()=>{
 const f=fixture();const item=f.create();f.store.updateCase(item.id,{expectedVersion:item.version,operationId:'claim-one',status:'processing',summary:'Checking',nextAction:''},'agent');
 assert.throws(()=>f.store.updateCase(item.id,{expectedVersion:item.version,operationId:'claim-two',status:'processing',summary:'Checking again',nextAction:''},'agent'),/SUPPORT_CONFLICT/);
});
function claimed(){const f=fixture();const item=f.create();const claim=f.store.updateCase(item.id,{expectedVersion:item.version,operationId:'claim-one',status:'processing',summary:'Checking',nextAction:''},'agent');return{...f,item:claim,request:{expectedVersion:claim.version,operationId:'reply-operation-1',claimId:'claim-one',text:'Your export is ready.',summary:'Replied with export guidance',status:'waiting_customer'}};}
test('a replayed reply operation cannot start a second send',()=>{
 const f=claimed();assert.equal(f.store.beginReply(f.item.id,f.request).replay,false);
 assert.equal(f.store.beginReply(f.item.id,f.request).replay,true);
 assert.throws(()=>f.store.beginReply(f.item.id,{...f.request,operationId:'another-send'}),/SUPPORT_CONFLICT/);
 f.store.finishReply(f.request.operationId,{providerMessageId:'provider-123'});
 assert.equal(f.store.beginReply(f.item.id,f.request).operation.state,'accepted');
 assert.equal(f.store.getCase(f.item.id).status,'waiting_customer');
});
test('unknown delivery blocks automatic retry even after a new inbound message',()=>{
 const f=claimed();f.store.beginReply(f.item.id,f.request);
 f.store.finishReply(f.request.operationId,{error:'Connection interrupted',definitive:false});
 const next=f.store.registerInbound({...f.input,emailId:'email-2',date:'2026-11-08T13:00:00.000Z'});
 assert.equal(next.delivery,'uncertain');assert.equal(next.status,'needs_owner');
 assert.throws(()=>f.store.updateCase(next.id,{expectedVersion:next.version,operationId:'claim-again',status:'processing',summary:'Retry',nextAction:''},'agent'),/不能自动重发/);
});
test('a reply completing while newer customer mail arrives leaves the new message pending',()=>{
 const f=claimed();f.store.beginReply(f.item.id,f.request);
 f.store.registerInbound({...f.input,emailId:'email-2',date:'2026-11-08T13:00:00.000Z'});
 f.store.finishReply(f.request.operationId,{providerMessageId:'provider-123'});
 assert.equal(f.store.getCase(f.item.id).status,'pending');assert.equal(f.store.getCase(f.item.id).latestEmailId,'email-2');
});
test('dashboard counts, escaped literal search, pagination and owner feedback come from persisted records',()=>{
 const f=fixture();const first=f.create();f.store.registerInbound({...f.input,threadId:'thread-2',emailId:'two',subject:'100% export'});
 assert.equal(f.store.dashboard().counts.pending,2);assert.equal(f.store.dashboard({query:'%'}).total,1);
 const page=f.store.dashboard({limit:1,page:2});assert.equal(page.cases.length,1);assert.equal(page.totalPages,2);
 const updated=f.store.ownerInstruction(first.id,first.version,'owner-comment-1','Please check the uploaded file.');
 assert.equal(updated.nextAction,'Please check the uploaded file.');assert.equal(f.store.getEvents(first.id).at(-1).actor,'operator');
});
test('run leases prevent overlap and repeated finish calls do not change a newer run',()=>{
 const f=fixture();f.store.startRun('run-one','2026-11-08T12:00:00.000Z');
 assert.throws(()=>f.store.startRun('run-two','2026-11-08T13:00:00.000Z'),/已有巡检/);
 f.store.finishRun('run-one','Finished','','2026-11-08T12:05:00.000Z');
 f.store.startRun('run-two','2026-11-08T13:00:00.000Z');
 f.store.finishRun('run-one','Replay','','2026-11-08T13:01:00.000Z');
 assert.equal(f.store.automation().runId,'run-two');
});

test('owner feedback arriving during delivery remains queued after provider acceptance',()=>{
 const f=claimed();f.store.beginReply(f.item.id,f.request);
 const sending=f.store.getCase(f.item.id);
 f.store.ownerInstruction(sending.id,sending.version,'owner-during-send','Please also check the account export.');
 f.store.finishReply(f.request.operationId,{providerMessageId:'provider-123'});
 const next=f.store.getCase(f.item.id);
 assert.equal(next.status,'pending');assert.equal(next.nextAction,'Please also check the account export.');
});

test('confirmed replies cannot be sent again through a new operation ID for the same customer message',()=>{
 const f=claimed();f.store.beginReply(f.item.id,f.request);f.store.finishReply(f.request.operationId,{providerMessageId:'provider-123'});
 let item=f.store.getCase(f.item.id);item=f.store.ownerInstruction(item.id,item.version,'owner-check-again','Check the export too.');
 item=f.store.updateCase(item.id,{expectedVersion:item.version,operationId:'claim-second',status:'processing',summary:'Checking',nextAction:''},'agent');
 assert.throws(()=>f.store.beginReply(item.id,{...f.request,expectedVersion:item.version,operationId:'reply-second',claimId:'claim-second'}),/已有发送记录/);
});
test('explicit owner reconciliation of a confirmed failed send unblocks work without sending',()=>{
 const f=claimed();f.store.beginReply(f.item.id,f.request);f.store.finishReply(f.request.operationId,{error:'Timeout',definitive:false});
 let item=f.store.getCase(f.item.id);item=f.store.reconcileReply(item.id,item.version,'owner-reconcile',{outcome:'failed',evidence:'Provider log confirms rejection before acceptance.'});
 assert.equal(item.status,'pending');assert.equal(item.delivery,'failed');
 const next=f.store.updateCase(item.id,{expectedVersion:item.version,operationId:'claim-after-review',status:'processing',summary:'Checking corrected delivery settings',nextAction:''},'agent');
 assert.equal(next.status,'processing');assert.equal(f.store.getEvents(item.id).at(-2).actor,'operator');
});
test('owner cannot reconcile an in-flight send or assert acceptance without a receipt',()=>{
 const f=claimed();f.store.beginReply(f.item.id,f.request,'2026-11-08T12:00:00.000Z');let item=f.store.getCase(f.item.id);
 assert.throws(()=>f.store.reconcileReply(item.id,item.version,'owner-too-soon',{outcome:'failed',evidence:'Nothing yet'},'2026-11-08T12:01:00.000Z'),/仍在提交/);
 f.store.finishReply(f.request.operationId,{error:'Timeout',definitive:false});item=f.store.getCase(item.id);
 assert.throws(()=>f.store.reconcileReply(item.id,item.version,'owner-no-receipt',{outcome:'accepted',evidence:'Found it'}),/接受编号/);
});

test('owner can send a deliberate follow-up while automatic duplicate replies remain blocked',()=>{
 const f=claimed();f.store.beginReply(f.item.id,f.request);f.store.finishReply(f.request.operationId,{providerMessageId:'receipt-1'});
 let item=f.store.getCase(f.item.id);
 const owner={...f.request,expectedVersion:item.version,operationId:'owner-follow-up',claimId:'owner-follow-up',text:'One more detail.'};
 const started=f.store.beginReply(item.id,owner,undefined,true);assert.equal(started.operation.actor,'operator');
 assert.throws(()=>f.store.beginReply(item.id,{...owner,operationId:'another-owner',expectedVersion:f.store.getCase(item.id).version},undefined,true),/已有发送记录/);
 f.store.finishReply(owner.operationId,{providerMessageId:'receipt-2'});
 assert.equal(f.store.getEvents(item.id).at(-1).actor,'operator');
 assert.throws(()=>f.store.beginReply(item.id,{...owner,text:'Changed'},undefined,true),/发送内容已更改/);
});
test('outgoing mail is persisted before send, replay-safe, and joined by the first real customer reply',()=>{
 const f=fixture();const request={operationId:'new-message-one',mailboxId:f.input.mailboxId,to:f.input.sender,subject:'A new conversation',text:'Hello'};
 const first=f.store.beginOutgoing(request,'2026-11-08T12:00:00.000Z');
 assert.equal(f.store.getCase(first.operation.caseId).latestInboundAt,'');
 assert.equal(f.store.getCase(first.operation.caseId).delivery,'uncertain');
 assert.equal(f.store.beginOutgoing(request).replay,true);
 assert.throws(()=>f.store.beginOutgoing({...request,to:'another@example.test'}),/发送内容已更改/);
 f.store.finishReply(request.operationId,{providerMessageId:'receipt-outgoing'},'2026-11-08T12:01:00.000Z');
 assert.equal(f.store.getCase(first.operation.caseId).status,'waiting_customer');
 assert.equal(f.store.getEvents(first.operation.caseId).at(-1).kind,'outgoing_accepted');
 const inbound=f.store.registerInbound({...f.input,threadId:request.operationId,emailId:'real-inbound',date:'2026-11-08T12:02:00.000Z'});
 assert.equal(inbound.id,first.operation.caseId);assert.equal(inbound.status,'pending');
});
test('overview counts distinct customer cases in the Shanghai day and excludes system/ignored activity',()=>{
 const f=fixture();let item=f.create();
 item=f.store.updateCase(item.id,{expectedVersion:item.version,operationId:'before-day',status:'processing',summary:'Before midnight',nextAction:''},'agent','2026-11-08T15:59:59.000Z');
 assert.equal(f.store.overview('2026-11-08T16:00:00.000Z').todayTouched,0);
 item=f.store.updateCase(item.id,{expectedVersion:item.version,operationId:'on-day',status:'needs_owner',summary:'Need an answer',nextAction:'Confirm'},'agent','2026-11-08T16:00:00.000Z');
 item=f.store.ownerInstruction(item.id,item.version,'owner-on-day','Please check further','2026-11-08T16:01:00.000Z');
 f.store.startRun('system-run','2026-11-08T16:02:00.000Z');
 assert.equal(f.store.overview('2026-11-08T17:00:00.000Z').todayTouched,1);
 item=f.store.updateCase(item.id,{expectedVersion:item.version,operationId:'ignore-case',status:'ignored',summary:'QA only',nextAction:''},'operator','2026-11-08T16:03:00.000Z');
 assert.equal(f.store.overview('2026-11-08T17:00:00.000Z').todayTouched,0);
 assert.equal(f.store.activity({period:'today',scope:'customer'},'2026-11-08T17:00:00.000Z').total,0);
 assert.equal(f.store.activity({scope:'all'}).events.some(e=>e.caseId===item.id),true);
});
test('activity pagination and waiting follow-up counts use persisted case context',()=>{
 const f=fixture();const out=f.store.beginOutgoing({operationId:'compose-waiting',mailboxId:f.input.mailboxId,to:f.input.sender,subject:'Follow up',text:'Hello'},'2026-11-07T12:00:00.000Z');
 f.store.finishReply(out.operation.id,{providerMessageId:'receipt'},'2026-11-07T12:01:00.000Z');
 const overview=f.store.overview('2026-11-08T13:00:00.000Z');assert.equal(overview.followUpCount,1);assert.equal(overview.waitingCount,1);
 const page=f.store.activity({scope:'customer',limit:1,page:2});assert.equal(page.totalPages,2);assert.equal(page.page,2);assert.equal(page.events[0].caseSubject,'Follow up');assert.equal(page.events[0].mailboxId,f.input.mailboxId);
});

test('cancellation tombstones recover orphan drafts and reject a delayed original send',()=>{
 const f=fixture();const request={operationId:'orphan-operation',mailboxId:f.input.mailboxId,to:f.input.sender,subject:'Not submitted',text:'Preserved draft'};
 const cancelled=f.store.cancelUnsubmittedOperation(request.operationId);assert.equal(cancelled.kind,'cancelled');assert.equal(f.store.getOperation(request.operationId).state,'failed');assert.equal(f.store.cancelUnsubmittedOperation(request.operationId).id,request.operationId);
 assert.throws(()=>f.store.beginOutgoing(request),/已取消/);
 const item=f.create();assert.throws(()=>f.store.beginReply(item.id,{operationId:request.operationId,expectedVersion:item.version,claimId:'owner-cancelled',text:request.text,summary:'Not sent',status:'waiting_customer'},undefined,true),/已取消/);
});
test('cancellation cannot override started, uncertain, or accepted delivery',()=>{
 for(const result of [null,{error:'Timeout',definitive:false},{providerMessageId:'receipt'}]){
  const f=fixture();const request={operationId:'active-operation',mailboxId:f.input.mailboxId,to:f.input.sender,subject:'Submitted',text:'Hello'};f.store.beginOutgoing(request);if(result)f.store.finishReply(request.operationId,result);
  assert.throws(()=>f.store.cancelUnsubmittedOperation(request.operationId),/已有投递记录/);
 }
});

test('quiet scan heartbeats are journaled once without increasing customer processing counts',()=>{
 const f=fixture();const time='2026-11-08T17:00:00.000Z';
 f.store.updateAutomation({enabled:true,lastScanAt:time,lastScanError:''});f.store.updateAutomation({lastScanAt:time,lastScanError:''});
 const events=f.store.activity({},time).events;assert.equal(events.length,1);assert.equal(events[0].kind,'scan_finished');assert.equal(events[0].actor,'system');assert.equal(f.store.overview(time).todayTouched,0);assert.equal(f.store.activity({scope:'customer'},time).total,0);
 f.store.updateAutomation({lastScanAt:'2026-11-08T18:00:00.000Z',lastScanError:'One mailbox unavailable'});assert.equal(f.store.activity().events[0].kind,'scan_failed');
 f.store.updateAutomation({lastScanAt:time,lastScanError:''});assert.equal(f.store.activity().total,2);assert.equal(f.store.automation().lastScanAt,'2026-11-08T18:00:00.000Z');assert.equal(f.store.automation().lastScanError,'One mailbox unavailable');
});
