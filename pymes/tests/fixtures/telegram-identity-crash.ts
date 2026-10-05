import {readFileSync} from 'node:fs';import {openWorkspaceRuntime} from '../../src/runtime-source.js';import {TelegramStore} from '../../src/telegram-store.js';import {TelegramService} from '../../src/telegram-service.js';import {SyntheticTelegram,SyntheticTelegramVault} from './telegram-fake.js';
const [dir,phase]=process.argv.slice(2);if(!dir||!['before','inside','after'].includes(phase))throw new Error('QA_INVALID_ARGS');
const kill=()=>{process.kill(process.pid,'SIGKILL');};const telegram=new TelegramService(new TelegramStore(dir+'/telegram.db','qa','owner'),new SyntheticTelegramVault(),new SyntheticTelegram().fetcher);
const runtime=await openWorkspaceRuntime(dir+'/runtime.db','qa',{telegram,telegramIdentityHooks:phase==='before'?{beforePersist:kill}:phase==='inside'?{afterTransition:kill}:{afterPersist:kill}});
runtime.source.telegramIdentities!.command('qa','owner',JSON.parse(readFileSync(dir+'/identity-command.json','utf8')),()=>true);throw new Error('QA_CRASH_NOT_REACHED');
