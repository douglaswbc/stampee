# Guia de integração: Zernio, WhatsApp, Instagram e templates Meta

Este documento orienta uma IA ou pessoa desenvolvedora a estender o `painel-sga` para trabalhar com WhatsApp e Instagram pela Zernio e a completar o CRUD dos templates de WhatsApp da Meta.

## 1. Resumo do sistema atual

O projeto usa React + Vite no frontend e Supabase (Auth, Postgres e Edge Functions) no backend. A chamada à Zernio deve acontecer em Edge Functions, nunca diretamente do navegador.

Já há uma integração de WhatsApp em funcionamento no repositório:

- `src/components/ZernioIntegrationCard.jsx`: tela de conexão do WhatsApp.
- `src/pages/ZernioCallback.jsx`: retorno do onboarding WhatsApp.
- `supabase/functions/zernio-integration/index.ts`: valida a chave Zernio e lista perfis/canais WhatsApp.
- `supabase/functions/zernio-onboarding/index.ts`: cria e completa o onboarding Embedded Signup do WhatsApp; mantém estado de callback com hash, expiração e uso único.
- `supabase/functions/zernio-whatsapp/index.ts`: lista e cria templates, envia mensagens, agenda cobranças e controla usos/sequências de templates.
- `src/components/ZernioTemplatesCard.jsx`: interface atual dos templates Meta.
- `supabase/migrations/004_zernio_integration.sql`, `005_zernio_onboarding.sql`, `006_zernio_templates_and_deliveries.sql` e migrations Zernio posteriores: persistência e auditoria da integração.

A conexão e o banco atuais são orientados a um canal WhatsApp por locador: `zernio_integracoes.whatsapp_account_id`. A listagem de contas filtra `platform === 'whatsapp'`. Não há fluxo nem campos de conta Instagram no sistema atual. Instagram requer implementação adicional, não apenas adicionar outra opção nessa lista.

As Edge Functions autenticam o usuário com Supabase Auth, validam que ele é um locador ativo e usam a `service_role` para persistência protegida. A chave Zernio é cifrada no servidor com AES-GCM usando `ZERNIO_ENCRYPTION_KEY`; preserve esse padrão e nunca devolva a chave em texto claro ao frontend.

## 2. Conceitos e limites dos canais

### WhatsApp

Conecta-se uma conta WhatsApp Business (WABA) via fluxo Embedded Signup da Zernio/Meta. Mensagens fora da janela de atendimento da Meta exigem template aprovado. Os templates são vinculados ao WABA/conta e cada par `nome + idioma` é uma variante com ID Meta próprio.

### Instagram

Conecta-se uma conta profissional Instagram (Business ou Creator); contas pessoais não servem para publicação pela API. Zernio oferece login direto do Instagram (`instagram_login`, padrão) ou via Facebook (`facebook_login`, exige uma Página vinculada e etapa de seleção). Para mensagens diretas, a autorização precisa incluir o escopo de messaging; permissões solicitadas dependem do que o SGA vai usar (mensagens, publicação, insights, comentários).

Templates de mensagem Meta descritos neste documento são templates do **WhatsApp**. Não existe equivalência de CRUD desses templates para o canal Instagram. Para Instagram, implementar as operações de DM/inbox e/ou publicação que o requisito funcional do produto pedir; não reutilizar os templates WhatsApp.

## 3. Fluxos Zernio previstos

Base REST: `https://zernio.com/api/v1`. Autenticação: `Authorization: Bearer <ZERNIO_API_KEY>`. Na implementação existente, `ZERNIO_API` já inclui `/api/v1`, então passar paths sem `/v1`, como `/accounts`.

### WhatsApp existente

O painel salva uma chave Zernio, consulta `/profiles` e `/accounts?profileId=...`, permite selecionar perfil/canal e depois oferece onboarding via `/connect/whatsapp`. O callback encaminha os parâmetros para a Edge Function, que confirma perfil, plataforma e conta antes de persistir. Preserve a validação do state, sessão de uso único, autorização por locador e verificações de canal remoto.

### Instagram a implementar

