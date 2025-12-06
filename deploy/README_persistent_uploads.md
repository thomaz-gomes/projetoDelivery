Persistência de uploads (public/uploads)
=====================================

Resumo
-----
Este documento descreve a alteração para persistir arquivos que o backend grava em `public/uploads` (ex.: imagens de produtos). Sem persistência, arquivos gravados no sistema de arquivos do container são perdidos ao recriar o container.

O que foi alterado
------------------
- `docker-compose.prod.yml`: adicionado o volume Docker `backend_uploads` montado em `/app/public/uploads` no serviço `backend`.

Como aplicar (Docker Compose)
-----------------------------
1. Faça pull das imagens/atualize seu repositório no host onde roda o Compose.
2. No diretório onde está `docker-compose.prod.yml`, rode:

```bash
docker compose pull
docker compose up -d
```

Esses comandos irão criar o volume `backend_uploads` automaticamente (se ainda não existir) e montar em `/app/public/uploads` no container do backend.

Notas para EasyPanel / outros provedores
--------------------------------------
- Se você gerencia containers via EasyPanel, crie um volume/persistência no painel e monte-o no caminho do container `/app/public/uploads` para o serviço backend. A interface do EasyPanel geralmente permite mapear volumes locais ou storage persistente.
- Verifique permissões: o processo Node dentro do container precisa ter permissão de escrita no volume.

Recuperando arquivos perdidos
----------------------------
- Se arquivos foram removidos em redeploys anteriores, restaure-os a partir de backup ou reenvie as imagens pela interface administrativa (editar produto e fazer upload da imagem novamente).

Opção avançada (S3/MinIO)
-------------------------
- Para escalabilidade e redundância, considere mover uploads para um storage de objetos (S3 ou MinIO). Isso requer adaptar os handlers de upload no backend para enviar o arquivo ao storage remoto e salvar a URL no banco de dados.

Contato
-------
Se quiser, eu posso:
- Gerar um script que lista produtos cuja URL `image` aponta para `/public/uploads` e checar quais arquivos estão faltando no filesystem.
- Preparar um PR com instruções específicas do EasyPanel para montar volumes.
