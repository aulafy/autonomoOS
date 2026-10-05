import type {TelegramMessage,TelegramPage,TelegramStatus} from './telegram-contract.js';
export function telegramSelection(status:TelegramStatus,page:TelegramPage,selected:number|null):TelegramMessage|null{
 if(status.tenantId!==page.tenantId||status.ownerId!==page.ownerId||status.revision!==page.connectionRevision||status.bot?.id!==page.botId)return null;
 return page.items.find(m=>m.updateId===selected&&status.allowedChatIds.includes(m.chatId))??null;
}
export const telegramProblemText:Record<string,string>={
 TELEGRAM_AUTH_REQUIRED:'Telegram ha rechazado la credencial. Revisa la conexión del bot.',
 TELEGRAM_CREDENTIAL_UNAVAILABLE:'No se puede acceder a la credencial guardada en el llavero.',
 TELEGRAM_NETWORK_ERROR:'No se pudo contactar con Telegram. La recepción se reintentará.',
 TELEGRAM_INVALID_RESPONSE:'La respuesta de Telegram no pudo validarse. El lote no se guardó.',
 TELEGRAM_RATE_LIMIT:'Telegram ha limitado las peticiones. Esperaremos antes de volver a recibir.',
 TELEGRAM_WEBHOOK_ACTIVE:'El bot ya usa un webhook. Esta instalación no lo sustituirá.',
 TELEGRAM_POLL_CONFLICT:'Otro receptor está usando este bot. Usa un bot dedicado a esta instalación.',
 TELEGRAM_UPDATE_CONFLICT:'Una actualización contradice la evidencia guardada. La recepción requiere revisión.'
};
