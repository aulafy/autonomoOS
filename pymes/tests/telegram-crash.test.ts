import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {TelegramStore} from '../src/telegram-store.js';import {TelegramService} from '../src/telegram-service.js';import {SyntheticTelegram,SyntheticTelegramVault,syntheticTelegramToken,telegramUpdate} from './fixtures/telegram-fake.js';
for(const phase of ['before','after'])test(`Telegram SIGKILL ${phase} batch commit preserves cursor, resumes once and never sends`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'telegram-crash-')),path=join(dir,'inbox.db'),requests=join(dir,'requests');let store=new TelegramStore(path,'qa','owner',()=>1000);
 try{
  store.configure({commandId:'seed',expectedRevision:0},'synthetic-input-digest',{enabled:true,bot:{id:'123456789',name:'QA',username:'autonomo_qa_bot'},allowedChatIds:['13201'],credentialRef:'a'.repeat(64)});store.close();
  const child=spawn(process.execPath,['--import','tsx','tests/fixtures/telegram-crash.ts',path,phase,requests],{cwd:process.cwd(),stdio:'pipe'});let output='';child.stderr.on('data',b=>output+=b);let timeout=false;const timer=setTimeout(()=>{timeout=true;child.kill('SIGKILL');},10000);
  const signal=await new Promise<NodeJS.Signals|null>((resolve,reject)=>{child.on('error',reject);child.on('exit',(_c,s)=>resolve(s));});clearTimeout(timer);assert.equal(timeout,false,output);assert.equal(signal,'SIGKILL',output);
  assert.equal(JSON.parse(readFileSync(requests,'utf8').trim()).offset,undefined);
  // Lease from the dead process expires after 90s. Controlled clock avoids wall-clock sleeps.
  store=new TelegramStore(path,'qa','owner',()=>200000);assert.equal(store.offset('123456789'),phase==='before'?null:11);assert.equal(store.status().messageCount,phase==='before'?0:1);
  const vault=new SyntheticTelegramVault();await vault.set('a'.repeat(64),syntheticTelegramToken);const remote=new SyntheticTelegram();remote.updates=[telegramUpdate(10)];const service=new TelegramService(store,vault,remote.fetcher,()=>200000);
  await service.sync();assert.equal(remote.calls.find(c=>c.method==='getUpdates')!.body.offset,phase==='before'?undefined:11);assert.equal(store.status().messageCount,1);assert.equal(store.offset('123456789'),11);
  await service.sync();assert.equal(store.status().messageCount,1);assert.equal(store.page('',20,null).revision,1);assert(remote.calls.every(c=>['getMe','getWebhookInfo','getUpdates'].includes(c.method)));assert.equal(store.history().length,1);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
