import type { CapsuleManifest } from './capsule-sdk.js';
/** Export only reviewed code contracts and a declarative example; never workspace data. */
export function capsuleDevelopmentKit(manifest: CapsuleManifest, sdkSource: string, crmContracts: string): string {
  const example = { ...manifest, id: 'custom.client-summary', name: 'Mi resumen de clientes', author: 'Mi organización' };
  return `# Kit de cápsulas · Pyme_1\n\nSDK declarativo v1 · licencia MIT.\n\n` +
    `## Instrucción para Claude/Codex\n\nCrea o adapta una cápsula usando estos contratos reales. ` +
    `El host ya tiene CRM, aprobación, journal y recuperación. Conserva esas rutas. ` +
    `En esta versión puedes configurar vistas de contactos: título, límite y relación. ` +
    `Si necesitas otro renderer o una escritura, entrega primero el cambio de contrato, permisos y tests. ` +
    `No uses eval, HTML libre, fetch con tokens, SQL libre ni acceso directo al journal.\n\n` +
    `## Archivos\n\nGuarda capsule-sdk.ts y crm-contract.ts juntos para resolver el import. ` +
    `En el checkout existente ya están en pymes/src. Crea un manifest mediante defineCapsule, ` +
    `regístralo en CapsuleRegistry solo después de revisar el código y pasa los tests. ` +
    `Esta entrega no instala archivos importados desde el navegador.\n\n` +
    `### example.ts\n\n\`\`\`typescript\nimport { defineCapsule } from './capsule-sdk.js';\n` +
    `export const example = defineCapsule(${JSON.stringify(example, null, 2)});\n\`\`\`\n\n` +
    `### capsule-sdk.ts\n\n\`\`\`typescript\n${sdkSource}\n\`\`\`\n\n` +
    `### crm-contract.ts\n\n\`\`\`typescript\n${crmContracts}\n\`\`\`\n\n` +
    `## Verificación\n\nAñade tests de validación, incompatibilidad, límites, aislamiento y errores.\n\n` +
    `\`\`\`bash\nnpm test\nnpm run typecheck --workspaces --if-present\nnpm run build\ngit diff --check\n\`\`\`\n\n` +
    `Prueba con un workspace QA separado. Ninguna cápsula recibe credenciales del conector. ` +
    `Una modificación de manifest no cambia trabajos, aprobaciones ni claims ya existentes.\n`;
}
