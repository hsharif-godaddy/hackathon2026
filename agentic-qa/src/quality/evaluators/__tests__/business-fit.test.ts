import assume from 'assume';
import { describe, it } from 'node:test';

import { evaluate } from '../business-fit.js';
import { MockPage } from './mock-page.js';

describe('business-fit', function packageTests() {
  describe('#evaluate', function evaluateTests() {
    it('should infer ecommerce site type from prompt', async function inferEcommerce() {
      const page = new MockPage({
        evaluateReturns: [{
          text: 'Welcome to our online store. Browse products and add to cart.',
          headings: ['Shop Now', 'Products'],
          links: ['Home', 'Shop', 'Cart'],
          buttons: ['Add to Cart', 'Checkout'],
          forms: 1,
          images: 10,
        }],
      });

      const result = await evaluate(page.asPage(), {
        originalPrompt: 'Build an ecommerce store for shoes',
      });

      assume(result.success).is.true();
      assume(result.data!.siteType).equals('ecommerce');
    });

    it('should infer restaurant site type from prompt', async function inferRestaurant() {
      const page = new MockPage({
        evaluateReturns: [{
          text: 'Our menu features the finest cuisine. Make a reservation today.',
          headings: ['Our Menu', 'Reservations'],
          links: ['Menu', 'About', 'Contact'],
          buttons: ['Book a Table'],
          forms: 1,
          images: 8,
        }],
      });

      const result = await evaluate(page.asPage(), {
        originalPrompt: 'Create a restaurant website for Italian food',
      });

      assume(result.success).is.true();
      assume(result.data!.siteType).equals('restaurant');
    });

    it('should infer portfolio site type', async function inferPortfolio() {
      const page = new MockPage({
        evaluateReturns: [{
          text: 'View my design portfolio and previous work.',
          headings: ['My Work', 'About Me'],
          links: ['Portfolio', 'Contact'],
          buttons: ['View Projects'],
          forms: 0,
          images: 15,
        }],
      });

      const result = await evaluate(page.asPage(), {
        originalPrompt: 'Portfolio website for a photographer',
      });

      assume(result.success).is.true();
      assume(result.data!.siteType).equals('portfolio');
    });

    it('should infer medical site type', async function inferMedical() {
      const page = new MockPage({
        evaluateReturns: [{
          text: 'Schedule an appointment with our doctors.',
          headings: ['Services', 'Our Physicians'],
          links: ['Services', 'Doctors', 'Appointments'],
          buttons: ['Book Appointment'],
          forms: 1,
          images: 5,
        }],
      });

      const result = await evaluate(page.asPage(), {
        originalPrompt: 'Medical clinic website for family healthcare',
      });

      assume(result.success).is.true();
      assume(result.data!.siteType).equals('medical');
    });

    it('should default to generic when no prompt', async function noPrompt() {
      const page = new MockPage({
        evaluateReturns: [{
          text: 'Welcome to our website. Contact us for more info.',
          headings: ['Welcome', 'About'],
          links: ['Home', 'About', 'Contact'],
          buttons: ['Learn More'],
          forms: 1,
          images: 3,
        }],
      });

      const result = await evaluate(page.asPage());
      assume(result.success).is.true();
      assume(result.data!.siteType).equals('generic');
    });

    it('should use explicit siteType over inferred', async function explicitSiteType() {
      const page = new MockPage({
        evaluateReturns: [{
          text: 'Some content here.',
          headings: ['Title'],
          links: ['Home'],
          buttons: [],
          forms: 0,
          images: 0,
        }],
      });

      const result = await evaluate(page.asPage(), {
        siteType: 'fitness',
        originalPrompt: 'Create a restaurant website',
      });

      assume(result.success).is.true();
      assume(result.data!.siteType).equals('fitness');
    });

    it('should score food-photos based on image count', async function foodPhotos() {
      const withImages = new MockPage({
        evaluateReturns: [{
          text: 'Our restaurant menu.',
          headings: ['Menu'],
          links: ['Home'],
          buttons: [],
          forms: 0,
          images: 5,
        }],
      });

      const result = await evaluate(withImages.asPage(), { siteType: 'restaurant' });
      assume(result.success).is.true();
      // food-photos should score 8 with 5 images (>= 3)
      assume(result.data!.criteria['food-photos']).equals(8);
    });

    it('should score cta-button based on button count', async function ctaButton() {
      const page = new MockPage({
        evaluateReturns: [{
          text: 'Welcome to our startup. Revolutionizing the industry.',
          headings: ['Features', 'Pricing'],
          links: ['Home'],
          buttons: ['Get Started', 'Learn More', 'Sign Up'],
          forms: 0,
          images: 2,
        }],
      });

      const result = await evaluate(page.asPage(), { siteType: 'landing-page' });
      assume(result.success).is.true();
      assume(result.data!.criteria['cta-button']).equals(8);
    });

    it('should score content based on text length', async function contentLength() {
      const page = new MockPage({
        evaluateReturns: [{
          text: 'x'.repeat(600),
          headings: ['Home', 'About', 'Contact'],
          links: ['Home', 'About', 'Contact'],
          buttons: [],
          forms: 0,
          images: 0,
        }],
      });

      const result = await evaluate(page.asPage(), { siteType: 'generic' });
      assume(result.success).is.true();
      assume(result.data!.criteria['content']).equals(8);
    });

    it('should detect keyword matches for criteria', async function keywordMatch() {
      const page = new MockPage({
        evaluateReturns: [{
          text: 'Contact us by email or phone. View our pricing plans. Read testimonials from our customers.',
          headings: ['Contact', 'Pricing', 'Testimonials'],
          links: ['Home', 'Contact', 'Pricing'],
          buttons: ['Get Quote'],
          forms: 1,
          images: 3,
        }],
      });

      const result = await evaluate(page.asPage(), { siteType: 'landing-page' });
      assume(result.success).is.true();
      assume(result.data!.presentElements.length).is.above(0);
    });

    it('should report missing elements', async function missingElements() {
      const page = new MockPage({
        evaluateReturns: [{
          text: 'Just a simple page.',
          headings: [],
          links: [],
          buttons: [],
          forms: 0,
          images: 0,
        }],
      });

      const result = await evaluate(page.asPage(), { siteType: 'ecommerce' });
      assume(result.success).is.true();
      assume(result.data!.missingElements.length).is.above(0);
    });

    it('should calculate average score from criteria', async function averageScore() {
      const page = new MockPage({
        evaluateReturns: [{
          text: 'We offer products at great prices. Add items to your cart and checkout.',
          headings: ['Products', 'Cart', 'Checkout'],
          links: ['Shop', 'Cart'],
          buttons: ['Add to Cart', 'Checkout'],
          forms: 1,
          images: 5,
        }],
      });

      const result = await evaluate(page.asPage(), { siteType: 'ecommerce' });
      assume(result.success).is.true();
      assume(result.data!.score).is.a('number');
      assume(result.data!.score).is.least(0);
      assume(result.data!.score).is.most(100);
    });

    it('should infer legal site type', async function inferLegal() {
      const page = new MockPage({
        evaluateReturns: [{
          text: 'Our attorneys specialize in various legal areas.',
          headings: ['Practice Areas'],
          links: ['Attorneys', 'Contact'],
          buttons: ['Free Consultation'],
          forms: 1,
          images: 3,
        }],
      });

      const result = await evaluate(page.asPage(), {
        originalPrompt: 'Create a law firm website',
      });

      assume(result.success).is.true();
      assume(result.data!.siteType).equals('legal');
    });

    it('should infer fitness site type', async function inferFitness() {
      const page = new MockPage({
        evaluateReturns: [{
          text: 'Join our gym for personal trainer sessions.',
          headings: ['Classes', 'Trainers'],
          links: ['Schedule', 'Membership'],
          buttons: ['Join Now'],
          forms: 1,
          images: 5,
        }],
      });

      const result = await evaluate(page.asPage(), {
        originalPrompt: 'Build a fitness gym website',
      });

      assume(result.success).is.true();
      assume(result.data!.siteType).equals('fitness');
    });

    it('should infer nonprofit site type', async function inferNonprofit() {
      const page = new MockPage({
        evaluateReturns: [{
          text: 'Donate to our charity foundation today.',
          headings: ['Our Mission'],
          links: ['Donate', 'Volunteer'],
          buttons: ['Donate Now'],
          forms: 1,
          images: 4,
        }],
      });

      const result = await evaluate(page.asPage(), {
        originalPrompt: 'Website for a nonprofit charity organization',
      });

      assume(result.success).is.true();
      assume(result.data!.siteType).equals('nonprofit');
    });

    it('should infer blog site type', async function inferBlog() {
      const page = new MockPage({
        evaluateReturns: [{
          text: 'Read our latest articles and blog posts.',
          headings: ['Recent Posts'],
          links: ['Blog', 'Archives'],
          buttons: [],
          forms: 0,
          images: 3,
        }],
      });

      const result = await evaluate(page.asPage(), {
        originalPrompt: 'Create a blog and news publication',
      });

      assume(result.success).is.true();
      assume(result.data!.siteType).equals('blog');
    });

    it('should infer event-planner site type', async function inferEventPlanner() {
      const page = new MockPage({
        evaluateReturns: [{
          text: 'Plan your dream wedding with us.',
          headings: ['Services', 'Portfolio'],
          links: ['Weddings', 'Events'],
          buttons: ['Get a Quote'],
          forms: 1,
          images: 10,
        }],
      });

      const result = await evaluate(page.asPage(), {
        originalPrompt: 'Build a wedding and event planner website',
      });

      assume(result.success).is.true();
      assume(result.data!.siteType).equals('event-planner');
    });

    it('should handle errors gracefully', async function errorHandling() {
      const page = new MockPage();
      page.evaluate = async () => { throw new Error('Context destroyed'); };

      const result = await evaluate(page.asPage());
      assume(result.success).is.false();
      assume(result.error).includes('Context destroyed');
    });
  });
});
