# Plano de novas funcionalidades para o Stampfy

## Legenda dos status

- [ ] Pendente
- [~] Implementação parcial ou validação pendente
- [x] Concluído no código/repositório

## Objetivo

Ampliar o Stampfy com recursos de fidelidade inspirados nas funcionalidades divulgadas pelo Enggaja, aproveitando a base de cartões e carimbos que já existe. A implementação deve ser incremental e compatível com os dados atuais. O produto agora está sendo estruturado como SaaS multi-tenant: cada perfil owner representa um comércio e seus dados são isolados por `owner_id`. Consulte também o [plano da fundação SaaS](docs/saas-foundation.md).

Este arquivo é uma especificação para orientar o desenvolvimento. Não reproduzir marca, textos, identidade visual ou código do Enggaja.

## Estado atual do produto

O Stampfy já oferece autenticação para proprietário e equipe, campanhas de cartões, cadastro de clientes, emissão de cartões digitais, registro e remoção de carimbos, resgate de recompensa, leitura por QR Code, página pública do cartão, entrada pública em campanhas e histórico/analytics.

A tabela `transactions` registra eventos como `stamp_add`, `stamp_remove`, `redeem` e `issued`. Os cartões emitidos mantêm seu próprio total de carimbos e as campanhas definem uma recompensa e uma quantidade-alvo. As novas funcionalidades devem complementar esse fluxo, sem exigir que cartões existentes sejam convertidos ou reemitidos.

## Princípios de implementação

- Priorizar a reutilização dos carimbos, campanhas, transações e clientes existentes.
- Fazer alterações de banco por migrations aditivas e preservar os dados atuais.
- Validar regras no servidor/banco; a interface não pode ser a única proteção contra recompensa duplicada ou progresso forjado.
- Preservar autenticação, autorização e políticas RLS para proprietário e equipe.
- Disponibilizar ao cliente somente seus dados por meio de rotas públicas já protegidas ou novos endpoints seguros; nunca expor tabelas administrativas diretamente.
- Considerar o fuso horário configurado pela empresa ao calcular períodos e vencimentos.
- Manter integrações externas opcionais e sujeitas a consentimento, configuração e disponibilidade do provedor.

## Escopo por fases

### Fase 1 — Missões e desafios com carimbos (MVP) [~]

O fuso da empresa e o padrão pelo navegador estão implementados no repositório. `supabase/legacy-patches/add_company_time_zone.sql` foi aplicado ao Supabase; falta validar essa configuração na interface de produção.

Permitir que a empresa crie desafios de fidelidade associados a uma campanha, aproveitando eventos válidos de carimbo já registrados.

Tipos iniciais:

- [x] **Frequência:** atingir uma quantidade de visitas/carimbos dentro de um período, por exemplo, três visitas na semana.
- [x] **Meta de campanha:** completar uma parte ou uma volta do cartão de uma campanha específica.

Configuração da missão:

- [x] nome e descrição;
- [x] campanha relacionada, quando aplicável;
- [x] tipo de meta e quantidade necessária;
- [x] início e fim no fuso horário configurado pela empresa; o fuso do navegador é o padrão quando a empresa ainda não tem uma preferência salva;
- [x] estado ativa/inativa;
- [x] recompensa definida entre bônus de carimbo ou benefício textual resgatável pela equipe;
- [x] limite de conclusões por cliente e regra para permitir ou não repetição.

Experiência:

- [x] Proprietário cria, edita, ativa, pausa e consulta missões no painel.
- [x] Cliente vê missões ativas, progresso e conclusão na página pública do cartão.
- [x] Equipe consegue conferir a conclusão e registrar a entrega do benefício com identificação do atendente.
- [x] Analytics mostra adesões/conclusões e recompensas entregues.

Regras obrigatórias:

