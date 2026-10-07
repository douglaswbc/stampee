import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { Button } from "./ui/button";
import { PublicFooter } from "./PublicFooter";
import { SUPPORT_EMAIL } from "../lib/siteConfig";

const sections = [
  {
    title: "Service overview",
    body:
      "Stampfy provides browser-based digital loyalty cards and related tools for small businesses. The beta is intended for evaluation and day-to-day campaign use, but features may change as the product evolves.",
  },
  {
    title: "Acceptable use",
    body:
      "You may use Stampfy only for lawful business activity. You must not use the service to send spam, abuse customer data, attempt unauthorized access, interfere with other accounts, or upload content that infringes the rights of others.",
  },
  {
    title: "Your data and customer records",
    body:
      "You are responsible for the business information, campaign content, and customer details you add to Stampfy. You should have the right to collect and use that information and should avoid storing unnecessary sensitive data in the product.",
  },
  {
    title: "Beta availability",
    body:
      "Stampfy is currently offered as a soft beta. We may modify, suspend, or remove features, and we do not guarantee uninterrupted availability, specific uptime levels, or that every beta feature will remain in the product.",
  },
  {
    title: "Limitation of liability",
    body:
      "To the fullest extent allowed by law, Stampfy is provided on an as-is and as-available basis during beta. We are not liable for indirect, incidental, special, consequential, or punitive damages, or for loss of revenue, profits, data, or goodwill arising from use of the service.",
  },
  {
    title: "Contact",
    body: `Questions about these terms or the beta can be sent to ${SUPPORT_EMAIL}.`,
  },
];

export const TermsPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white text-[#1d1d1f]">
      <header className="fixed top-0 z-30 w-full border-b border-black/[0.06] bg-white/78 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[88rem] items-center justify-between px-4 py-4 sm:px-6 lg:px-10">
          <Link to="/" className="inline-flex items-center">
            <img src="/stampfy.svg?v=2" alt="Stampfy" className="h-8 w-auto" />
          </Link>
          <Button asChild variant="ghost" className="rounded-full text-sm text-[#1d1d1f] hover:bg-black/[0.05]">
            <Link to="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Home
            </Link>
          </Button>
        </div>
      </header>

      <main className="pt-20">
        <section className="bg-[#1d1d1f] px-4 py-16 sm:px-6 lg:px-10 lg:py-20">
          <div className="mx-auto max-w-[88rem]">
            <div className="max-w-[50rem]">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-white/88">
                <FileText className="h-3.5 w-3.5" />
                Terms of Service
              </div>
              <h1 className="mt-6 text-[clamp(2.8rem,5.4vw,5.2rem)] font-black leading-[0.92] tracking-[-0.05em] text-white">
                Terms for using Stampfy during the beta.
              </h1>
              <p className="mt-6 max-w-[38rem] text-[clamp(1rem,1.35vw,1.16rem)] leading-8 text-white/75">
                Last updated March 3, 2026.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-white px-4 py-14 sm:px-6 lg:px-10 lg:py-16">
          <div className="mx-auto grid max-w-[88rem] gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-6">
              <div className="bg-white px-6 py-2 sm:px-8 sm:py-2">
                <h2 className="text-[clamp(1.6rem,2.5vw,2.4rem)] font-semibold tracking-tight text-[#1d1d1f]">
                  Overview
                </h2>
                <p className="mt-4 text-base leading-8 text-[#50545a]">
                  These terms describe the core rules for using Stampfy in its current beta stage. They are written to
                  give small-business users a clear baseline while the product continues to ship improvements.
                </p>
              </div>

              {sections.map((section) => (
                <article
                  key={section.title}
                  className="bg-white px-6 py-2 sm:px-8 sm:py-2"
                >
                  <h2 className="text-[clamp(1.5rem,2.3vw,2.2rem)] font-semibold leading-[1.02] tracking-tight text-[#1d1d1f]">
                    {section.title}
                  </h2>
                  <p className="mt-4 text-base leading-8 text-[#50545a]">{section.body}</p>
                </article>
              ))}
            </div>

            <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
              <div className="bg-white px-6 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#1d1d1f]">Beta note</p>
                <p className="mt-4 text-sm leading-7 text-[#5f4a2c]">
                  Stampfy is still being hardened for broader release. Use the beta with that expectation, and contact{" "}
                  <a className="font-medium underline underline-offset-2" href={`mailto:${SUPPORT_EMAIL}`}>
                    {SUPPORT_EMAIL}
                  </a>{" "}
                  if you need clarification.
                </p>
              </div>
            </aside>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
};

export default TermsPage;
