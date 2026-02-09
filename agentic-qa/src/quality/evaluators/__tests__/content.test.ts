import assume from 'assume';
import { describe, it } from 'node:test';

import { evaluate } from '../content.js';
import { MockPage } from './mock-page.js';

describe('content', function packageTests() {
  describe('#evaluate', function evaluateTests() {
    it('should return good score for rich content without API key', async function richContent() {
      const page = new MockPage({
        evaluateReturns: [{
          title: 'Welcome to Our Restaurant - Fine Dining Experience',
          h1: 'Welcome to Our Restaurant',
          headings: ['Our Menu', 'About Us', 'Reservations'],
          mainText: 'We offer an exceptional dining experience with locally sourced ingredients. Our chef creates unique dishes daily using seasonal produce from local farms. The wine selection features award-winning vintages from around the world. Private dining rooms are available for special occasions and corporate events. Our terrace offers stunning views of the city skyline. Brunch service is available every weekend with live jazz music. We also provide catering services for off-site events and celebrations. The pastry chef prepares all desserts fresh each morning. Vegetarian and vegan options are available on every course of the menu. Our staff is trained to accommodate all dietary restrictions and allergies.',
          wordCount: 400,
        }],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.score).is.above(70);
      assume(result.data!.issues).has.length(0);
    });

    it('should penalize very little content', async function tooShort() {
      const page = new MockPage({
        evaluateReturns: [{
          title: 'My Site',
          h1: 'Hello',
          headings: [],
          mainText: 'Short content here.',
          wordCount: 50,
        }],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.issues.some(i => i.includes('less than 100 words'))).is.true();
    });

    it('should penalize limited content (100-300 words)', async function limitedContent() {
      const page = new MockPage({
        evaluateReturns: [{
          title: 'My Restaurant',
          h1: 'Welcome',
          headings: ['Menu'],
          mainText: 'We serve great food. '.repeat(10),
          wordCount: 150,
        }],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.issues.some(i => i.includes('less than 300 words'))).is.true();
    });

    it('should penalize missing or short title', async function noTitle() {
      const page = new MockPage({
        evaluateReturns: [{
          title: 'Hi',
          h1: 'Welcome to our site',
          headings: ['About', 'Contact'],
          mainText: 'We provide professional services to our customers. '.repeat(20),
          wordCount: 400,
        }],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.issues.some(i => i.includes('title'))).is.true();
    });

    it('should penalize missing H1', async function noH1() {
      const page = new MockPage({
        evaluateReturns: [{
          title: 'Full Title for the Website Page',
          h1: '',
          headings: ['Section 1', 'Section 2'],
          mainText: 'Content goes here with many useful words and sentences. '.repeat(20),
          wordCount: 400,
        }],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.issues.some(i => i.includes('H1'))).is.true();
    });

    it('should penalize few section headings', async function fewHeadings() {
      const page = new MockPage({
        evaluateReturns: [{
          title: 'Full Title for the Website Page',
          h1: 'Main Heading',
          headings: ['Only One'],
          mainText: 'Content goes here with many useful words and sentences. '.repeat(20),
          wordCount: 400,
        }],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.issues.some(i => i.includes('headings'))).is.true();
    });

    it('should detect lorem ipsum placeholder text', async function loremIpsum() {
      const page = new MockPage({
        evaluateReturns: [{
          title: 'Full Title for the Website',
          h1: 'Welcome',
          headings: ['About', 'Services'],
          mainText: 'Lorem ipsum dolor sit amet consectetur. More real content here. '.repeat(10),
          wordCount: 400,
        }],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.issues.some(i => i.includes('placeholder'))).is.true();
      assume(result.data!.professionalism).is.most(4);
    });

    it('should detect coming soon placeholder', async function comingSoon() {
      const page = new MockPage({
        evaluateReturns: [{
          title: 'Full Title for the Website',
          h1: 'Welcome',
          headings: ['About', 'Services'],
          mainText: 'This page is coming soon. We are working on something amazing. '.repeat(10),
          wordCount: 400,
        }],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.issues.some(i => i.includes('placeholder'))).is.true();
    });

    it('should detect repetitive content', async function repetitive() {
      const sameSentence = 'This is exactly the same sentence repeated many times over.';
      const page = new MockPage({
        evaluateReturns: [{
          title: 'Full Title for the Website',
          h1: 'Welcome',
          headings: ['About', 'Services'],
          mainText: Array(20).fill(sameSentence).join('. '),
          wordCount: 400,
        }],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.issues.some(i => i.includes('repetitive'))).is.true();
      assume(result.data!.uniqueness).is.most(4);
    });

    it('should check relevance against original prompt', async function relevance() {
      const page = new MockPage({
        evaluateReturns: [{
          title: 'Dog Walking Services',
          h1: 'Professional Dog Walkers',
          headings: ['Our Services', 'Pricing'],
          mainText: 'We walk dogs professionally in your neighborhood. '.repeat(20),
          wordCount: 400,
        }],
      });

      const result = await evaluate(page.asPage(), {
        originalPrompt: 'Create a restaurant website with menu and reservations',
      });

      assume(result.success).is.true();
      assume(result.data!.issues.some(i => i.includes('original request'))).is.true();
    });

    it('should not flag relevance when prompt matches', async function relevanceMatch() {
      const page = new MockPage({
        evaluateReturns: [{
          title: 'Best Restaurant in Town',
          h1: 'Fine Dining Experience',
          headings: ['Menu', 'Reservations'],
          mainText: 'Our restaurant offers the best menu items and reservations for dining. '.repeat(20),
          wordCount: 400,
        }],
      });

      const result = await evaluate(page.asPage(), {
        originalPrompt: 'Create a restaurant website with menu and reservations',
      });

      assume(result.success).is.true();
      assume(result.data!.issues.every(i => !i.includes('original request'))).is.true();
    });

    it('should floor score at 0', async function scoreFloor() {
      const page = new MockPage({
        evaluateReturns: [{
          title: '',
          h1: '',
          headings: [],
          mainText: 'Lorem ipsum dolor sit amet coming soon [your name]',
          wordCount: 10,
        }],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.score).is.least(0);
    });

    it('should handle errors gracefully', async function errorHandling() {
      const page = new MockPage();
      page.evaluate = async () => { throw new Error('Frame detached'); };

      const result = await evaluate(page.asPage());
      assume(result.success).is.false();
      assume(result.error).includes('Frame detached');
    });
  });
});
