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

3. Ajusta la imagen y `cors-origins` en `deployment.yaml` o en un overlay.
4. Aplica la base:

   ```bash
   kubectl apply -k pymes/k8s
   kubectl rollout status deployment/pymes-workspace
   ```

Las claves `openclaw-ingress-token` y `openclaw-signing-secret` son opcionales.
Añádelas al Secret para activar el ingress firmado; si no existen, el servicio
arranca con el ingress desactivado.
