# Plano de novas funcionalidades para o Stampfy

## Legenda dos status

- [ ] Pendente
- [~] Implementação parcial ou validação pendente
- [x] Concluído no código/repositório

## Objetivo

Ampliar o Stampfy com recursos de fidelidade inspirados nas funcionalidades divulgadas pelo Enggaja, aproveitando a base de cartões e carimbos que já existe. A implementação deve ser incremental, compatível com os dados atuais e adequada ao modelo do Stampfy: uma empresa por instalação.

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

### Fase 4 — Comunicação e integrações [ ]

- [ ] Preparar notificações de progresso e recompensa por canal configurável, respeitando consentimento e preferências do cliente.
- [ ] Avaliar integração com WhatsApp somente com provedor, templates e configuração oficial adequados.
- [ ] Avaliar integração com Instagram somente por APIs oficiais da Meta, permissões aprovadas e regras vigentes. Oferecer revisão manual como alternativa; não simular acesso a mensagens ou interações privadas.
- [ ] Registrar falhas e permitir reprocessamento seguro sem duplicar pontos ou recompensas.

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
