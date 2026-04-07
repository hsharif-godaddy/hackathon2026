import './AiroHeroAnimation.scss';

import { type FC, useCallback, useEffect, useRef } from 'react';

import { getCoffeeShopHtml, SVG } from '@/experiments/homepage-engagement-variations/abstract_animation/animations/coffeeShopTemplate';
import { prefersReducedMotion, wait } from '@/experiments/homepage-engagement-variations/abstract_animation/animations/utils';
import { useTranslations } from '@/hooks/useTranslations';

// ────────────────────────────────────────
// Types
// ────────────────────────────────────────

export type ScenarioKey = 'coffee-shop' | 'pets-grooming' | 'ecommerce-store';

export interface ScenarioEntry {
  key: ScenarioKey;
  title?: string;
  domain?: string;
}

export interface AiroHeroAnimationProps {
  scenarios?: ScenarioEntry[];
  className?: string;
}

interface ScenarioRegistryEntry {
  id: string;
  defaultTitle: string;
  prompt: string;
  url: string;
  scrollMax: number;
  loadSteps: string[];
  getHtml: () => string;
}

interface ResolvedScenario {
  id: string;
  defaultTitle: string;
  title: string;
  prompt: string;
  url: string;
  scrollMax: number;
  loadSteps: string[];
  baseHtml: string;
}

// ────────────────────────────────────────
// Helpers
// ────────────────────────────────────────

function buildFragment(html: string): DocumentFragment {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const frag = document.createDocumentFragment();
  while (doc.body.firstChild) {
    frag.appendChild(doc.body.firstChild);
  }
  return frag;
}

function applyTitleOverride(container: DocumentFragment, defaultTitle: string, newTitle: string): void {
  if (defaultTitle === newTitle) return;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.textContent?.includes(defaultTitle)) {
      node.textContent = node.textContent.replaceAll(defaultTitle, newTitle);
    }
  }

  const defaultInitial = defaultTitle.charAt(0);
  const newInitial = newTitle.charAt(0);
  if (defaultInitial === newInitial) return;

  const logoMark = container.querySelector('.logo-mark');
  if (logoMark?.textContent === defaultInitial) {
    logoMark.textContent = newInitial;
  }
  const footerBrand = container.querySelector('.footer-brand');
  if (footerBrand?.textContent?.startsWith(defaultInitial)) {
    footerBrand.textContent = footerBrand.textContent.replace(defaultInitial, newInitial);
  }
}

async function typeText(el: HTMLElement, text: string, signal: AbortSignal, speed = 28): Promise<void> {
  for (let i = 0; i < text.length; i++) {
    if (signal.aborted) return;
    el.textContent += text[i];
    await wait(speed + Math.random() * 15);
  }
}

async function deleteText(el: HTMLElement, signal: AbortSignal, speed = 18): Promise<void> {
  const t = el.textContent ?? '';
  for (let i = t.length; i > 0; i--) {
    if (signal.aborted) return;
    el.textContent = t.substring(0, i - 1);
    await wait(speed + Math.random() * 8);
  }
}

async function smoothScroll(el: HTMLElement, maxPx: number, durationMs: number, signal: AbortSignal): Promise<void> {
  const steps = 60;
  const stepTime = durationMs / steps;
  for (let i = 1; i <= steps; i++) {
    if (signal.aborted) return;
    const t = i / steps;
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    el.style.transform = `translateY(${-maxPx * ease}px)`;
    await wait(stepTime);
  }
}

// ────────────────────────────────────────
// Scenario registry
// ────────────────────────────────────────

