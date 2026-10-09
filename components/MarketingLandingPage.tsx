import React from 'react';
import { ArrowDown, ArrowRight, BarChart3, Check, ChevronDown, Gift, Heart, History, Menu, QrCode, Smartphone, Sparkles, Stamp, Target, Users, X } from 'lucide-react';
import { trackEvent } from '../lib/analytics';

const problemCards = [
  { number: '01', title: 'A visita acontece uma vez', description: 'Depois da compra, o contato pode se perder e o cliente não tem um motivo claro para lembrar do seu negócio.' },
  { number: '02', title: 'Falta um convite para voltar', description: 'Sem uma campanha simples, fica mais difícil mostrar ao cliente que cada nova visita tem valor.' },
  { number: '03', title: 'O histórico fica espalhado', description: 'Anotações e cartões de papel não ajudam a visualizar com facilidade a participação nas campanhas.' },
];

const steps = [
  { number: '1', title: 'Crie sua campanha', description: 'Personalize o cartão, escolha a meta de selos e defina a recompensa.' },
  { number: '2', title: 'Convide seus clientes', description: 'Compartilhe o QR Code no balcão, na vitrine ou nos seus canais.' },
  { number: '3', title: 'Registre as visitas', description: 'Sua equipe valida a visita pelo atendimento e o cliente acompanha o cartão no celular.' },
  { number: '4', title: 'Recompense e acompanhe', description: 'Quando a meta da campanha é concluída, a equipe confere a recompensa e você consulta a atividade.' },
];

const features = [
  { icon: Stamp, title: 'Cartões de fidelidade', description: 'Personalize a aparência, a quantidade de selos e a recompensa de cada cartão.' },
  { icon: QrCode, title: 'Campanhas com QR Code', description: 'Ajude o cliente a encontrar sua campanha e entrar pelo navegador do celular.' },
  { icon: Users, title: 'Clientes e visitas', description: 'Consulte os cadastros, cartões emitidos e o histórico de atividade do seu negócio.' },
  { icon: Check, title: 'Atendimento pela equipe', description: 'Crie acessos para sua equipe registrar visitas e conferir recompensas.' },
  { icon: BarChart3, title: 'Acompanhamento', description: 'Veja a atividade das campanhas, o andamento dos cartões e os resgates registrados.' },
  { icon: Gift, title: 'Recompensas definidas por você', description: 'Escolha um benefício para a campanha e acompanhe quando ele fica disponível.' },
  { icon: Sparkles, title: 'Pontos e níveis', description: 'Premie visitas com pontos e personalize níveis e benefícios para cada faixa.' },
  { icon: Target, title: 'Missões de fidelidade', description: 'Crie desafios por visitas ou selos, com prazo, meta e recompensa.' },
  { icon: Gift, title: 'Catálogo de recompensas', description: 'Cadastre benefícios, controle o estoque e valide resgates com códigos.' },
];

const businesses = [
  { title: 'Barbearias', example: 'Um benefício depois de completar o ciclo de cortes definido pela barbearia.' },
  { title: 'Cafeterias e lanchonetes', example: 'Um cartão de visitas para quem gosta de voltar para o café.' },
  { title: 'Salões e esmalterias', example: 'Uma recompensa para reconhecer a frequência de cada cliente.' },
  { title: 'Pet shops', example: 'Uma campanha para clientes que retornam para cuidar dos seus pets.' },
  { title: 'Lavagem automotiva', example: 'Selos por serviço concluído e um benefício escolhido pelo estabelecimento.' },
  { title: 'Outros negócios locais', example: 'Personalize a campanha de acordo com o serviço e com seu público.' },
];

const questions = [
  { question: 'O que é o Stampfy?', answer: 'O Stampfy é uma plataforma de fidelização para negócios locais. O comércio cria campanhas, registra visitas e acompanha cartões e recompensas em um só lugar.' },
  { question: 'Meu cliente precisa instalar um aplicativo?', answer: 'Não. O cartão pode ser acessado pelo navegador do celular por meio do link ou QR Code da campanha.' },
  { question: 'Como funciona a validação por QR Code?', answer: 'O QR Code pode levar o cliente à campanha. A equipe acessa o atendimento do comércio para registrar visitas e conferir cartões.' },
  { question: 'Posso criar diferentes campanhas?', answer: 'Sim. O comércio pode criar campanhas com cartões, metas e recompensas próprias.' },
  { question: 'Como o cliente recebe a recompensa?', answer: 'Ao concluir a meta definida no cartão, o cliente mostra o progresso à equipe, que confere e registra a recompensa.' },
  { question: 'Minha equipe pode registrar visitas?', answer: 'Sim. O proprietário pode criar acessos de equipe para apoiar o atendimento e o registro de visitas.' },
  { question: 'Posso acompanhar os resultados?', answer: 'O painel reúne indicadores de clientes, cartões, visitas registradas e resgates dentro do período consultado.' },
  { question: 'O Stampfy funciona para qualquer comércio?', answer: 'As campanhas são personalizáveis e podem atender diferentes negócios locais, como cafés, salões, barbearias, pet shops e serviços automotivos.' },
  { question: 'Como faço para começar?', answer: 'Acesse o cadastro, configure as informações do seu negócio e crie sua primeira campanha.' },
  { question: 'Há planos e preços publicados?', answer: 'Os preços não estão publicados nesta página. Fale com a equipe para confirmar as condições comerciais atuais antes de contratar.' },
];

