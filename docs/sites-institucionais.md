# Plano do módulo de sites institucionais

## Objetivo

Adicionar ao Stampfy um módulo para cada comércio publicar e administrar um site institucional local, com páginas públicas, catálogo de produtos e serviços e ferramentas básicas de SEO. O módulo deve complementar campanhas, cartões e fidelidade sem transformar recompensas de fidelidade em produtos à venda.

Este documento é um plano para implementação futura. Não representa funcionalidades já entregues nem garante indexação ou posicionamento em mecanismos de busca.

## Contexto e decisões iniciais

- Integrar ao projeto existente: React, TypeScript, Vite, Supabase e a hospedagem atual. Não criar um projeto paralelo nem trocar a stack como parte desta iniciativa.
- Tratar cada perfil de proprietário como o tenant inicial do site. Equipe e proprietário mantêm as permissões e o isolamento já usados pelo Stampfy.
- Começar com um site institucional por empresa. Mais de um site por empresa ou uma conta de agência que administre diversos clientes exige decisão de produto antes da modelagem.
- A raiz compartilhada do Stampfy continua sendo institucional do Stampfy. No domínio compartilhado, usar uma rota pública com namespace, por exemplo `stampfy/empresa/{slug}`, para evitar conflito com login, painel, cartões, equipe e entrada em campanhas.
- Permitir domínio próprio do comércio em uma fase posterior. Nesse caso, o domínio do comércio abre o site na raiz, com resolução segura por hostname, verificação de propriedade, DNS e HTTPS.
- O catálogo público de produtos e serviços é diferente do catálogo de recompensas do Stampfy. Checkout, pagamentos e estoque de vendas ficam fora do MVP, salvo decisão de escopo posterior.
- Reutilizar nome, slug, identidade de campanha, links e dados de empresa existentes quando forem adequados; não duplicar esses dados sem necessidade.

## Navegação e experiência de administração

Adicionar a seção **Site** à navegação do proprietário, respeitando o sistema visual, idioma, responsividade e permissões existentes. Organizar a administração em:

- **Visão geral:** endereço público, status de publicação, última alteração e ações principais.
- **Páginas:** criar, editar, ordenar, pré-visualizar, publicar e arquivar páginas.
- **Produtos e serviços:** cadastrar itens, categorias e páginas individuais.
- **Identidade visual:** template, cores, tipografia, logotipo e imagens.
- **SEO e presença local:** metadados, endereço ou área atendida, telefone, horários e links oficiais.
- **Domínios:** endereço Stampfy e, quando implementado, domínio próprio.

Oferecer uma configuração assistida com salvamento de progresso: dados da empresa; segmento e público; produtos/serviços e localidade; identidade visual; conteúdo; SEO; pré-visualização e publicação.

## Site público e conteúdo

O template inicial deve ser responsivo, acessível por teclado, semântico e compatível com a identidade visual escolhida. O editor deve permitir editar textos, imagens, cores, ordem e visibilidade de blocos sem alterar código.

Páginas institucionais iniciais:

- Início
- Sobre a empresa
- Produtos ou serviços
- Página individual de produto ou serviço
- Contato
- Perguntas frequentes
- Política de privacidade
- Página 404

Cases, artigos, equipe, depoimentos e páginas de áreas atendidas podem entrar em fases posteriores. Depoimentos e afirmações comerciais devem vir de informações reais fornecidas ou aprovadas pela empresa.

Blocos iniciais possíveis: hero, benefícios, serviços, produtos, diferenciais, etapas, equipe, cases, depoimentos reais, FAQ, artigos relacionados, formulário, mapa, CTA e rodapé.

### Produtos e serviços como diretório

Manter registros estruturados com nome, slug, descrição própria, categoria, imagens, status e metadados SEO. Campos adicionais dependem do tipo:

- Produto: preço, faixa ou indicação de preço opcional, disponibilidade informativa e link de contato.
- Serviço: descrição, duração ou formato quando aplicável, público atendido, área de atendimento e CTA.

Gerar páginas de categoria e páginas individuais ligadas por navegação HTML rastreável. Permitir destacar um item em landing pages promocionais, sem exigir que cada item seja montado manualmente como uma página independente. Não incluir carrinho ou pagamento no MVP.

## SEO técnico, local e busca com IA

