import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {openWorkspaceRuntime} from '../../src/runtime-source.js';import {TelegramStore} from '../../src/telegram-store.js';import {TelegramService} from '../../src/telegram-service.js';
import {WorkspaceApi,InMemoryWorkspaceRepository} from '../../src/workspace-api.js';import {WorkspaceClient} from '../../src/workspace-client.js';import {handlePymesRequest} from '../../src/api-server.js';
import type {TelegramIdentityCommand} from '../../src/telegram-identity-contract.js';
import {SyntheticTelegram,SyntheticTelegramVault,syntheticTelegramToken,telegramUpdate} from './telegram-fake.js';
export async function identityFixture(hooks:{beforePersist?:()=>void;afterTransition?:()=>void;afterPersist?:()=>void}={}){
 const dir=mkdtempSync(join(tmpdir(),'telegram-identity-')),path=join(dir,'runtime.db'),store=new TelegramStore(join(dir,'telegram.db'),'qa','owner'),vault=new SyntheticTelegramVault(),remote=new SyntheticTelegram(),telegram=new TelegramService(store,vault,remote.fetcher);
 await telegram.configure({commandId:'configure',expectedRevision:0,token:syntheticTelegramToken,allowedChatIds:['13201','13202'],consent:true});
 remote.updates=[telegramUpdate(10),telegramUpdate(11,13201,'Edición',true),telegramUpdate(12,13202),telegramUpdate(13,555,'NO_CONSENT_BODY')];await telegram.sync();
 let runtime=await openWorkspaceRuntime(path,'qa',{telegram,telegramIdentityHooks:hooks});const repo=new InMemoryWorkspaceRepository();
 for(const [user,tenant,role] of [['owner','qa','owner'],['other','qa','owner'],['review','qa','reviewer'],['owner','foreign','owner']] as const)repo.addSession(`${tenant}-${user}-token-123456789`,{tenantId:tenant,userId:user,role});
 let api=new WorkspaceApi(repo,undefined,runtime.source);const client=new WorkspaceClient({baseUrl:'http://127.0.0.1',tenantId:'qa',token:'qa-owner-token-123456789'},(i,o)=>handlePymesRequest(api,new Request(String(i),o)));
 const crm=runtime.source.crm!;for(const id of ['a','b'])crm.command('qa','owner',{commandId:'contact-'+id,expectedRevision:crm.store.revision('owner'),operation:{type:'contact.create',id,name:'Cliente '+id,email:'',phone:'',notes:'',relationship:'client'}});
 const command=async(extra:Partial<TelegramIdentityCommand>={})=>{const v=await client.telegramIdentity('123456789',10);return {commandId:'verify-qa',expectedRevision:v.revision,crmRevision:v.crmRevision,connectionRevision:v.connectionRevision,botId:'123456789',updateId:10,operation:'verify' as const,contactId:'a',linkId:null,reviewed:true as const,note:'Comprobado fuera de Telegram',...extra};};
 return {dir,path,store,vault,remote,telegram,client,repo,command,get api(){return api;},get runtime(){return runtime;},async restart(withTelegram=true){runtime.close();runtime=await openWorkspaceRuntime(path,'qa',withTelegram?{telegram}:{});api=new WorkspaceApi(repo,undefined,runtime.source);},async close(){runtime.close();await telegram.close();rmSync(dir,{recursive:true,force:true});}};
}
