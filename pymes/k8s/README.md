# PYMES Workspace en Kubernetes

1. Construye y publica la imagen indicada en `deployment.yaml`.
2. Crea el Secret desde tu gestor de secretos (el archivo `secret.example.yaml`
   solo sirve como referencia):

   ```bash
   kubectl create secret generic pymes-workspace-secrets \
     --from-literal=bootstrap-token="$PYMES_API_BOOTSTRAP_TOKEN" \
     --from-literal=tenant="$PYMES_API_BOOTSTRAP_TENANT" \
     --namespace="$NAMESPACE"
   ```

   Si vas a activar OpenClaw Enterprise, añade las claves al mismo Secret:

   ```bash
   kubectl create secret generic pymes-workspace-secrets \
     --from-literal=bootstrap-token="$PYMES_API_BOOTSTRAP_TOKEN" \
     --from-literal=tenant="$PYMES_API_BOOTSTRAP_TENANT" \
     --from-literal=openclaw-ingress-token="$PYMES_OPENCLAW_INGRESS_TOKEN" \
     --from-literal=openclaw-signing-secret="$PYMES_OPENCLAW_SIGNING_SECRET" \
     --namespace="$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
   ```

3. Ajusta la imagen y `cors-origins` en `deployment.yaml` o en un overlay.
4. Aplica la base:

   ```bash
   kubectl apply -k pymes/k8s
   kubectl rollout status deployment/pymes-workspace
   ```

Las claves `openclaw-ingress-token` y `openclaw-signing-secret` son opcionales.
Añádelas al Secret para activar el ingress firmado; si no existen, el servicio
arranca con el ingress desactivado.

`network-policy.example.yaml` es opcional. Si el cluster aplica NetworkPolicy,
etiqueta el namespace de la interfaz o gateway con `pymes-client=true` antes de
activarla. Permite DNS y HTTPS saliente para conectores, y bloquea el resto del
tráfico por defecto.