- [x] O progresso deriva de transações válidas criadas no servidor, não de valores enviados pelo navegador.
- [x] Definir claramente quais eventos contam: carimbos adicionados contam; remoções, emissão de cartão e resgates não contam como visita.
- [x] Uma mesma transação não pode gerar progresso mais de uma vez para a mesma missão.
- [x] A conclusão e a concessão da recompensa devem ser atômicas e idempotentes, protegidas contra chamadas simultâneas e repetidas.
- [x] Cada concessão e resgate deve deixar histórico auditável, incluindo cliente, missão, horário e usuário da equipe quando houver ação manual.
- [x] Missões encerradas não aceitam novo progresso, mas o cliente e a equipe ainda podem consultar conclusões anteriores.

### Fase 2 — Pontos, níveis e emblemas [x]

Implementação no repositório e patch no Supabase concluídos; fluxo integrado validado manualmente em produção pelo proprietário.

Adicionar uma camada de progressão geral do cliente sem alterar retroativamente o saldo de carimbos dos cartões.

- [x] Criar um ledger imutável de pontos baseado em visitas verificadas, reversões e ajustes auditáveis, com chave de idempotência.
- [x] Permitir configurar os pontos por visita; pontos por compra permanecem indisponíveis até existir um valor confiável no fluxo.
- [x] Exibir saldo, histórico e progresso até o próximo nível na página pública do cartão.
- [x] Permitir níveis configuráveis por faixas de pontos e benefícios descritivos.
- [x] Conceder emblemas por marcos verificáveis: primeira visita e conclusão de missão.
- [x] Definir a política: pontos não expiram; remover carimbo reverte os pontos correspondentes até o saldo disponível; ajustes manuais são exclusivos do proprietário, exigem motivo e não podem deixar o saldo negativo; emblemas conquistados permanecem.
- [x] Aplicar `supabase/legacy-patches/add_loyalty_points.sql`; uma consulta de leitura confirmou a tabela de ledger, a RPC pública, o trigger de pontos e a auditoria de remoção de carimbo.
- [x] Validar manualmente em produção a configuração de pontos e níveis, a pontuação após uma visita e o resumo público do cliente.

Não inferir valor gasto nem conceder pontos por compras enquanto o sistema não tiver uma fonte confiável desse valor.

### Fase 3 — Catálogo de recompensas e cupons [x]

- [x] Permitir várias recompensas globais ou vinculadas a uma campanha.
- [x] Configurar custo/mínimo de pontos, período da oferta, validade do código, estoque e limite por cliente.
- [x] Gerar códigos únicos e permitir validação de uso único pela equipe.
- [x] Registrar emissão, expiração, resgate e cancelamento em eventos auditáveis.
- [x] Impedir saldo negativo, resgates acima do estoque e reutilização de códigos; devolver pontos quando código não usado expirar ou for cancelado.
- [x] Integrar catálogo do proprietário, ofertas no cartão público e painel de validação para proprietário/equipe.
- [x] Aplicar o patch aditivo no projeto Supabase vinculado.
- [x] Validar manualmente em produção o fluxo integrado na interface e as permissões RLS após a implantação.

### Fase 4 — Comunicação e integrações [~]

A implementação inicial baseada em [docs/zernio_whatsapp_instagram_meta.md](docs/zernio_whatsapp_instagram_meta.md) está no repositório. Ainda depende da migration aditiva, secrets no Vercel, agendamento frequente do worker e validação com contas/templates reais. O Instagram fica somente conectado; DMs e publicação não são automatizados.