1. Reutilizar o perfil Zernio e a chave cifrada do locador; verificar novamente que o perfil é autorizado pela chave.
2. Criar uma ação backend para iniciar OAuth chamando `GET /v1/connect/instagram?profileId=...&redirect_url=...` (adicionar `loginMethod=instagram_login` ou `facebook_login` conforme a decisão do produto). Devolver somente `authUrl` para a UI redirecionar o navegador.
3. Usar callback próprio ou extensão segura da rota existente. Validar state/correlação no servidor, não confiar em um `accountId` recebido do browser sem confirmá-lo via `/accounts` e o perfil.
4. Com `instagram_login`, o OAuth normalmente retorna com a conta conectada. Com `facebook_login`, prever seleção da Página/conta Instagram vinculada; Zernio tem modo hosted e modo headless. Preferir hosted se não houver necessidade de UI própria.
5. Listar e confirmar que a conta remota tem `platform: "instagram"`; salvar o ID, nome/username e método de login. A desconexão deve remover a conta Zernio e limpar os campos locais com tratamento de falha parcial.
6. Para DMs, usar endpoints de inbox da Zernio e solicitar o escopo de messaging no fluxo de conexão. Para publicar, use `/v1/posts` com `platform: "instagram"` e mídia; posts só de texto não são suportados.

### Modelo de dados sugerido

Avalie migrations aditivas, sem renomear ou quebrar campos de WhatsApp existentes:

- Adicionar à `zernio_integracoes` os campos do canal Instagram necessários, por exemplo `instagram_account_id`, nome/username e `instagram_login_method`.
- Um único `zernio_profile_id` pode continuar compartilhado pelos dois canais se o produto permitir; caso se torne possível conectar WhatsApp e Instagram em perfis distintos, separar o profile ID por canal.
- Atualizar consultas, status público e operações `status`, `refresh`, `disconnect` para os dois canais. Validar conta pelo usuário autenticado e confirmar via API Zernio a cada operação relevante.
- Manter `zernio_whatsapp_templates` como tabela exclusiva de WhatsApp.

## 4. CRUD de templates Meta (WhatsApp)

### Endpoints Zernio

Os paths abaixo são relativos à base `/v1`:

| Operação | Endpoint | Observação |
| --- | --- | --- |
| Listar/sincronizar | `GET /whatsapp/templates?accountId={id}` | Retorna cada idioma separadamente; pode filtrar por `name`, `language`, `status`. |
| Criar | `POST /whatsapp/templates` | Envia à Meta para revisão; resposta `PENDING` não é erro. |
| Consultar por nome | `GET /whatsapp/templates/{name}?accountId={id}&language={lang}` | Se omitir idioma e houver variantes, pode haver conflito de template ambíguo. |
| Atualizar conteúdo | `PATCH /whatsapp/templates/{name}` | Body deve conter `accountId`, `language` e `components`; reenvia para revisão. |
| Consultar por ID Meta | `GET /whatsapp/templates/id/{metaTemplateId}?accountId={id}` | Útil para identificar a variante exata. |
| Atualizar por ID | `PATCH /whatsapp/templates/id/{metaTemplateId}` | Preferível quando a UI já selecionou a variante pelo ID. |
| Excluir por nome | `DELETE /whatsapp/templates/{name}` | Inclua `accountId` e `language` para excluir só uma variante; sem idioma pode excluir todos os idiomas do nome. |
| Excluir por ID | `DELETE /whatsapp/templates/id/{metaTemplateId}?accountId={id}` | Preferível para ação destrutiva em uma variante específica. |

As mudanças de conteúdo podem voltar o template para `PENDING`. A Meta limita edição de acordo com o status e frequência; exibir a resposta/status retornado, não fingir sucesso final de aprovação. Exclusões podem resultar em `PENDING_DELETION`/período de espera conforme comportamento da Meta. Confirme a semântica atual na referência Zernio antes de codificar.

### Criar template

Formato simplificado típico (texto livre enviado à revisão):

```json
{
  "accountId": "<zernio_whatsapp_account_id>",
  "name": "lembrete_vencimento",
  "category": "UTILITY",
  "language": "pt_BR",
  "components": [
    {
      "type": "BODY",
      "text": "Olá {{1}}, sua cobrança de {{2}} vence em {{3}}.",
      "example": { "body_text": [["Ana", "R$ 250,00", "10/10/2026"]] }
    }
  ]
}
```

Categorias válidas: `UTILITY`, `MARKETING`, `AUTHENTICATION`. `components` pode conter cabeçalho, corpo, rodapé e botões seguindo as estruturas aceitas pela Meta. Validar nomes/idioma/categoria e estrutura no backend; validar cada botão e URL dinâmica como já feito na ação `create_template` em `zernio-whatsapp`.

### Sincronização e estado local

`syncTemplates()` já consulta a Zernio e faz upsert em `zernio_whatsapp_templates`, preservando `purpose`, `variable_mapping` e configurações locais por nome+idioma. Use-a após criar, atualizar e excluir. Cuidado: hoje a sincronização faz upsert, mas não remove registros locais ausentes no remoto. Ao implementar delete, remova/arquive localmente apenas o registro correspondente depois da confirmação remota, sem apagar usos/auditoria relacionados inadvertidamente.