Para páginas públicas publicadas e indexáveis, implementar title e description próprios, canonical absoluto, Open Graph, hierarquia correta de títulos, URLs estáveis, links internos, breadcrumbs, alt em imagens, redirects permanentes e metadados de idioma quando houver versões traduzidas.

Gerar sitemap XML com páginas públicas, canônicas e indexáveis. Páginas em rascunho, preview ou privadas não podem aparecer no sitemap nem ser indexadas. No domínio compartilhado, manter um `robots.txt` global compatível com as rotas públicas; servir regras por hostname quando houver domínios próprios. Controlar indexação também por página.

Avaliar SSR, SSG, prerender ou alternativa compatível com a stack atual para entregar o conteúdo principal no HTML inicial. A decisão deve considerar o deploy existente; não migrar para outro framework sem análise e aprovação de escopo.

Campos de presença local: nome comercial, endereço físico opcional, telefone, horário de funcionamento, área atendida, coordenadas opcionais, links oficiais e link do Perfil da Empresa no Google. Empresas sem atendimento presencial devem poder informar apenas a área atendida.

Criar dados estruturados JSON-LD somente quando o tipo for aplicável e os dados reais estiverem visíveis na página, por exemplo `Organization`, `LocalBusiness`, `WebSite`, `WebPage`, `Service`, `Product`, `Article` e `BreadcrumbList`. Usar identificadores estáveis por site e validar a saída. Não prometer rich results.

O conteúdo deve responder perguntas reais com clareza, informações verificáveis e autoria quando aplicável. Qualquer conteúdo gerado por IA é rascunho, exige revisão humana e não pode inventar serviços, preços, localização, prêmios ou depoimentos. `llms.txt` não é requisito. Não criar páginas quase idênticas para cidades ou palavras-chave sem atuação e informação local específica.

## Modelo de dados e isolamento

Inspecionar novamente o schema, as RLS e as APIs antes de cada fase. Projetar migrations incrementais, sem apagar dados. Os nomes abaixo são ideias para adaptar às convenções existentes, não um schema decidido:

- configurações do site, páginas, blocos e revisões;
- serviços, produtos e categorias;
- localidades e áreas atendidas;
- mídias, domínios e redirects;
- formulários, leads, integrações e auditoria.

Vincular os dados ao proprietário/tenant, definir chaves estrangeiras, índices e constraints e garantir isolamento por RLS e validação no servidor. Não confiar somente na interface para autorizar operações. Reutilizar tabelas existentes quando tiverem o mesmo significado.

## Pré-visualização, publicação e domínios

Manter versões `draft` e `published`, com pré-visualização não indexável e acesso controlado. A publicação deve ser atômica; registrar revisões e permitir rollback. Invalidar cache ao publicar ou atualizar.

Para domínio próprio, validar propriedade antes de associá-lo, verificar hostname sem confiar em cabeçalhos fornecidos pelo usuário e só indicar publicação concluída após DNS, certificado HTTPS e roteamento estarem válidos. Um domínio de preview não deve gerar conteúdo público duplicado.

## Contatos, leads e privacidade

Oferecer links para WhatsApp, telefone e e-mail e formulários configuráveis. Validar e limitar envios, prevenir spam, registrar o lead no tenant correto e pedir consentimento quando necessário. Definir retenção, acesso e exclusão conforme a LGPD.

Integrações com CRM, analytics ou webhooks devem reutilizar serviços existentes quando disponíveis. Webhooks futuros devem ser assinados, idempotentes e ter retries auditáveis. Não criar métricas estimadas e apresentá-las como dados observados.

## Segurança e qualidade

Sanitizar conteúdo editável, validar uploads, proteger segredos no servidor e prevenir XSS, acesso cruzado entre tenants, SSRF e injeção. Registrar auditoria para publicação, domínio, alteração de conteúdo e leads.

Na fase de implementação, planejar testes unitários, integração e E2E para permissões, isolamento de tenants, editor, preview, publicação, rollback, SEO, sitemap, robots e formulários. Executar lint, typecheck, build e testes compatíveis com o projeto; documentar o que foi e o que não foi executado.

## Fases de execução

### Fase 0 — Análise e decisões [ ]

