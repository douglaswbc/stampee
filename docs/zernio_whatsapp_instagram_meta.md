# Base técnica para a fase 4: Zernio, WhatsApp, Instagram e templates Meta

Este guia foi originalmente escrito para outro sistema (`painel-sga`). Os exemplos de arquivos, migrations e integrações já existentes naquele sistema **não existem no Stampfy** e não devem ser tratados como código disponível. Os requisitos de API, segurança e comportamento da Zernio/Meta servem como referência para esta implementação.

## 1. Stampfy: arquitetura e estado real

O Stampfy usa React + Vite + TypeScript, Supabase Auth/Postgres e funções serverless Vercel em `api/*.ts`. O tenant é o perfil owner (`profiles.id`); usuários staff atuam sob `owner_id`, mas só o proprietário configura integrações. Este repositório não usa Supabase Edge Functions e ainda não tinha integração Zernio.

Toda chamada à Zernio deve passar por uma função server-side Vercel. A UI envia a sessão Supabase; o servidor valida o token com Supabase Auth, confirma `profiles.role = 'owner'` e `profiles.access = 'active'`, e só então lê/atualiza a integração daquele proprietário. A chave Zernio é cifrada no servidor com AES-GCM usando `ZERNIO_ENCRYPTION_KEY`; a chave descriptografada nunca é devolvida à UI nem registrada em logs.

Persistência protegida deve usar uma migration incremental em `supabase/legacy-patches/` e o mesmo schema em `supabase/migration.sql`. Tabelas de integração, consentimentos, templates locais e entregas não recebem grants diretos ao navegador. O backend Vercel pode usar `SUPABASE_SERVICE_ROLE_KEY` somente após validar a sessão e o tenant.

O primeiro escopo aprovado para a fase 4 é conectar canais oficiais e preparar notificações de fidelidade com consentimento, templates WhatsApp aprovados, outbox idempotente e histórico de tentativas. Instagram começa por conexão de conta profissional; não automatizar DMs, comentários nem publicação até o produto definir o fluxo e as permissões.

## 2. Conceitos e limites dos canais

### WhatsApp

Conecta-se uma conta WhatsApp Business (WABA) pelo fluxo OAuth da Zernio/Meta. Uma conversa iniciada pela empresa exige um template aprovado. Os templates são vinculados à conta e cada par `nome + idioma` é uma variante distinta. Esta primeira implementação envia somente templates aprovados sem variáveis; o CRUD para criar/editar/excluir templates continua pendente.

### Instagram

Conecta-se uma conta profissional Instagram (Business ou Creator); contas pessoais não servem para publicação pela API. Zernio oferece login direto do Instagram (`instagram_login`, padrão) ou via Facebook (`facebook_login`, exige uma Página vinculada e etapa de seleção). A implementação atual conecta e verifica a conta, mas ainda não automatiza DMs, publicação, insights ou comentários.

Templates de mensagem Meta descritos neste documento são templates do **WhatsApp**. Não existe equivalência de CRUD desses templates para o canal Instagram. Para Instagram, implementar as operações de DM/inbox e/ou publicação que o requisito funcional do produto pedir; não reutilizar os templates WhatsApp.

## 3. Fluxos Zernio previstos

Base REST: `https://zernio.com/api/v1`. Autenticação: `Authorization: Bearer <ZERNIO_API_KEY>`. No código Stampfy, as funções server-side incluem `/api/v1` na base, então usam paths como `/profiles` e `/accounts`.

### WhatsApp a conectar no Stampfy

A integração salva a chave cifrada, lista `/profiles`, inicia `/connect/whatsapp` e confirma o callback consultando `/accounts?profileId=...`. O `accountId` recebido pela URL nunca é prova de propriedade: ele precisa existir na resposta remota para o perfil salvo e ter `platform: "whatsapp"` antes de ser persistido.

### Instagram no primeiro escopo

1. Reutilizar o perfil Zernio e a chave cifrada do comércio; verificar novamente que o perfil é autorizado pela chave.
2. A função server-side inicia OAuth chamando `GET /v1/connect/instagram?profileId=...&redirect_url=...&loginMethod=instagram_login` e devolve somente `authUrl`.
3. O callback da Zernio retorna ao painel. O backend confirma que o `profileId` corresponde ao salvo, lista as contas remotas e só persiste uma conta com ID e `platform: "instagram"` correspondentes.
4. A implementação usa Instagram Login padrão. Facebook Login e a seleção de Página ficam fora do primeiro escopo.
5. Instagram só conecta e mostra o estado da conta. A desconexão remota e qualquer uso de DMs/publicação requerem uma etapa específica.