function buildScenarioRegistry(t: (key: string) => string): Record<ScenarioKey, ScenarioRegistryEntry> {
  return {
    'coffee-shop': {
      id: 'coffee',
      defaultTitle: t('builder_abstract_animation_scenario_coffee_title'),
      prompt: t('builder_abstract_animation_scenario_coffee_prompt'),
      url: 'www.mycoffeesite.example',
      scrollMax: 1150,
      loadSteps: [
        t('builder_abstract_animation_scenario_coffee_step_1'),
        t('builder_abstract_animation_scenario_coffee_step_2'),
        t('builder_abstract_animation_scenario_coffee_step_3'),
        t('builder_abstract_animation_scenario_coffee_step_4'),
      ],
      getHtml: getCoffeeShopHtml,
    },
    'pets-grooming': {
      id: 'pets',
      defaultTitle: t('builder_abstract_animation_scenario_pets_title'),
      prompt: t('builder_abstract_animation_scenario_pets_prompt'),
      url: 'www.mypetgroomingsite.example',
      scrollMax: 1300,
      loadSteps: [
        t('builder_abstract_animation_scenario_pets_step_1'),
        t('builder_abstract_animation_scenario_pets_step_2'),
        t('builder_abstract_animation_scenario_pets_step_3'),
        t('builder_abstract_animation_scenario_pets_step_4'),
      ],
      getHtml: () => `<div class="site-nav sec"><div class="nav-left"><div class="nav-logo"><div class="logo-mark">\ud83d\udc3e</div>My Pet Grooming site</div><div class="nav-links"><span>Services</span><span>Pricing</span><span>Reviews</span><span>Book Now</span></div></div><div class="nav-right"><div class="nav-btn outline">Sign In</div><div class="nav-btn fill">Book Now</div></div></div><div class="site-hero sec"><div class="hero-bg"></div><div class="hero-decor"></div><div class="hero-decor-icon">${SVG.doggy}</div><div class="hero-content"><div class="hero-tag">Locally loved</div><div class="hero-h1">Happy pets,<br><em>happy you</em></div><div class="hero-p">Full-service grooming, spa treatments, and nail care for dogs and cats. Certified groomers, stress-free experience, tail wags guaranteed.</div><div class="hero-actions"><div class="btn btn-primary">Book Appointment \u2192</div><div class="btn btn-ghost">View Services</div></div></div></div><div class="site-services sec"><div class="section-header"><div class="section-eyebrow">What We Offer</div><div class="section-title">Our Services</div></div><div class="services-grid"><div class="service-card"><div class="service-icon bath">${SVG.bath}</div><div class="service-name">Full Bath</div><div class="service-desc">Shampoo, conditioner, blow-dry, and brush-out</div><div class="service-price">From $45</div></div><div class="service-card"><div class="service-icon cut">${SVG.scissors}</div><div class="service-name">Haircut &amp; Style</div><div class="service-desc">Breed-specific cuts, shaping, and finish styling</div><div class="service-price">From $65</div></div><div class="service-card"><div class="service-icon nails">${SVG.pawPrint}</div><div class="service-name">Nail &amp; Paw Care</div><div class="service-desc">Trim, file, paw balm, and dewclaw check</div><div class="service-price">From $25</div></div><div class="service-card"><div class="service-icon spa">${SVG.sparkle}</div><div class="service-name">Spa Package</div><div class="service-desc">Bath, cut, nails, teeth brushing, and bandana</div><div class="service-price">From $95</div></div></div></div><div class="site-trust sec"><div class="trust-stats"><div class="stat"><div class="stat-num">4,200+</div><div class="stat-label"><strong>Happy pets groomed</strong>and counting since 2021</div></div><div class="stat"><div class="stat-num">4.9</div><div class="stat-label"><strong>Average rating</strong>across 800+ reviews</div></div><div class="stat"><div class="stat-num">12</div><div class="stat-label"><strong>Certified groomers</strong>on staff, all fear-free trained</div></div></div><div class="trust-reviews"><div class="review-card"><div class="review-stars">\u2605\u2605\u2605\u2605\u2605</div><div class="review-text">\u201cCooper used to hate bath time. Now he gets excited when we pull into our parking lot!\u201d</div><div class="review-author">\u2014 Jessica M.</div></div><div class="review-card"><div class="review-stars">\u2605\u2605\u2605\u2605\u2605</div><div class="review-text">\u201cBest grooming experience in town. Our cat actually purred through her nail trim.\u201d</div><div class="review-author">\u2014 David R.</div></div></div></div><div class="site-booking sec"><div class="booking-text"><div class="section-eyebrow">Easy Scheduling</div><div class="booking-title">Book in under<br>30 seconds</div><div class="booking-desc">Pick a service, choose your time, and we\u2019ll handle the rest. Same-day appointments available.</div><div class="booking-feats"><div class="booking-feat"><div class="feat-check">\u2713</div>Instant confirmation via text</div><div class="booking-feat"><div class="feat-check">\u2713</div>Free cancellation up to 4 hours</div><div class="booking-feat"><div class="feat-check">\u2713</div>Photo updates during the visit</div></div></div><div class="booking-form"><div class="form-title">Book an Appointment</div><div class="form-field">Pet\u2019s name</div><div class="form-row"><div class="form-field">Breed</div><div class="form-field">Size</div></div><div class="form-field">Select service\u2026</div><div class="form-field">Preferred date &amp; time</div><div class="form-btn">Book Now \u2014 It\u2019s Free</div></div></div><div class="site-footer sec"><div class="footer-brand">\ud83d\udc3e My Pet Grooming site</div><div class="footer-links"><span>Careers</span><span>FAQ</span><span>Privacy</span><span>Terms</span></div><div class="footer-socials"><div class="social-dot">\ud835\udd4f</div><div class="social-dot">\u25fb</div><div class="social-dot">\u25b6</div></div></div>`,
    },
    'ecommerce-store': {
      id: 'shop',
      defaultTitle: t('builder_abstract_animation_scenario_shop_title'),
      prompt: t('builder_abstract_animation_scenario_shop_prompt'),
      url: 'www.myclothingsite.example',
      scrollMax: 1150,
      loadSteps: [
        t('builder_abstract_animation_scenario_shop_step_1'),
        t('builder_abstract_animation_scenario_shop_step_2'),
        t('builder_abstract_animation_scenario_shop_step_3'),
        t('builder_abstract_animation_scenario_shop_step_4'),
      ],
      getHtml: () => `<div class="site-nav sec"><div class="nav-left"><div class="nav-logo">My Clothing site</div><div class="nav-links"><span>New In</span><span>Women</span><span>Men</span><span>Accessories</span><span>Sale</span></div></div><div class="nav-right"><span class="nav-icon">\ud83d\udd0d</span><span class="nav-icon">\u2764\ufe0f</span><span class="nav-icon">\ud83d\udc5c<span class="cart-badge">3</span></span></div></div><div class="site-hero sec"><div class="hero-bg"></div><div class="hero-decor"></div><div class="hero-decor-icon">${SVG.hanger}</div><div class="hero-content"><div class="hero-tag">Spring \u201926 Collection</div><div class="hero-h1">Less noise,<br>more <em>style</em></div><div class="hero-p">Timeless essentials designed for everyday. Ethically made, built to last, and effortlessly wearable.</div><div class="hero-actions"><div class="btn btn-primary">Shop New Arrivals</div><div class="btn btn-ghost">View Lookbook</div></div></div></div><div class="site-categories sec"><div class="cat-grid"><div class="cat-card women"><div class="cat-icon">${SVG.dress}</div><div class="cat-label">Women<div class="cat-count">124 styles</div></div></div><div class="cat-card men"><div class="cat-icon">${SVG.jacket}</div><div class="cat-label">Men<div class="cat-count">98 styles</div></div></div><div class="cat-card acc"><div class="cat-icon">${SVG.bag}</div><div class="cat-label">Accessories<div class="cat-count">56 items</div></div></div></div></div><div class="site-products sec"><div class="section-header"><div class="section-eyebrow">Just Dropped</div><div class="section-title">New Arrivals</div></div><div class="product-grid"><div class="product-card"><div class="prod-img img1"><div class="prod-tag">New</div>${SVG.blazer}</div><div class="prod-body"><div class="prod-name">Relaxed Linen Blazer</div><div class="prod-color">Sand \u00b7 Women</div><div class="prod-footer"><div class="prod-price">$128</div><div class="prod-cart">+</div></div></div></div><div class="product-card"><div class="prod-img img2">${SVG.tshirt}</div><div class="prod-body"><div class="prod-name">Heavyweight Pocket Tee</div><div class="prod-color">Slate \u00b7 Men</div><div class="prod-footer"><div class="prod-price">$38</div><div class="prod-cart">+</div></div></div></div><div class="product-card"><div class="prod-img img3"><div class="prod-tag">Low stock</div>${SVG.bag}</div><div class="prod-body"><div class="prod-name">Canvas Weekender</div><div class="prod-color">Olive \u00b7 Unisex</div><div class="prod-footer"><div class="prod-price">$89</div><div class="prod-cart">+</div></div></div></div><div class="product-card"><div class="prod-img img4"><div class="prod-tag">Sale</div>${SVG.knit}</div><div class="prod-body"><div class="prod-name">Merino Crew Knit</div><div class="prod-color">Charcoal \u00b7 Men</div><div class="prod-footer"><div class="prod-price">$64 <s>$95</s></div><div class="prod-cart">+</div></div></div></div></div></div><div class="site-banner sec"><div class="banner-text"><div class="banner-label">Stay in the loop</div><div class="banner-title">10% off your first order</div><div class="banner-desc">Sign up for early access to new drops, restocks, and member-only pricing.</div><div class="banner-form"><div class="banner-input">Enter your email</div><div class="banner-btn">Subscribe</div></div></div><div class="banner-perks"><div class="b-perk"><div class="b-perk-icon">\ud83d\ude9a</div><div class="b-perk-text">Free shipping<br>over $75</div></div><div class="b-perk"><div class="b-perk-icon">\ud83d\udd04</div><div class="b-perk-text">30-day<br>returns</div></div><div class="b-perk"><div class="b-perk-icon">\ud83c\udf3f</div><div class="b-perk-text">Ethically<br>made</div></div></div></div><div class="site-footer sec"><div class="footer-brand">My Clothing site</div><div class="footer-links"><span>About</span><span>Sustainability</span><span>Careers</span><span>Privacy</span><span>Terms</span></div><div class="footer-socials"><div class="social-dot">\ud835\udd4f</div><div class="social-dot">\u25fb</div><div class="social-dot">\u25b6</div></div></div>`,
    },
  };
}

