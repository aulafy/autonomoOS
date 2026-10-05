import {appendFileSync} from 'node:fs';import {TelegramStore} from '../../src/telegram-store.js';import {TelegramService} from '../../src/telegram-service.js';import {SyntheticTelegram,SyntheticTelegramVault,syntheticTelegramToken,telegramUpdate} from './telegram-fake.js';
const [path,phase,requests]=process.argv.slice(2);if(!path||!requests||!['before','after'].includes(phase))throw new Error('QA_INVALID_ARGS');
const kill=()=>{process.kill(process.pid,'SIGKILL');};const store=new TelegramStore(path,'qa','owner',()=>1000,phase==='before'?{beforeCommit:kill}:{afterCommit:kill});
const remote=new SyntheticTelegram();remote.updates=[telegramUpdate(10)];const vault=new SyntheticTelegramVault();await vault.set(store.connection().credentialRef!,syntheticTelegramToken);
const service=new TelegramService(store,vault,async(i,o)=>{if(String(i).endsWith('/getUpdates'))appendFileSync(requests,JSON.stringify(JSON.parse(String(o!.body)))+'\n');return remote.fetcher(i,o);},()=>1000);
await service.sync();throw new Error('QA_CRASH_HOOK_NOT_REACHED');