Campos locais existentes incluem `meta_template_id`, `name`, `language`, `category`, `status`, `rejection_reason`, `components`, `variable_mapping`, `purpose`, `is_default` e `last_synced_at`. Respeite a restrição única `(id_usuario, account_id, name, language)` e chaves RLS/grants existentes; operações privilegiadas ficam no backend.

Status relevantes: `PENDING`, `APPROVED`, `REJECTED`, `IN_APPEAL`, `PAUSED`, `DISABLED`, `PENDING_DELETION`. Só `APPROVED` pode ser usado para enviar ou associar a cobrança/lembrete. Ao rejeitar, mostrar motivo da Meta (`reason` / `rejection_reason`) e permitir criar uma versão corrigida. Ao editar, avisar que o conteúdo volta à análise.

### Estado atual do CRUD SGA e trabalho faltante

Em `supabase/functions/zernio-whatsapp/index.ts` já existem ações `list` e `create_template`, além de `set_default` e `save_charge_order`. A UI em `ZernioTemplatesCard.jsx` cria e organiza o uso de templates. **Não foram encontradas ações de atualizar ou excluir template remoto**. Completar essas ações no backend e controles de UI (com confirmação explícita ao apagar) para ter CRUD completo. O mapeamento `purpose` atual precisa ser mantido: migrations posteriores suportam usos de cobrança e confirmação de pagamento, então não restringir esse dado à tabela inicial.

Contrato frontend→Edge Function: manter o padrão existente `supabase.functions.invoke('zernio-whatsapp', { body: { action, ...payload } })`. As ações novas devem validar login, locador ativo, API key, conta WhatsApp atual e propriedade do template no banco antes de chamar Zernio. Não aceitar `accountId`, owner ID ou usuário arbitrário do cliente como autorização.

## 5. Segurança, erros e consistência

- Segredos Zernio e `SUPABASE_SERVICE_ROLE_KEY` só em secrets do Supabase Edge Functions. Nenhuma chave em `VITE_*`, SQL versionado, logs ou resposta ao browser.
- Usar timeout, tratar falhas de rede, JSON não esperado, `401/403`, `404`, `409` (idioma ambíguo), `429` e `5xx`; propagar uma mensagem útil sem vazar resposta com credenciais.
- Para ações de escrita, considerar falha parcial: remoto pode ter sido criado/alterado e o upsert local falhar. Responder claramente que a operação remota aconteceu e orientar sincronização; não repetir cegamente uma ação não idempotente.
- Isolar todos os dados por `id_usuario` e `account_id`. Restringir acesso direto às tabelas via RLS/grants; o service role só pode ser usado depois de validar o dono.
- Normalizar estado de webhook/status sem substituir nome+idioma por nome apenas. Usar o ID Meta para correspondência exata quando disponível.
- Operações desconectar/excluir devem atualizar sistema remoto e local de modo consistente e reportar o lado que falhou.

## 6. Sequência de implementação recomendada para a próxima IA

1. Ler `README.md`, este guia e os arquivos atuais listados na seção 1; conferir todas as migrations Zernio, não apenas a primeira migration da tabela.
2. Confirmar o requisito de Instagram: conexão + DMs, publicação, ou ambos. Se não houver outra definição, implemente conexão e estrutura de conta primeiro, sem criar fluxo fictício de template.
3. Estender integração/backend/UI de canais Instagram em migrations aditivas e preservar o fluxo WhatsApp existente.
4. Completar update/delete de template no Edge Function e UI. Atualização e exclusão devem usar idioma/ID para não atingir outras variantes por engano.
5. Sincronizar metadados após cada mudança, apresentar estados e erros da Meta, manter metadados locais usados em cobrança e auditoria.
6. Documentar secrets, URLs de callback e migrations novas. Seguir a estratégia de verificação do repositório/tarefa que solicitou a implementação.

## 7. Referências atuais

- [Zernio — WhatsApp: templates](https://docs.zernio.com/platforms/whatsapp/templates)
- [Zernio — API: listar templates](https://docs.zernio.com/whatsapp/get-whatsapp-templates) (a página de referência contém links para criar, obter, atualizar e excluir)
- [Zernio — API: WhatsApp](https://docs.zernio.com/platforms/whatsapp)
- [Zernio — conexão de contas](https://docs.zernio.com/guides/connecting-accounts)
- [Zernio — Instagram](https://docs.zernio.com/platforms/instagram)
- [Zernio — webhooks WhatsApp](https://docs.zernio.com/webhooks/whatsapp)

Os endpoints Zernio e regras de Meta podem mudar. Conferir a referência vinculada antes de implementar, principalmente assinatura dos endpoints de update/delete e semântica de exclusão.