// ────────────────────────────────────────
// Scenario resolution (applies title/domain overrides)
// ────────────────────────────────────────

function resolveScenario(entry: ScenarioEntry, registry: Record<ScenarioKey, ScenarioRegistryEntry>): ResolvedScenario | null {
  const reg = registry[entry.key];
  if (!reg) return null;

  const title = entry.title ?? reg.defaultTitle;

  return {
    id: reg.id,
    defaultTitle: reg.defaultTitle,
    title,
    prompt: title !== reg.defaultTitle
      ? reg.prompt.replace(reg.defaultTitle, title)
      : reg.prompt,
    url: entry.domain ?? reg.url,
    scrollMax: reg.scrollMax,
    loadSteps: reg.loadSteps,
    baseHtml: reg.getHtml(),
  };
}

// ────────────────────────────────────────
// Component
// ────────────────────────────────────────

const DEFAULT_SCENARIOS: ScenarioEntry[] = [
  { key: 'coffee-shop' },
  { key: 'pets-grooming' },
  { key: 'ecommerce-store' },
];

export const AiroHeroAnimation: FC<AiroHeroAnimationProps> = ({
  scenarios = DEFAULT_SCENARIOS,
  className = '',
}) => {
  const t = useTranslations();
  const stageRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const registryRef = useRef(buildScenarioRegistry(t));

  const getEl = useCallback(
    (id: string): HTMLElement | null =>
      stageRef.current?.querySelector<HTMLElement>(`[data-airo="${id}"]`) ?? null,
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const selectedScenarios = scenarios
      .map((entry) => resolveScenario(entry, registryRef.current))
      .filter(Boolean) as ResolvedScenario[];
    if (selectedScenarios.length === 0) return;

    function resetBrowserState() {
      const els = {
        loading: getEl('loadingOverlay'),
        loadSteps: getEl('loadSteps'),
        scanline: getEl('scanline'),
        siteScroll: getEl('siteScroll'),
        siteInner: getEl('siteInner'),
        urlText: getEl('urlText'),
        sendBtn: getEl('sendBtn'),
      };
      els.loading?.classList.remove('visible');
      els.loadSteps?.replaceChildren();
      els.scanline?.classList.remove('active');
      if (els.scanline) els.scanline.style.animation = '';
      els.siteScroll?.classList.remove('visible');
      if (els.siteInner) {
        els.siteInner.style.transform = '';
        els.siteInner.replaceChildren();
        els.siteInner.className = 'site-inner';
      }
      els.urlText?.classList.remove('visible');
      if (els.urlText) els.urlText.textContent = '';
      els.sendBtn?.classList.remove('active');
    }

    async function runScenario(s: ResolvedScenario, isFirst: boolean) {
      if (signal.aborted) return;

      const promptEl = getEl('promptText');
      const siteInner = getEl('siteInner');
      if (!promptEl || !siteInner) return;

      if (isFirst) {
        getEl('promptBar')?.classList.add('visible');
        getEl('browserFrame')?.classList.add('visible');
        await wait(500);
      }

      await typeText(promptEl, s.prompt, signal);
      if (signal.aborted) return;
      await wait(200);

      const sendBtn = getEl('sendBtn');
      sendBtn?.classList.add('active');
      sendBtn?.classList.add('pressed');
      await wait(120);
      sendBtn?.classList.remove('pressed');
      await wait(300);

      const urlText = getEl('urlText');
      if (urlText) {
        urlText.textContent = s.url;
        urlText.classList.add('visible');
      }

      const loadStepsEl = getEl('loadSteps');
      if (loadStepsEl) {
        loadStepsEl.replaceChildren();
        for (const text of s.loadSteps) {
          const span = document.createElement('span');
          span.textContent = text;
          loadStepsEl.appendChild(span);
        }
      }
      getEl('loadingOverlay')?.classList.add('visible');
      await wait(300);

      const spans = loadStepsEl?.querySelectorAll('span') ?? [];
      for (const span of spans) {
        if (signal.aborted) return;
        span.classList.add('visible');
        await wait(450);
      }
      await wait(400);
      getEl('loadingOverlay')?.classList.remove('visible');
      await wait(300);

      siteInner.className = 'site-inner ' + s.id;
      const frag = buildFragment(s.baseHtml);
      applyTitleOverride(frag, s.defaultTitle, s.title);
      siteInner.replaceChildren(frag);

      const scanline = getEl('scanline');
      scanline?.classList.add('active');
      if (scanline) scanline.style.animation = 'airo-scanDown 1.6s ease-in-out 2';

      getEl('siteScroll')?.classList.add('visible');
      await wait(100);

      const sections = siteInner.querySelectorAll('.sec');
      for (const sec of sections) {
        if (signal.aborted) return;
        sec.classList.add('visible');
        await wait(200);
      }

      await wait(1500);
      if (signal.aborted) return;

      scanline?.classList.remove('active');
      if (scanline) scanline.style.animation = '';

      const viewport = getEl('viewport');
      const scrollMax = viewport
        ? Math.max(0, siteInner.scrollHeight - viewport.clientHeight)
        : s.scrollMax;
      await smoothScroll(siteInner, scrollMax, 5000, signal);
      if (signal.aborted) return;

      await wait(2500);
      if (signal.aborted) return;

      getEl('siteScroll')?.classList.remove('visible');
      await wait(600);

      resetBrowserState();
      sendBtn?.classList.remove('active');

      await wait(200);
      await deleteText(promptEl, signal);
      await wait(400);
    }

    async function loop() {
      let first = true;
      while (!signal.aborted) {
        for (const s of selectedScenarios) {
          if (signal.aborted) return;
          await runScenario(s, first);
          first = false;
        }
      }
    }

    if (prefersReducedMotion()) return () => controller.abort();

    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => { if (mql.matches) controller.abort(); };
    mql.addEventListener('change', onChange);

    loop();
    return () => {
      mql.removeEventListener('change', onChange);
      controller.abort();
    };
  }, [scenarios, getEl]);

  return (
    <div className={`airo-hero ${className}`.trim()}>
      <div className="stage" ref={stageRef}>
        <div className="prompt-bar" data-airo="promptBar">
          <div className="prompt-icon">{'\u2726'}</div>
          <div className="prompt-text">
            <span data-airo="promptText"></span><span className="cursor-blink" data-airo="cursor"></span>
          </div>
          <div className="send-btn" data-airo="sendBtn">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
        </div>
        <div className="browser" data-airo="browserFrame">
          <div className="browser-bar">
            <div className="dots">
              <div className="dot"></div>
              <div className="dot"></div>
              <div className="dot"></div>
            </div>
            <div className="url-bar">
              <span className="lock">{'\ud83d\udd12'}</span>
              <span className="url-text" data-airo="urlText"></span>
            </div>
          </div>
          <div className="viewport" data-airo="viewport">
            <div className="loading" data-airo="loadingOverlay">
              <div className="spinner"></div>
              <div className="load-steps" data-airo="loadSteps"></div>
            </div>
            <div className="scanline" data-airo="scanline"></div>
            <div className="site-scroll" data-airo="siteScroll">
              <div className="site-inner" data-airo="siteInner"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiroHeroAnimation;
