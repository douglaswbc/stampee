import React from 'react';
import { ArrowDown, ArrowRight, BarChart3, Check, ChevronDown, Gift, Heart, QrCode, Smartphone, Sparkles, Stamp, Zap } from 'lucide-react';
import './MarketingLandingPage.css';

const features = [
  { icon: Stamp, title: 'Cartão fidelidade digital', description: 'Crie campanhas de selos com a identidade do seu negócio e uma recompensa que faça sentido para os seus clientes.' },
  { icon: QrCode, title: 'Adesão com QR code', description: 'O cliente aponta a câmera do celular, entra na campanha e já pode acompanhar o cartão. Sem baixar aplicativo.' },
  { icon: Gift, title: 'Recompensas que dão vontade de voltar', description: 'Ofereça um produto, benefício ou pontos. Acompanhe resgates e deixe as regras da campanha claras.' },
  { icon: BarChart3, title: 'Visão do seu movimento', description: 'Consulte cartões emitidos, visitas registradas e a atividade dos clientes em um só painel.' },
];

const steps = [
  { number: '01', title: 'Monte seu cartão', description: 'Escolha um modelo, personalize as cores e defina quantos selos valem uma recompensa.' },
  { number: '02', title: 'Convide seus clientes', description: 'Compartilhe o QR code no balcão, na vitrine ou nas redes sociais. O cadastro acontece pelo celular.' },
  { number: '03', title: 'Registre visitas e recompense', description: 'Sua equipe valida os selos e você acompanha a evolução da campanha.' },
];

const questions = [
  { question: 'Meus clientes precisam instalar um aplicativo?', answer: 'Não. Eles acessam o cartão pelo navegador do celular, usando o link ou QR code da campanha.' },
  { question: 'Como os selos são validados?', answer: 'A equipe do comércio acessa o portal de atendimento e registra os selos durante a visita do cliente.' },
  { question: 'Que tipos de comércio podem usar o Stampfy?', answer: 'Cafés, salões, barbearias, restaurantes, lojas, estúdios e outros comércios locais que queiram incentivar novas visitas.' },
  { question: 'Posso criar mais de uma campanha?', answer: 'Sim. Você pode organizar campanhas de fidelidade para diferentes produtos, serviços ou objetivos.' },
];

