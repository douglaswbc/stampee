# Lembretes automáticos de campanhas

## O que está pronto no código

- O proprietário controla por empresa se os lembretes automáticos ficam ativos, quais tipos e campanhas participam, quais canais podem ser usados, a cadência, o limite semanal e o horário silencioso no fuso configurado da empresa.
- Os tipos são retorno após inatividade, progresso parado em uma missão ativa e recompensa emitida próxima do vencimento. O servidor revalida campanha, atividade, missão, resgate e consentimento antes de autorizar o envio.
- WhatsApp e push usam consentimento promocional separado das atualizações transacionais de fidelidade. O cliente pode escolher cada canal no cartão público ou na área `/account`; a empresa não pode ativar uma preferência revogada.
- Para cada lembrete é escolhido um canal. O canal preferido só é usado quando existe consentimento, destino ativo e, no WhatsApp, modelo aprovado. Se não for elegível, o servidor tenta o outro canal configurado.
- A fila é idempotente e limita envios por empresa e cliente. As configurações e registros são isolados por `owner_id`; nenhuma regra de lembrete altera carimbos, pontos ou progresso.
- As prévias de push usam dados de exemplo. O histórico do cliente mostra push aceito pelo serviço do navegador e WhatsApp aceito pelo provedor; isso não confirma que uma pessoa viu a notificação. O painel mostra aceites, falhas e itens pendentes.
- Não há envio de lembretes por e-mail enquanto um provedor de entrega não estiver configurado. Contato, conta Stampfy, instalação do PWA e push continuam opcionais para participar.

## Aplicar a migration

O patch é aditivo e pode ser repetido. Antes dele, confirme que o projeto já tem as migrations de missões, recompensas, fuso da empresa, área do cliente, WhatsApp/Zernio, push e modelos WhatsApp com variáveis. A sequência para um banco que ainda não as recebeu é:

1. `supabase/legacy-patches/add_loyalty_missions.sql`
2. `supabase/legacy-patches/add_loyalty_points.sql`
3. `supabase/legacy-patches/add_loyalty_rewards.sql`
4. `supabase/legacy-patches/add_company_time_zone.sql`
5. `supabase/legacy-patches/add_customer_portal.sql`
6. `supabase/legacy-patches/add_communications_zernio.sql`
7. `supabase/legacy-patches/add_customer_web_push.sql`
8. `supabase/legacy-patches/add_whatsapp_interactive_templates.sql`
9. `supabase/legacy-patches/add_customer_engagement_reminders.sql`

Se o banco já recebeu as migrations anteriores, aplique somente o novo patch. `supabase/migration.sql` contém a versão consolidada. O patch novo ainda precisa ser aplicado no projeto Supabase antes de usar a aba **Lembretes** em `/settings`.

## Configurar os canais e agendador

1. Configure os segredos server-side descritos em [web-push.md](web-push.md), [zernio_whatsapp_instagram_meta.md](zernio_whatsapp_instagram_meta.md) e `.env.example`, incluindo `SUPABASE_SERVICE_ROLE_KEY`, `ZERNIO_ENCRYPTION_KEY`, chaves VAPID e um segredo de cron. Eles nunca devem receber prefixo `VITE_`.
2. Em `/settings`, conecte o canal desejado. Para WhatsApp, configure em **Comunicações** um modelo aprovado para cada tipo de lembrete que será enviado; use somente as variáveis apresentadas para o evento e aguarde a aprovação da Meta.
3. Agende `GET /api/zernio-worker` e `GET /api/customer-push-worker` com `Authorization: Bearer <CRON_SECRET>`. Ambos chamam o planejador idempotente; mantenha agendado o worker de cada canal ativado para processar sua fila. Escolha um intervalo aceito pelo plano do agendador, pois ele define o atraso máximo até o próximo lote.
4. Ative primeiro um tipo e uma campanha de teste. Confirme as preferências explícitas do cliente, o canal selecionado, o horário local, o limite e a entrada no histórico antes de ampliar a configuração.

O cliente pode desligar cada canal no cartão ou em `/account`. Alterações são registradas em `customer_engagement_preference_events`. Essas preferências são removidas junto com o cadastro comercial do cliente (`owner_id`/`customer_id`); inscrições push também são vinculadas ao cartão/dispositivo e não servem como identidade global.

## Validação de produção ainda necessária

- Aplicar a migration ao projeto Supabase vinculado e confirmar as funções/constraints após o reload do schema.
- Configurar e agendar ambos os workers no ambiente de produção; verificar variáveis e resposta autenticada dos endpoints.
- Fazer um ciclo de teste por push e WhatsApp, incluindo revogação antes do envio, nova atividade, missão concluída, recompensa resgatada/expirada, campanha desativada, horário silencioso e limite de frequência.
- Testar a ativação e revogação em Android/Chrome, desktop compatível e iOS/iPadOS com o web app instalado.

O repositório não agenda jobs nem aplica migrations remotamente por conta própria.