- [x] Preparar preferências de WhatsApp com opt-in explícito no cadastro e revogação pelo cartão público.
- [x] Conectar perfil Zernio e canais WhatsApp/Instagram por OAuth em `/settings`, com validação server-side do owner e da conta remota.
- [x] Associar templates WhatsApp aprovados, sem variáveis, aos eventos de visita validada, missão concluída e recompensa solicitada.
- [x] Registrar esses eventos em outbox idempotente; o worker revalida consentimento e aprovação antes do envio e usa chave idempotente.
- [x] Guardar tentativas/erros e permitir reprocessamento owner-only de falhas sem criar novo evento de fidelidade.
- [~] Aplicar `supabase/legacy-patches/add_communications_zernio.sql`, configurar `SUPABASE_SERVICE_ROLE_KEY`, `ZERNIO_ENCRYPTION_KEY`, `COMMUNICATIONS_CRON_SECRET`/`CRON_SECRET` e `APP_ORIGIN` no Vercel e agendar `/api/zernio-worker`. O worker ainda não foi validado com contas reais.
- [x] Criar, editar e solicitar exclusão de variantes de templates WhatsApp pelo painel; a primeira versão aceita modelos simples de texto, sem variáveis. Edição e exclusão sincronizam o estado local e desativam o envio enquanto a Meta revisa a mudança.
- [ ] Automatizar mensagens do Instagram; só iniciar após definir o caso de uso, consentimento e permissões específicas da Meta.

## Direção técnica para o banco e a segurança

Antes de implementar cada fase, conferir o schema e as políticas RLS reais em `supabase/migration.sql` e nas migrations existentes.

Para a Fase 1, modelar missões e progresso/conclusões de forma que haja restrições únicas para impedir duplicidade. É possível calcular o progresso a partir das transações ou mantê-lo materializado, desde que a atualização seja transacional e reconciliável. Se forem adicionados novos tipos a `transactions`, atualizar de modo compatível a constraint de tipo existente.

Toda operação que concede bônus ou marca uma missão como resgatada deve ocorrer em RPC/serviço confiável com validação de papel, titularidade da empresa e estado da missão. Clientes anônimos não podem gravar progresso, ajustar saldos ou consultar dados de outros clientes. Verificar também autorização em operações do painel feitas por usuários da equipe.

## Critérios de aceite do MVP (Fase 1)

- [~] Um proprietário consegue criar uma missão, definir campanha, meta, período no fuso horário da empresa, recompensa e ativá-la.
- [x] A interface informa quando os dados obrigatórios ou o período são inválidos.
- [x] Um carimbo válido da campanha atualiza o progresso do cliente elegível; remoção, emissão e resgate não atualizam esse progresso.
- [x] O cliente consegue consultar progresso e missões concluídas na página pública do próprio cartão, sem acessar dados de terceiros.
- [x] A meta só é concluída uma vez por ciclo configurado, inclusive com requisições repetidas ou concorrentes.
- [x] A equipe consegue conferir a elegibilidade e registrar a entrega uma única vez; o histórico identifica quem fez a operação.
- [x] Missões inativas, futuras ou expiradas não concedem progresso/recompensa fora das regras definidas.
- [x] Compatibilidade dos dados e políticas existentes de cartões, carimbos, login, resgate e RLS: a migration é aditiva; fluxo integrado validado em produção pelo proprietário.
- [x] A migration pode ser aplicada sem apagar ou recriar dados atuais.

## Ordem sugerida de execução

1. [x] Inspecionar rotas, componentes, serviços, migrations e políticas RLS existentes; confirmar o fluxo real de carimbo e resgate.
2. [x] Definir formalmente ciclo da missão, eventos que contam, fuso horário e limite de repetição; a configuração do fuso foi implementada no perfil da empresa com padrão do navegador.
3. [x] Criar migration aditiva, constraints, índices, políticas e operações seguras para criar missão, atualizar progresso e resgatar recompensa.
4. [x] Implementar tipos e acesso a dados no frontend sem duplicar regras de negócio no cliente.
5. [x] Criar gerenciamento de missões no painel do proprietário.
6. [x] Exibir progresso e conclusão na página pública do cartão.
7. [x] Integrar conferência/entrega à interface da equipe e ao histórico.
8. [x] Analytics de missões implementado; procedimento operacional documentado em [docs/operacao-de-missoes.md](docs/operacao-de-missoes.md).
9. [x] Permissões e casos de duplicidade, concorrência, expiração e compatibilidade com cartões existentes validados em produção pelo proprietário.

## Fora do escopo inicial