const trackCta = (placement: string) => {
  const query = new URLSearchParams(window.location.search);
  trackEvent('Landing CTA Clicked', {
    placement,
    source: query.get('utm_source'),
    medium: query.get('utm_medium'),
    campaign: query.get('utm_campaign'),
  });
};
const closeMobileMenu = (event: React.MouseEvent<HTMLAnchorElement>) => {
  event.currentTarget.closest('details')?.removeAttribute('open');
};

const MarketingLandingPage: React.FC = () => (
  <main className="marketing-page">
    <header className="marketing-header">
      <a className="marketing-brand" href="/" aria-label="Stampfy, início"><img src="/stampfy.svg" alt="Stampfy" width="420" height="110" /></a>
      <nav className="marketing-nav" aria-label="Navegação principal">
        <a href="#como-funciona">Como funciona</a>
        <a href="#recursos">Recursos</a>
        <a href="#demonstracao">Demonstração</a>
        <a href="#duvidas">Dúvidas</a>
      </nav>
      <div className="marketing-header-actions">
        <a className="marketing-login" href="/login">Entrar</a>
        <a className="marketing-button marketing-button-small" href="/signup" onClick={() => trackCta('header')}><span className="desktop-label">Criar minha conta</span><span className="mobile-label">Criar conta</span><ArrowRight size={16} /></a>
      </div>
      <details className="marketing-mobile-menu">
        <summary aria-label="Abrir ou fechar menu"><Menu className="menu-open-icon" size={21} /><X className="menu-close-icon" size={21} /></summary>
        <nav aria-label="Navegação móvel">
          <a href="#como-funciona" onClick={closeMobileMenu}>Como funciona</a>
          <a href="#recursos" onClick={closeMobileMenu}>Recursos</a>
          <a href="#demonstracao" onClick={closeMobileMenu}>Demonstração</a>
          <a href="#duvidas" onClick={closeMobileMenu}>Dúvidas</a>
          <a href="/login">Entrar</a>
        </nav>
      </details>
    </header>

    <section className="marketing-hero" aria-labelledby="hero-title">
      <div className="marketing-hero-copy">
        <span className="marketing-eyebrow"><Sparkles size={15} /> Fidelização digital para negócios locais</span>
        <h1 id="hero-title">Transforme clientes<br className="wide-break" /> ocasionais em clientes<br className="wide-break" /> recorrentes.</h1>
        <p>Crie campanhas de fidelidade, recompense cada visita e acompanhe o relacionamento com seus clientes em um só lugar. Tudo de forma simples para sua equipe e para quem compra no seu negócio.</p>
        <div className="marketing-hero-actions">
          <a className="marketing-button" href="/signup" onClick={() => trackCta('hero')}>Criar meu programa de fidelidade <ArrowRight size={18} /></a>
          <a className="marketing-text-link" href="#demonstracao" onClick={() => trackEvent('Landing Demo CTA Clicked', { placement: 'hero' })}>Ver como funciona <ArrowDown size={16} /></a>
        </div>
        <ul className="marketing-benefits" aria-label="Benefícios do Stampfy">
          <li><Check size={15} /> Sem instalar aplicativo</li>
          <li><Check size={15} /> Cartões digitais e QR Code</li>
          <li><Check size={15} /> Visitas e recompensas acompanhadas</li>
        </ul>
      </div>
      <div className="marketing-hero-visual">
        <div className="hero-visual-backdrop" />
        <div className="hero-visual-label"><span><Smartphone size={17} /></span><div><strong>Cartão no celular</strong><small>Um exemplo de campanha Stampfy</small></div></div>
        <figure className="hero-card-frame">
          <img src="/demo_3.png" alt="Exemplo ilustrativo de cartão de fidelidade digital de uma sorveteria, com selos e recompensa." width="393" height="850" />
        </figure>
        <div className="hero-visual-sticker"><QrCode size={18} /><span>Encontre sua campanha<br />pelo QR Code</span></div>
      </div>
    </section>

    <div className="marketing-strip" aria-label="Como o Stampfy ajuda seu comércio">
      <span><Smartphone size={17} /> Prático para o cliente</span><i aria-hidden="true" />
      <span><QrCode size={17} /> Direto pelo navegador</span><i aria-hidden="true" />
      <span><Heart size={17} /> Feito para negócios locais</span>
    </div>

    <section className="marketing-section marketing-problem" aria-labelledby="problem-title">
      <div className="section-heading"><span className="marketing-eyebrow">Um desafio de todo dia</span><h2 id="problem-title">Seu cliente comprou hoje.<br />O que faz ele voltar amanhã?</h2><p>O Stampfy ajuda seu comércio a transformar visitas em oportunidades de relacionamento contínuo.</p></div>
      <div className="problem-grid">{problemCards.map((item) => <article className="problem-card" key={item.number}><span className="problem-number">{item.number}</span><h3>{item.title}</h3><p>{item.description}</p></article>)}</div>
    </section>

    <section className="marketing-how" id="como-funciona" aria-labelledby="how-title">
      <div className="marketing-section">
        <div className="section-heading"><span className="marketing-eyebrow">Do primeiro selo à recompensa</span><h2 id="how-title">Seu programa de fidelidade<br />em poucos passos.</h2><p>Uma rotina simples de explicar para a equipe e fácil de acompanhar para o cliente.</p></div>
        <ol className="steps-grid">{steps.map((step) => <li className="step-card" key={step.number}><span className="step-number">{step.number}</span><span className="step-rule" aria-hidden="true" /><h3>{step.title}</h3><p>{step.description}</p></li>)}</ol>
      </div>
    </section>

    <section className="marketing-feature-section" id="recursos" aria-labelledby="features-title">
      <div className="marketing-feature-inner">
        <div className="feature-intro"><span className="marketing-eyebrow">Fidelidade e relacionamento</span><h2 id="features-title">Mais do que um cartão.<br />Um jeito de cuidar da relação.</h2><p>Ferramentas para convidar, reconhecer e acompanhar quem escolhe o seu negócio.</p><a className="marketing-button" href="/signup" onClick={() => trackCta('features')}>Conhecer o Stampfy <ArrowRight size={18} /></a></div>
        <div className="features-grid">{features.map(({ icon: Icon, title, description }) => <article className="feature-card" key={title}><span className="feature-icon"><Icon size={21} /></span><h3>{title}</h3><p>{description}</p></article>)}</div>
        <p className="feature-note"><Sparkles size={16} /> Combine cartões, pontos, níveis, missões e recompensas conforme a estratégia do seu comércio.</p>
      </div>
    </section>

    <section className="marketing-relationship" aria-labelledby="relationship-title">
      <div className="relationship-copy"><span className="marketing-eyebrow">Cada visita conta uma história</span><h2 id="relationship-title">A fidelidade não termina na primeira recompensa.</h2><p>O Stampfy organiza a participação nas campanhas, as visitas registradas e os resgates para ajudar você a entender o percurso de cada cliente.</p><ul><li><History size={17} /> Histórico de cartões e visitas</li><li><Gift size={17} /> Recompensas acompanhadas pela equipe</li><li><BarChart3 size={17} /> Indicadores para consultar a atividade</li></ul><small>O Stampfy registra a atividade das campanhas; os resultados dependem da participação dos seus clientes.</small></div>
      <div className="relationship-flow" role="img" aria-label="Representação do fluxo: campanha criada, visita registrada e recompensa conferida"><div className="relationship-flow-item"><span><Stamp size={22} /></span><b>Campanha criada</b></div><ArrowRight aria-hidden="true" /><div className="relationship-flow-item"><span><Users size={22} /></span><b>Visita registrada</b></div><ArrowRight aria-hidden="true" /><div className="relationship-flow-item"><span><Gift size={22} /></span><b>Recompensa conferida</b></div><p className="relationship-caption">Representação do fluxo de fidelidade. O resultado depende da adesão e da atividade dos clientes.</p></div>
    </section>

    <section className="marketing-audience" aria-labelledby="audience-title">
      <div className="section-heading"><span className="marketing-eyebrow">Feito para estar perto</span><h2 id="audience-title">Para negócios que vivem<br />de clientes que voltam.</h2><p>Crie campanhas com regras e recompensas que combinem com o seu atendimento.</p></div>
      <div className="audience-grid">{businesses.map((business, index) => <article className="audience-card" key={business.title}><span className={`audience-mark audience-mark-${index + 1}`} aria-hidden="true">{['✂', '☕', '✳', '♡', '◉', '＋'][index]}</span><h3>{business.title}</h3><p>{business.example}</p></article>)}</div>
      <p className="audience-caption">Os exemplos são ideias de campanha. O benefício e as regras são definidos pelo próprio estabelecimento.</p>
    </section>

    <section className="marketing-differentials" aria-labelledby="differentials-title">
      <div><span className="marketing-eyebrow">Simples para o comércio. Prático para o cliente.</span><h2 id="differentials-title">Fidelidade que cabe<br />na rotina do balcão.</h2></div>
      <div className="differential-list"><p><Check size={17} /> O cliente abre o cartão no navegador, sem instalar aplicativo.</p><p><Check size={17} /> O QR Code facilita o acesso à campanha.</p><p><Check size={17} /> Você define a aparência e as regras do cartão.</p><p><Check size={17} /> A equipe registra visitas com seu próprio acesso.</p><p><Check size={17} /> O histórico reúne cartões, visitas e recompensas.</p></div>
    </section>

    <section className="marketing-demo" id="demonstracao" aria-labelledby="demo-title">
      <div className="marketing-demo-inner">
        <div className="demo-copy"><span className="marketing-eyebrow">Um exemplo visual do produto</span><h2 id="demo-title">Veja o cartão pelo olhar do cliente.</h2><p>O cliente abre o link no celular, confere as regras da campanha e acompanha os selos registrados pela equipe.</p><a className="marketing-button" href="/signup" onClick={() => trackCta('demo')}>Criar meu programa <ArrowRight size={18} /></a><small>Imagem de campanha demonstrativa. As informações exibidas são exemplos.</small></div>
        <div className="demo-content">
          <figure className="demo-card-image"><img src="/demo_3.png" alt="Captura de tela de um cartão de fidelidade de demonstração no Stampfy." width="393" height="850" loading="lazy" /><figcaption>Exemplo de cartão digital</figcaption></figure>
          <ol className="demo-flow"><li><span>1</span><b>Comércio cria a campanha</b></li><li><span>2</span><b>Cliente abre o cartão</b></li><li><span>3</span><b>Equipe registra a visita</b></li><li><span>4</span><b>Cliente acompanha o progresso</b></li><li><span>5</span><b>Recompensa conferida no comércio</b></li></ol>
        </div>
      </div>
    </section>

    <section className="marketing-pricing" id="condicoes" aria-labelledby="pricing-title">
      <div className="pricing-copy"><span className="marketing-eyebrow">Próximo passo</span><h2 id="pricing-title">Conheça o Stampfy<br />para o seu negócio.</h2><p>O cadastro da conta está disponível. Como não há uma tabela pública de preços nesta página, confirme as condições comerciais atuais com a equipe antes de contratar.</p></div>
      <div className="pricing-actions"><a className="marketing-button" href="/signup" onClick={() => trackCta('conditions')}>Acessar cadastro <ArrowRight size={18} /></a><a className="marketing-text-link" href="mailto:hello@stampee.co?subject=Condi%C3%A7%C3%B5es%20comerciais%20Stampfy">Perguntar sobre condições <ArrowRight size={16} /></a></div>
    </section>

    <section className="marketing-faq" id="duvidas" aria-labelledby="faq-title">
      <div className="faq-heading"><span className="marketing-eyebrow">Perguntas frequentes</span><h2 id="faq-title">O que você precisa<br />saber para começar.</h2><p>Respostas diretas sobre a rotina do cartão digital.</p></div>
      <div className="faq-list">{questions.map((item) => <details key={item.question}><summary>{item.question}<ChevronDown size={18} /></summary><p>{item.answer}</p></details>)}</div>
    </section>

    <section className="marketing-cta" aria-labelledby="cta-title"><span className="marketing-eyebrow">Valorize cada visita</span><h2 id="cta-title">Seus clientes têm motivos<br className="wide-break" /> para voltar. Ajude-os a lembrar.</h2><p>Crie seu programa de fidelidade e ofereça uma experiência que reconhece cada visita ao seu negócio.</p><a className="marketing-button marketing-button-light" href="/signup" onClick={() => trackCta('footer')}>Começar com o Stampfy <ArrowRight size={18} /></a></section>

    <footer className="marketing-footer"><a className="marketing-brand" href="/" aria-label="Stampfy, início"><img src="/stampfy.svg" alt="Stampfy" width="420" height="110" /></a><span>Feito para aproximar negócios e pessoas.</span><div><a href="mailto:hello@stampee.co">Contato</a><a href="/login">Entrar</a></div><small>© {new Date().getFullYear()} Stampfy</small></footer>
  </main>
);

export default MarketingLandingPage;
