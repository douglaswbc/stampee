# Stampfy Web Push e PWA

## O que foi implementado

- Manifesto e ícone instalável, service worker com atualização imediata e fallback offline genérico.
- Ícones PNG de 180, 192 e 512 px podem ser regenerados com `node scripts/generate-pwa-icons.mjs`.
- A tela offline não armazena nem confirma visitas, carimbos, missões ou resgates. O service worker não grava respostas de API nem rotas com dados do cliente.
- O cartão público permite pedir notificações após um clique explícito. O endpoint do dispositivo é ligado ao cartão específico e sua preferência de fidelidade é registrada por comércio com origem, versão, data e revogação. Eventos sem uma associação verificável àquele cartão não entram na fila push.
- O cliente pode desligar as notificações pelo cartão público ou na área `/account`. A preferência do canal push é separada do WhatsApp.
- Os eventos transacionais usam uma fila push própria, independente da fila do WhatsApp. A fila revalida o consentimento antes de enviar e remove chaves de inscrições expiradas.

## Preparar o banco

Aplicar primeiro `supabase/legacy-patches/add_customer_portal.sql` e `supabase/legacy-patches/add_communications_zernio.sql` caso ainda não estejam aplicados. Depois aplicar `supabase/legacy-patches/add_customer_web_push.sql`. O arquivo `supabase/migration.sql` também contém a versão consolidada dessas alterações.

As migrations são aditivas. Este repositório não as aplica automaticamente no Supabase.

Como o cliente pode participar sem fornecer contato ou criar uma conta, o link privado do cartão é a autorização para associar o dispositivo àquele cartão. O cliente deve ativar push somente no link que recebeu do comércio; o token push nunca é usado como identidade.

## Criar chaves VAPID

Executar uma vez em uma máquina confiável:

```sh
node scripts/generate-vapid-keys.mjs
```

Copiar as quatro linhas geradas para as variáveis correspondentes. Não publicar nem compartilhar `WEB_PUSH_PRIVATE_KEY`.
Mantenha o par estável: trocar as chaves pode exigir que cada dispositivo renove a própria inscrição.

| Variável | Destino | Uso |
| --- | --- | --- |
| `VITE_WEB_PUSH_PUBLIC_KEY` | build local e ambiente de build na Vercel | Chave pública usada pelo navegador |
| `WEB_PUSH_PUBLIC_KEY` | servidor na Vercel e `dev:vercel` | Assinatura VAPID do servidor |
| `WEB_PUSH_PRIVATE_KEY` | somente servidor na Vercel e `dev:vercel` | Assinatura VAPID privada |
| `WEB_PUSH_SUBJECT` | servidor | Contato VAPID, normalmente `mailto:` |
| `PUSH_CRON_SECRET` ou `CRON_SECRET` | servidor | Autoriza o worker |
| `SUPABASE_URL` | servidor | Endpoint Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | somente servidor | Claim e atualização da fila privada |

Depois de configurar a chave pública, gerar novamente o build/deploy do frontend. A chave privada nunca deve ter prefixo `VITE_`.

## Agendar o worker

O endpoint é `GET /api/customer-push-worker`. O agendador deve enviar `Authorization: Bearer <secret>`. Use `CRON_SECRET` para que a Vercel inclua o cabeçalho automaticamente; um agendador externo também pode usar `PUSH_CRON_SECRET` ou reaproveitar `COMMUNICATIONS_CRON_SECRET`. O worker processa lotes idempotentes e pode ser invocado mais de uma vez.

O repositório não fixa uma frequência no `vercel.json`, pois o intervalo permitido depende do plano da Vercel. Na data desta implementação, o plano Hobby aceita no máximo uma execução diária e com precisão de hora; notificações transacionais próximas do evento exigem um plano/agendador que execute com frequência maior. Escolha uma frequência compatível antes de habilitar em produção.

Localmente, configurar `.env` com as variáveis acima e usar `npm run dev:vercel`, que encaminha os segredos ao runtime das funções locais sem expô-los ao bundle do browser.

## Fluxos para validar antes de ativar

1. Abrir o link público de um cartão em HTTPS e ativar notificações pelo botão; a permissão não deve aparecer ao entrar na página.
2. Repetir em um navegador incompatível, com permissão negada, em `localhost`, e no iPhone/iPad fora da Tela de Início. A consulta do cartão continua funcionando nesses cenários.
3. Conferir que uma inscrição não permite consultar dados do cliente e que o endpoint/chaves não aparecem em RPCs públicas ou consultas do navegador.
4. Confirmar que desativar push interrompe somente o push daquele comércio; o WhatsApp e outros comércios permanecem inalterados.
5. Enfileirar uma visita, missão e recompensa, invocar o worker e conferir a abertura do cartão correto ao tocar na notificação.
6. Revogar o consentimento antes do envio e conferir que o worker marca a entrega como ignorada. Simular endpoint inválido/expirado e confirmar que não bloqueia a fila de WhatsApp.
7. Testar instalação/atualização e fallback offline em Android/Chrome, desktop e iOS/iPadOS com o web app na Tela de Início.
