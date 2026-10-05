import type {CredentialVault} from '../../src/gmail-keychain.js';
export const syntheticTelegramToken='123456789:synthetic_telegram_token_for_QA_only';
export class SyntheticTelegramVault implements CredentialVault { values=new Map<string,string>();async get(r:string){return this.values.get(r)??null;}async set(r:string,v:string){this.values.set(r,v);}async delete(r:string){this.values.delete(r);} }
export function telegramUpdate(id:number,chat=13201,text='Mensaje sintético de QA',edit=false){return {update_id:id,[edit?'edited_message':'message']:{message_id:edit?10:id,chat:{id:chat,type:'private'},from:{id:chat,is_bot:false,first_name:'Cliente QA'},date:1791160000,...(edit?{edit_date:1791160010}:{}),text}};}
export class SyntheticTelegram {
 calls:Array<{method:string;body:Record<string,unknown>}>=[];updates:unknown[]=[];webhook='';identity=123456789;fail:string|null=null;
 fetcher:typeof fetch=async(input,init)=>{const url=new URL(String(input)),method=url.pathname.split('/').at(-1)!;
  if(url.origin!=='https://api.telegram.org'||!['getMe','getWebhookInfo','getUpdates'].includes(method))throw new Error('QA_UNEXPECTED_PROVIDER_CALL');
  const body=JSON.parse(String(init?.body??'{}'));this.calls.push({method,body});if(this.fail==='network')throw new Error('synthetic URL '+url.href);
  if(['401','409','429'].includes(this.fail??''))return Response.json({description:syntheticTelegramToken},{status:Number(this.fail)});
  return Response.json({ok:true,result:method==='getMe'?{id:this.identity,is_bot:true,first_name:'Autónomo QA',username:'autonomo_qa_bot'}:method==='getWebhookInfo'?{url:this.webhook}:this.updates.filter(v=>body.offset===undefined||(v as {update_id:number}).update_id>=Number(body.offset))});
 };
}