const MarketingLandingPage: React.FC = () => (
  <main className="marketing-page">
    <header className="marketing-header">
      <a className="marketing-brand" href="/" aria-label="Stampfy, início"><img src="/stampfy.svg" alt="Stampfy" /></a>
      <nav className="marketing-nav" aria-label="Navegação principal">
        <a href="#como-funciona">Como funciona</a>
        <a href="#recursos">Recursos</a>
        <a href="#duvidas">Dúvidas</a>
      </nav>
      <div className="marketing-header-actions"><a className="marketing-login" href="/login">Entrar</a><a className="marketing-button marketing-button-small" href="/signup">Começar agora <ArrowRight size={16} /></a></div>
    </header>

    <section className="marketing-hero">
      <div className="marketing-hero-copy">
        <span className="marketing-eyebrow"><Sparkles size={15} /> Fidelidade para o comércio local</span>
        <h1>Quem volta sempre<br />merece <span>mais.</span></h1>
        <p>Crie um cartão fidelidade digital para o seu negócio e transforme cada visita em um motivo para voltar.</p>
        <div className="marketing-hero-actions"><a className="marketing-button" href="/signup">Criar meu cartão <ArrowRight size={18} /></a><a className="marketing-text-link" href="#como-funciona">Conheça o Stampfy <ArrowDown size={16} /></a></div>
        <div className="marketing-proof"><span className="proof-icon"><Check size={15} /></span><span>Comece pelo digital, direto no celular do seu cliente.</span></div>
      </div>
      <div className="marketing-hero-art" aria-label="Exemplo de cartão fidelidade Stampfy" role="img">
        <div className="hero-spark hero-spark-one">✳</div><div className="hero-spark hero-spark-two">✳</div>
        <div className="loyalty-card-mock">
          <div className="mock-card-top"><span className="mock-shop-mark"><Heart size={18} fill="currentColor" /></span><span className="mock-card-label">CLUBE DE VANTAGENS</span><span className="mock-more">•••</span></div>
          <div className="mock-shop-name">casa <em>flor</em></div>
          <p className="mock-card-subtitle">Um carinho a cada visita.</p>
          <div className="stamp-grid" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <span className={index < 5 ? 'stamp-dot stamp-dot-filled' : 'stamp-dot'} key={index}>{index < 5 ? <Heart size={20} fill="currentColor" /> : <span>{index + 1}</span>}</span>)}</div>
          <div className="mock-card-footer"><span>5 de 8 visitas</span><span>3 para ganhar um presente</span></div>
        </div>
        <div className="hero-note note-top"><span className="note-icon"><QrCode size={19} /></span><span><strong>É só apontar a câmera</strong><small>Sem instalar aplicativo</small></span></div>
        <div className="hero-note note-bottom"><span className="note-icon note-gift"><Gift size={19} /></span><span><strong>Mais uma visita!</strong><small>Seu cliente está quase lá</small></span><span className="note-check"><Check size={14} /></span></div>
        <div className="hero-blob" />
      </div>
    </section>

    <div className="marketing-strip"><span><Zap size={16} /> Simples para sua equipe</span><i /><span><Smartphone size={16} /> Fácil para seu cliente</span><i /><span><Heart size={16} /> Feito para o comércio local</span></div>

    <section className="marketing-section marketing-how" id="como-funciona">
      <div className="section-heading"><span className="marketing-eyebrow">Seu programa de fidelidade, sem complicação</span><h2>Da primeira visita<br />à próxima recompensa.</h2><p>Uma experiência simples para o cliente e prática para quem está no balcão.</p></div>
      <div className="steps-grid">{steps.map((step) => <article className="step-card" key={step.number}><span className="step-number">{step.number}</span><span className="step-rule" /><h3>{step.title}</h3><p>{step.description}</p></article>)}</div>
    </section>

    <section className="marketing-feature-section" id="recursos">
      <div className="feature-intro"><span className="marketing-eyebrow">Tudo em um só lugar</span><h2>Seu jeito de cuidar<br />de quem escolhe você.</h2><p>Ferramentas para criar sua campanha, facilitar o atendimento e manter o relacionamento ativo.</p><a className="marketing-button" href="/signup">Quero experimentar <ArrowRight size={18} /></a></div>
      <div className="features-grid">{features.map(({ icon: Icon, title, description }) => <article className="feature-card" key={title}><span className="feature-icon"><Icon size={21} /></span><h3>{title}</h3><p>{description}</p></article>)}</div>
    </section>

    <section className="marketing-audience"><div><span className="marketing-eyebrow">Feito para estar perto</span><h2>Pequeno no tamanho.<br /><span>Gigante na relação.</span></h2></div><p>Do café da esquina ao estúdio de beleza, um programa de fidelidade ajuda seu comércio a reconhecer cada pessoa que escolhe voltar.</p><div className="audience-tags"><span>☕ Cafés e restaurantes</span><span>✂️ Salões e barbearias</span><span>🛍️ Lojas locais</span><span>🧘 Estúdios e serviços</span></div></section>

    <section className="marketing-faq" id="duvidas"><div className="faq-heading"><span className="marketing-eyebrow">Ficou com alguma dúvida?</span><h2>Respostas sem<br />letra miúda.</h2><a href="mailto:hello@stampee.co">Fale com a gente <ArrowRight size={16} /></a></div><div className="faq-list">{questions.map((item) => <details key={item.question}><summary>{item.question}<ChevronDown size={18} /></summary><p>{item.answer}</p></details>)}</div></section>

    <section className="marketing-cta"><div className="cta-spark">✳</div><span className="marketing-eyebrow">Um bom motivo para voltar</span><h2>Seu próximo cliente fiel<br />pode chegar hoje.</h2><p>Crie seu cartão e convide seus clientes para fazer parte.</p><a className="marketing-button marketing-button-light" href="/signup">Começar agora <ArrowRight size={18} /></a></section>

    <footer className="marketing-footer"><a className="marketing-brand" href="/" aria-label="Stampfy, início"><img src="/stampfy.svg" alt="Stampfy" /></a><span>Feito para aproximar negócios e pessoas.</span><div><a href="mailto:hello@stampee.co">Contato</a><a href="/login">Entrar</a></div><small>© {new Date().getFullYear()} Stampfy</small></footer>
  </main>
);

export default MarketingLandingPage;