- [ ] Revisar stack e versões, rotas, modelo de proprietário/equipe, RLS, migrations, hospedagem, cache e deploy atual.
- [ ] Confirmar o MVP de um site por proprietário e decidir os dados empresariais reutilizáveis.
- [ ] Definir URLs públicas, conteúdo mínimo e limites do catálogo sem checkout.
- [ ] Escolher a estratégia de HTML inicial/indexação compatível com Vite e hospedagem atual.

### Fase 1 — Modelo e segurança [ ]

- [ ] Projetar modelo relacional e migrations incrementais.
- [ ] Definir RLS, autorização no servidor, uploads e auditoria por tenant.
- [ ] Definir estados de rascunho, publicação, preview e revisão.

### Fase 2 — Administração e template [ ]

- [ ] Adicionar menu Site e dashboard de status.
- [ ] Criar fluxo assistido com salvamento do progresso.
- [ ] Implementar identidade visual e editor de páginas/blocos acessível e responsivo.
- [ ] Implementar template institucional inicial.

### Fase 3 — Páginas públicas e diretório [ ]

- [ ] Renderizar Home, Sobre, Contato, privacidade e 404.
- [ ] Cadastrar categorias, produtos e serviços com páginas individuais.
- [ ] Criar navegação e links internos entre páginas, categorias e itens.
- [ ] Permitir destacar produtos/serviços em landing pages.

### Fase 4 — Preview, publicação e domínios [ ]

- [ ] Criar preview seguro e publicação de versões.
- [ ] Registrar revisões e rollback.
- [ ] Publicar primeiro no caminho compartilhado `/empresa/{slug}`.
- [ ] Implementar domínio próprio somente após definir configuração de DNS, HTTPS e resolução por hostname.

### Fase 5 — SEO técnico e local [ ]

- [ ] Implementar metadados, canonical, Open Graph, redirects e idioma.
- [ ] Gerar sitemap e robots sem rascunhos nem previews.
- [ ] Implementar JSON-LD condicional e validar consistência com conteúdo visível.
- [ ] Implementar presença local, imagens responsivas, acessibilidade e performance.
- [ ] Evitar páginas locais duplicadas ou sem valor específico.

### Fase 6 — Conversão e integrações [ ]

- [ ] Criar CTAs e formulários com consentimento, anti-spam, rate limit e isolamento.
- [ ] Integrar leads aos serviços internos ou preparar webhooks seguros.
- [ ] Integrar Search Console, Bing Webmaster ou analytics somente com autenticação e consentimentos necessários.
- [ ] Exibir métricas apenas quando houver mensuração configurada.

### Fase 7 — Validação e documentação [ ]

- [ ] Validar isolamento com ao menos dois tenants e suas equipes.
- [ ] Validar páginas, HTML inicial, metadados, canonical, JSON-LD, sitemap e robots.
- [ ] Validar publicação no domínio correto, rollback e captação de leads.
- [ ] Documentar configuração, limites, testes executados e bloqueios.

## Critérios de aceite

- Dois proprietários conseguem administrar seus próprios sites sem ler ou alterar dados do outro.
- Um proprietário consegue criar e pré-visualizar um site com páginas institucionais e itens do diretório.
- As páginas públicas entregam conteúdo principal, metadados e canonical coerentes; JSON-LD corresponde ao conteúdo visível.
- Sitemap inclui apenas URLs públicas canônicas e indexáveis; preview e rascunhos não são indexáveis.
- Produtos e serviços possuem URLs individuais alcançáveis por links internos.
- Leads são salvos somente no tenant correto, com controles de consentimento e abuso.
- Publicação e rollback recuperam versões esperadas; domínio só aparece como publicado após validação real.
- Os testes executados e os bloqueios de infraestrutura são relatados sem declarar resultados não verificados.

## Referências para implementação

- [Google Search: SEO para recursos de IA](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Google Search: políticas de spam](https://developers.google.com/search/docs/essentials/spam-policies)
- [Google Search: dados estruturados de empresas locais](https://developers.google.com/search/docs/appearance/structured-data/local-business)
- [Google Search: estrutura de navegação de sites](https://developers.google.com/search/docs/specialty/ecommerce/help-google-understand-your-ecommerce-site-structure)
- [Google Search: estrutura de URLs](https://developers.google.com/search/docs/crawling-indexing/url-structure)
- [Diretrizes atuais do Google para ranking local](https://support.google.com/business/answer/7091?hl=pt-BR)
- [Plano geral do Stampfy](../@TASK.md)
