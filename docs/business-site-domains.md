# Domínios próprios para sites dos comércios

O menu **Site → Domínio próprio** conecta um domínio raiz por comércio. A plataforma registra o domínio na Vercel, mostra os registros DNS recomendados pela Vercel e verifica a configuração. O endereço `www` fica como principal; o domínio raiz redireciona para `www` com status 308. Enquanto o domínio próprio é verificado, o site usa um subdomínio Stampfy: `<slug>.<host de VITE_APP_URL>`. Por exemplo, com `VITE_APP_URL=https://stampee.co`, o slug `demo` fica em `demo.stampee.co`.

## Preparação de produção

1. Aplique `supabase/legacy-patches/add_business_site_domains.sql` no projeto Supabase já existente. Em uma instalação nova, a tabela e as funções estão no fim de `supabase/migration.sql`.
2. No projeto Vercel que publica a aplicação, configure as variáveis server-only `VERCEL_ACCESS_TOKEN`, `VERCEL_PROJECT_ID` e, se o projeto pertence a um time, `VERCEL_TEAM_ID`. O token precisa poder adicionar, verificar e remover domínios desse projeto.
3. Configure `VITE_APP_URL` com a URL pública principal da aplicação. O domínio padrão dos sites dos comércios é derivado do hostname dessa variável. No servidor, `VITE_APP_URL` tem precedência e `APP_ORIGIN` serve como fallback; mantenha ambos alinhados.
4. Adicione à Vercel e ao DNS o curinga do hostname usado pela aplicação. Para `https://stampee.co`, configure `*.stampee.co`. O `vercel.ts` calcula as exceções de roteamento a partir de `VITE_APP_URL` (ou `APP_ORIGIN` como fallback), então o domínio principal não precisa ser repetido em uma regra estática.
5. Faça um novo deploy depois de aplicar a migração, configurar as variáveis e adicionar o domínio curinga.

## Fluxo do comércio

1. Publique o site no menu Site.
2. Abra **Domínio próprio** e informe o domínio raiz, como `minhaloja.com.br`.
3. Copie os registros `A`, `AAAA`, `CNAME` e `TXT` exibidos para o provedor que gerencia o DNS do domínio. Os valores vêm da configuração retornada pela API da Vercel; a plataforma não fixa endereços de DNS.
4. Depois da propagação, clique **Verificar conexão DNS**. O domínio só fica ativo quando a Vercel confirma a verificação e a configuração de DNS dos dois endereços.

O renderizador público usa o host ativo para resolver o comércio e manter links, canonical, dados estruturados, formulário de contato e sitemap no domínio próprio. Os links antigos `/empresa/{slug}` continuam disponíveis.

As regras de `has`/`missing` por hostname em `vercel.ts` são aplicadas pela Vercel no deploy; o ambiente `vercel dev` não reproduz essas regras. Valide o roteamento de domínio em um deploy Vercel de teste antes de liberar para os comércios.