### Modelo de dados sugerido

O patch `supabase/legacy-patches/add_communications_zernio.sql` define `company_communication_integrations` por `owner_id`, com uma chave cifrada, perfil Zernio e IDs dos canais; `customer_notification_preferences` guarda consentimento e revogação; `company_notification_templates` associa um evento a uma variante de WhatsApp; `communication_notification_outbox` guarda eventos pendentes e `communication_notification_attempts` mantém o histórico durável. As tabelas não têm grants para browser roles. O backend consulta/atualiza essas tabelas com service role somente depois de validar owner ativo.

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

As mudanças de conteúdo podem voltar o template para `PENDING`. A Meta limita edição de acordo com o status e frequência; exibir a resposta/status retornado, não fingir sucesso final de aprovação. Exclusões podem resultar em `PENDING_DELETION`/período de espera conforme comportamento da Meta.

### Criar template

O editor do Stampfy cria somente mensagens de texto sem variáveis, nas categorias `UTILITY` e `MARKETING`; não cria modelos de autenticação, cabeçalhos ou botões nesta etapa. Exemplo de payload aceito pela Zernio:

```json
{
  "accountId": "<zernio_whatsapp_account_id>",
  "name": "visita_validada",
  "category": "UTILITY",
  "language": "pt_BR",
  "components": [
    {
      "type": "body",
      "text": "Sua visita foi validada. Consulte seu cartão Stampfy para acompanhar o progresso."
    }
  ]
}
```

Zernio e Meta revisam o novo modelo; a resposta `PENDING` é um estado esperado, não uma aprovação. O backend valida nome, idioma, categoria, tamanho e ausência de variáveis. Para editar, ele limita-se a variantes que tenham apenas um componente BODY textual, consulta o estado remoto e envia o idioma exato. Ao editar, o vínculo local é desativado até o refresh mostrar aprovação.

### Sincronização e estado local no Stampfy

A UI consulta os templates remotos da conta conectada e armazena somente uma associação por evento (`visit_validated`, `mission_completed`, `reward_claimed`), com idioma, status, quantidade de parâmetros e estado habilitado. O backend sempre resolve o `accountId` a partir da integração do tenant e reconfirma a variante remota antes de ativar. O envio ainda valida que o status continua `APPROVED`.

O Stampfy não mantém cópia de catálogo local: consulta o estado remoto ao atualizar a tela. O painel cria variantes simples com texto sem variáveis nas categorias `UTILITY` ou `MARKETING`, edita apenas modelos que contêm um único bloco de texto e solicita a exclusão de uma variante por `name + language`. Ao editar ou excluir, desativa imediatamente o vínculo local até a aprovação/remoção ser refletida no Meta. Templates com variáveis ainda não podem ser associados ao envio automático.

Status relevantes: `PENDING`, `APPROVED`, `REJECTED`, `IN_APPEAL`, `PAUSED`, `DISABLED`, `PENDING_DELETION`. Só `APPROVED` pode ser enviado. Ao rejeitar, mostrar o motivo da Meta (`reason` / `rejection_reason`) e permitir criar uma versão corrigida. Ao editar, avisar que o conteúdo volta à análise.

### Estado atual no Stampfy e trabalho restante

O painel em `/settings?tab=communications` conecta canais, lista variantes WhatsApp, permite associar templates aprovados sem variáveis aos três eventos e oferece o CRUD descrito acima. Alterações remotas são limitadas a uma variante exata por `name + language`; a UI confirma exclusões e informa que edições voltam para análise da Meta. Ainda falta validar o fluxo com credenciais e modelos reais.

## 5. Segurança, erros e consistência

