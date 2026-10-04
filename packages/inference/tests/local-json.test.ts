import test from 'node:test';import assert from 'node:assert/strict';import {LocalJsonProvider} from '../src/local-json.js';
const input={system:'Return JSON only.',data:{body:'Synthetic message.'},schema:{type:'object'}};
function provider(chat:unknown,meta:unknown={model_info:{'general.architecture':'llama'}},kind:'ollama'|'llama.cpp'='ollama'){
 const requests:{url:string;init:RequestInit|undefined}[]=[];const p=new LocalJsonProvider({kind,model:'local-test',fetcher:async(i,o)=>{requests.push({url:String(i),init:o});return new Response(JSON.stringify(String(i).endsWith('/api/show')?meta:chat));}});return {p,requests};
}
test('local JSON provider rejects remote endpoints and checks model locality before sending context',async()=>{
 for(const url of ['https://127.0.0.1','http://example.com','http://127.0.0.1/proxy','http://user:password@127.0.0.1','http://127.0.0.1?key=secret'])assert.throws(()=>new LocalJsonProvider({baseUrl:url}),/LOCAL_JSON_ENDPOINT_REQUIRED/);
 for(const meta of [{remote_host:'https://ollama.com',model_info:{arch:'x'}},{remote_model:'cloud-model',model_info:{arch:'x'}},{model_info:{}}]){const f=provider({},meta);await assert.rejects(f.p.proposeJson(input),/LOCAL_JSON_LOCAL_MODEL_REQUIRED/);assert.equal(f.requests.length,1);assert.equal(JSON.stringify(f.requests).includes('Synthetic message'),false);}
});
test('Ollama transport sends schema, bounded options, no tools, and validates whole JSON',async()=>{
 const f=provider({done:true,message:{content:'{"summary":"synthetic"}'}});assert.deepEqual((await f.p.proposeJson(input)).value,{summary:'synthetic'});assert.equal(f.requests.length,2);
 const body=JSON.parse(String(f.requests[1]!.init!.body));assert.equal(body.stream,false);assert.equal(body.think,false);assert.equal(body.options.num_predict,1400);assert.deepEqual(body.format,input.schema);assert.equal(body.tools,undefined);assert.equal(f.requests[1]!.init!.redirect,'error');
});
test('unexpected tools, remote completion, unfinished output, invalid JSON and overlong response fail',async()=>{
 for(const chat of [{done:true,remote_host:'https://elsewhere',message:{content:'{}'}},{done:false,message:{content:'{}'}},{done:true,message:{content:'{}',tool_calls:[{}]}},{done:true,message:{content:'```json\n{}\n```'}},{done:true,message:{content:'x'.repeat(70000)}}]){await assert.rejects(provider(chat).p.proposeJson(input),/LOCAL_JSON_/);}
});
test('llama.cpp transport uses structured output in the shared inference package',async()=>{
 const f=provider({choices:[{message:{content:'{"ok":true}'}}]},undefined,'llama.cpp');assert.deepEqual((await f.p.proposeJson(input)).value,{ok:true});assert.equal(f.requests.length,1);assert.ok(f.requests[0]!.url.endsWith('/v1/chat/completions'));const body=JSON.parse(String(f.requests[0]!.init!.body));assert.equal(body.response_format.type,'json_schema');assert.equal(body.max_tokens,1400);
});
