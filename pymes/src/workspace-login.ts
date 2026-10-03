import {WorkspaceClient} from './workspace-client.js';
import './workspace-login.css';
const form=document.querySelector<HTMLFormElement>('#workspace-login')!;
const url=document.querySelector<HTMLInputElement>('#workspace-login-url')!;
const tenant=document.querySelector<HTMLInputElement>('#workspace-login-tenant')!;
const token=document.querySelector<HTMLInputElement>('#workspace-login-token')!;
const status=document.querySelector<HTMLElement>('#workspace-login-status')!;
const submit=form.querySelector<HTMLButtonElement>('button')!;
const params=new URLSearchParams(location.search);
url.value=params.get('workspaceApi')??'http://127.0.0.1:8790';tenant.value=params.get('tenant')??'';
form.addEventListener('submit',async event=>{
 event.preventDefault();if(submit.disabled)return;
 submit.disabled=true;form.setAttribute('aria-busy','true');status.textContent='Comprobando acceso…';
 try {
  const baseUrl=url.value.trim(),tenantId=tenant.value.trim(),key=token.value.trim();
  const client=new WorkspaceClient({baseUrl,tenantId,token:key});
  await client.inbox();
  sessionStorage.setItem('pymes.workspace.token',key);token.value='';
  const next=new URL(location.href);next.searchParams.set('workspaceApi',baseUrl);next.searchParams.set('tenant',tenantId);next.hash='runtime-screen';
  status.textContent='Sesión verificada. Abriendo tus trabajos…';
  // A hash-only navigation does not rerun main.ts after a new token is stored.
  if(next.search===location.search){history.replaceState(null,'',next.toString());location.reload();}
  else location.assign(next.toString());
 } catch {
  token.value='';status.textContent='No se ha podido conectar. Revisa la dirección, el espacio y la clave de sesión.';
  submit.disabled=false;form.removeAttribute('aria-busy');
 }
});