- Segredos Zernio e `SUPABASE_SERVICE_ROLE_KEY` somente em variáveis server-only do Vercel (`ZERNIO_ENCRYPTION_KEY` e `SUPABASE_SERVICE_ROLE_KEY`). Nunca usar `VITE_*`, SQL versionado, logs ou respostas ao browser.
- Usar timeout, tratar falhas de rede, JSON não esperado, `401/403`, `404`, `409` (idioma ambíguo), `429` e `5xx`; propagar uma mensagem útil sem vazar resposta com credenciais.
- Para ações de escrita, considerar falha parcial: remoto pode ter sido criado/alterado e o upsert local falhar. Responder claramente que a operação remota aconteceu e orientar sincronização; não repetir cegamente uma ação não idempotente.
- Isolar todos os dados por `owner_id` e `account_id`. Restringir acesso direto às tabelas via RLS/grants; o service role só pode ser usado depois de validar o proprietário autenticado.
- Normalizar estado de webhook/status sem substituir nome+idioma por nome apenas. Usar o ID Meta para correspondência exata quando disponível.
- Operações desconectar/excluir devem atualizar sistema remoto e local de modo consistente e reportar o lado que falhou.
- A chave de `ZERNIO_ENCRYPTION_KEY` deve permanecer estável enquanto houver credenciais cifradas. Uma rotação exige recriptografar as chaves armazenadas antes de trocar a variável.

## 6. Sequência de implementação recomendada para a próxima IA

1. [x] Criar o schema incremental do tenant, consentimento revogável, variantes associadas a eventos e outbox com tentativas.
2. [x] Implementar na Vercel a chave cifrada, seleção de perfil, conexão de WhatsApp/Instagram e callback com validação remota.
3. [x] Adicionar configurações em `/settings`, somente ao owner, com associação de templates aprovados sem variáveis.
4. [x] Registrar opt-in explícito e permitir revogação pelo cartão público; telefone sozinho não significa consentimento.
5. [x] Enfileirar eventos verificados de visita, missão e solicitação de recompensa; o worker reconfirma consentimento e aprovação antes do envio.
6. [x] Persistir tentativas, retries limitados, chave de idempotência e reprocessamento owner-only.
7. [x] Manter Instagram limitado à conexão, sem DMs nem automações privadas.
8. [~] Aplicar `add_communications_zernio.sql`, configurar variáveis Vercel e agendar o worker; validar manualmente com conta e templates aprovados.
9. [x] Implementar CRUD remoto de templates Meta para modelos simples, identificados por nome e idioma, e exigir aprovação antes de permitir sua ativação.

### Implantação do worker

O endpoint server-side é `/api/zernio-worker` e exige `COMMUNICATIONS_CRON_SECRET` (ou `CRON_SECRET`) com ao menos 16 caracteres. A função lê a outbox, verifica consentimento e template atual, envia usando `Idempotency-Key` estável e registra o resultado. O projeto ainda não agenda essa rota em `vercel.json`: no plano Hobby da Vercel, cron só pode executar uma vez ao dia; notificações de fidelidade precisam de execução frequente. Configure um cron em plano compatível ou um scheduler externo antes de habilitar envios em produção.

Variáveis server-only necessárias: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ZERNIO_ENCRYPTION_KEY` e `COMMUNICATIONS_CRON_SECRET`/`CRON_SECRET`. Nunca use prefixo `VITE_` para secrets. Para o callback OAuth, configure `APP_ORIGIN` como a origem canônica do app.

O servidor Vite padrão (`npm run dev`) não executa as funções `api/*.ts`; use `npm run dev:vercel` para exercitar localmente a integração e os callbacks. Não coloque `SUPABASE_SERVICE_ROLE_KEY`, `ZERNIO_ENCRYPTION_KEY` ou o segredo do worker em variáveis `VITE_*`.

## 7. Referências atuais

- [Zernio — WhatsApp: templates](https://docs.zernio.com/platforms/whatsapp/templates)
- [Zernio — API: listar templates](https://docs.zernio.com/whatsapp/get-whatsapp-templates) (a página de referência contém links para criar, obter, atualizar e excluir)
- [Zernio — API: WhatsApp](https://docs.zernio.com/platforms/whatsapp)
- [Zernio — conexão do WhatsApp Business](https://docs.zernio.com/platforms/whatsapp/connection)
- [Zernio — conexão de contas](https://docs.zernio.com/guides/connecting-accounts)
- [Zernio — Instagram](https://docs.zernio.com/platforms/instagram)
- [Zernio — webhooks WhatsApp](https://docs.zernio.com/webhooks/whatsapp)

Os endpoints Zernio e regras de Meta podem mudar. Conferir a referência vinculada antes de implementar, principalmente assinatura dos endpoints de update/delete e semântica de exclusão.