- Marketplace ou página de descoberta de várias empresas.
- Cadastro multiempresa ou múltiplas unidades na mesma instalação.
- Automação de interações do Instagram antes de validação de API e permissões.
- Migração obrigatória de cartões de carimbo para pontos.
- Promessas de ROI ou regras promocionais copiadas de material comercial de terceiros.

Esses itens exigem decisão de produto e escopo próprios antes de implementação.

## Referências

- [Enggaja — página inicial](https://enggaja.com/)
- [Enggaja — pontos](https://enggaja.com/pontos)
- [Enggaja — missões](https://enggaja.com/missoes)
- [Enggaja — níveis](https://enggaja.com/niveis)
- [Enggaja — Instagram](https://enggaja.com/instagram)
- [README do Stampfy](README.md)
- [Schema base do Supabase](supabase/migration.sql)

## Módulo de sites institucionais

O MVP do site por comércio está implementado no repositório: editor assistido, uploads, páginas públicas, catálogo, SEO básico, publicação e formulário/caixa de entrada de leads. O plano, configuração e pendências estão em [docs/sites-institucionais.md](docs/sites-institucionais.md). Para ativar em produção ainda é necessário aplicar `add_business_sites.sql` e `add_business_site_leads.sql`, configurar `SUPABASE_SERVICE_ROLE_KEY` server-only no Vercel e validar as rotas públicas. Domínio próprio, analytics/Search Console, auditoria detalhada e validação em produção continuam pendentes.

## Fases planejadas — Área do cliente e notificações

Estas fases registram a sequência acordada para manter o cliente informado sobre suas campanhas e incentivar seu retorno. Permanecem pendentes; não considerar os itens abaixo implementados até que o código, banco, experiência e critérios de aceite sejam concluídos e validados. O cadastro e a participação em campanhas devem continuar possíveis sem obrigar o cliente a fornecer e-mail, telefone ou aceitar notificações.

### Fase 5 — Área do cliente e preferências [~]

O primeiro recorte está implementado no repositório: a rota `/account` usa link seguro por e-mail; o cliente pode vincular registros pelo e-mail verificado ou pelo link do cartão e consultar cartões, saldo/histórico de pontos, progresso/conclusões de missões e recompensas em diferentes comércios. As preferências atuais permitem rever o consentimento de atualizações de fidelidade pelo WhatsApp por comércio e remover um comércio da conta, revogando esses envios sem apagar os registros comerciais. Os dados de vínculo ficam em tabela privada e não são expostos nas consultas de clientes dos tenants. Ainda falta aplicar `supabase/legacy-patches/add_customer_portal.sql` no Supabase e validar a jornada com sessões e dados reais. A primeira versão verifica identidade somente por e-mail; OTP por telefone, preferências de marketing/canais futuros e ajustes após validação permanecem pendentes.

- [~] Permitir criar uma identidade de cliente opcional e verificável, usando um método de autenticação escolhido (por exemplo, código por e-mail ou telefone); não exigir os dois contatos. A primeira versão usa link por e-mail; outros métodos dependem de decisão/configuração.
- [~] Manter os registros atuais de clientes isolados por `owner_id`. Vincular uma identidade Stampfy a registros de diferentes empresas somente após comprovação de posse e ação explícita do cliente; há vínculo por e-mail verificado e reivindicação de cartão, pendentes de validação no Supabase.
- [~] Permitir que o cliente consulte cartões, campanhas em andamento e encerradas, carimbos, missões, pontos, recompensas e resgates associados à sua identidade, com a empresa de origem e o estado de cada participação. O portal já lista cartões, pontos, missões ativas/concluídas e resgates; falta validar em produção.
- [~] Permitir acompanhar campanhas de outras empresas por seus links públicos e, quando elegível, associar a participação à identidade Stampfy. O vínculo é feito pelo e-mail verificado ou link do cartão; não criar diretório público/marketplace nesta fase.
- [~] Criar uma central de preferências que mostre canais disponíveis e escolhas separadas para atualizações da participação e mensagens promocionais/de retorno. A primeira versão expõe atualizações de fidelidade via WhatsApp; categorias de marketing e outros canais seguem pendentes.
- [~] Registrar consentimento de WhatsApp com data/origem e oferecer revogação por comércio na conta do cliente. Permissão de push do navegador e preferência de comunicação por empresa são controles distintos; push pertence à Fase 6.
- [~] Preservar preferências de cada empresa; o cliente já consegue revisar o consentimento de WhatsApp por comércio e remover o comércio da conta. A ação revoga as atualizações de WhatsApp e não apaga os registros comerciais; validar após a migration.
- [~] Garantir que um cliente consulte apenas os próprios dados; as RPCs usam a sessão autenticada e as tabelas de vínculo/preferência não são expostas diretamente. Confirmar políticas e isolamento após aplicar a migration no projeto Supabase.

**Critérios de aceite:** [~] participação anônima continua disponível; identidade verificada pode reunir participações de diferentes empresas sem duplicar ou expor registros; o cliente pode consultar o histórico e ajustar/revogar preferências por canal e empresa; RLS e endpoints impedem leitura cruzada entre clientes e tenants. Validar após aplicar a migration e concluir os métodos/categorias de preferência pendentes.

**Para validar a primeira versão:** aplicar `supabase/legacy-patches/add_customer_portal.sql` no projeto vinculado; confirmar nas configurações do Supabase Auth que os domínios local e de produção estão autorizados para o redirect `/account`; confirmar que o modelo de e-mail envia o link de acesso; testar vinculação por e-mail verificado e por link de cartão, contas sem cartões, cartão já vinculado a outra conta, revogação WhatsApp e isolamento entre duas contas.

### Fase 6 — Base PWA e notificações push [ ]

Preparar o Stampfy para instalar como PWA e receber notificações Web Push em dispositivos/navegadores compatíveis. A instalação não deve ser obrigatória para entrar em campanhas. Web Push depende de permissão explícita e de uma inscrição por navegador/dispositivo; no iOS/iPadOS, requer que o web app seja adicionado à Tela de Início em versões compatíveis. A entrega não é garantida pelo sistema operacional ou pelo navegador.

- [ ] Implementar e validar manifesto, ícones, HTTPS, `service worker`, comportamento de atualização e experiência de instalação; definir o mínimo de funcionamento offline sem prometer ações de fidelidade offline que não possam ser validadas no servidor.
- [ ] Detectar suporte e estado de permissão antes de oferecer ativação; explicar o benefício e solicitar permissão somente após ação explícita do cliente, sem exibir o prompt automaticamente ao abrir a página.
- [ ] Permitir ativar push com uma ação clara (por exemplo, “Receber atualizações”), informar quando a instalação na Tela de Início é necessária e manter acesso às campanhas mesmo se o cliente recusar.
- [ ] Salvar inscrição por dispositivo/navegador e associá-la à identidade verificada quando existir. Para cliente sem conta, definir um vínculo limitado e seguro à participação corrente, permitindo associar a inscrição mais tarde sem tratar o token push como identidade ou prova de posse.
- [ ] Criar armazenamento protegido para endpoint e chaves da inscrição, com acesso somente pelo servidor, unicidade/idempotência, registro de consentimento, revogação e limpeza de inscrições inválidas ou expiradas.
- [ ] Enviar push somente por serviço server-side com chaves VAPID em segredo de servidor; o `service worker` deve exibir uma notificação visível e abrir a campanha/cartão correto ao toque.
- [ ] Tratar falhas, tentativas, endpoints expirados e cancelamento da inscrição sem duplicar eventos de fidelidade. Nunca enviar push apenas com base em permissão do navegador se a preferência da categoria/empresa estiver desativada.
- [ ] Testar em Android/Chrome, desktop compatível, iOS/iPadOS com web app na Tela de Início e cenários sem suporte, permissão negada, permissão revogada, troca de dispositivo e atualização do service worker.

**Critérios de aceite:** instalação é opcional; nenhum prompt aparece sem contexto e gesto do cliente; inscrição pode ser revogada; push enviado pelo servidor abre a rota correta; consentimento por empresa/categoria é respeitado; falhas de entrega não bloqueiam cartões, missões ou recompensas.

### Fase 7 — Lembretes automáticos e controles para empresas [ ]

Adicionar reengajamento baseado em eventos e regras explícitas, sem transformar o push em canal de mensagens excessivas. Reutilizar a outbox/worker de comunicações quando adequado, após inspecionar as migrations, preferências e idempotência existentes.

- [ ] Separar atualizações transacionais da participação (visita validada, missão concluída, recompensa disponível ou próxima do vencimento) de promoções e lembretes de retorno; definir consentimento e elegibilidade para cada categoria.
- [ ] Definir gatilhos verificáveis ligados a campanhas e dados do servidor, como progresso sem atividade por um período, missão ainda ativa ou recompensa próxima do vencimento. Não notificar após conclusão, expiração, cancelamento ou saída da campanha.
- [ ] Criar controles por empresa para ativar/desativar categorias, escolher campanhas elegíveis, configurar cadência, validade, horário silencioso, fuso horário da empresa e conteúdo disponível para cada mensagem.
- [ ] Oferecer modelos com variáveis permitidas e pré-visualização; validar valores e destinos no servidor. Não permitir que configurações do painel contornem consentimento ou limites globais.
- [ ] Aplicar limite de frequência por cliente e empresa, deduplicação, idempotência, janela de envio e supressão quando o cliente já concluiu a ação. Revalidar consentimento e estado da campanha no momento do envio.
- [ ] Selecionar canais elegíveis sem duplicar a mesma notificação: push apenas com inscrição ativa e consentimentos correspondentes; WhatsApp apenas com telefone e opt-in válido; e-mail somente quando houver endereço e consentimento/capacidade de envio configurados. Manter avisos dentro da área do cliente como histórico quando ele voltar ao sistema.
- [ ] Registrar eventos enfileirados, tentativas e falhas; apresentar métricas compatíveis com o que cada canal realmente confirma, sem tratar push como entregue ou lido quando não houver confirmação confiável.
- [ ] Permitir que o cliente pause ou revogue categorias e canais; a empresa não pode reativar preferências revogadas pelo cliente.

**Critérios de aceite:** regras de lembrete usam eventos e horários do servidor; limites e consentimento são aplicados mesmo em chamadas concorrentes/repetidas; a empresa configura somente seus próprios envios; o cliente controla os canais/categorias; opt-out, conclusão e expiração suprimem envios futuros; cada tentativa é auditável e não altera saldo, carimbos ou progresso.

### Regras transversais das fases 5–7

- [ ] Fazer migrations aditivas, preservando os clientes, cartões, campanhas e preferências atuais; revisar RLS, constraints, índices, RPCs e secrets antes de publicar qualquer alteração.
- [ ] Não tornar e-mail, telefone, conta Stampfy, instalação do PWA ou push requisitos para participar de uma campanha.
- [ ] Manter dados de participação pertencentes a cada empresa; a área central reúne somente registros explicitamente vinculados e autorizados pelo cliente.
- [ ] Tratar inscrição push como dado sensível por dispositivo, nunca como identificador global do cliente; guardar chaves privadas e credenciais somente no servidor.
- [ ] Oferecer alternativa de consulta na próxima visita ao site e não prometer entrega garantida por notificações do navegador.
- [ ] Documentar textos de consentimento, retenção, revogação, exclusão/desvinculação e suporte para perda ou troca de dispositivo antes do lançamento.

**Referências técnicas:** [MDN — Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), [MDN — boas práticas para Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API/Best_Practices), [Apple — Web Push em web apps e navegadores](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [Apple — Safari 16.4 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-16_4-release-notes?changes=_5%2C_5).
