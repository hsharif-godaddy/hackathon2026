/**
 * Verification tests for Commerce Checkout prompts
 *
 * Ensures that commerce checkout guidance is properly loaded into Develop Agent
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const promptsDir = join(__dirname, "..");

describe("Commerce Checkout Prompts", () => {
	describe("File Existence", () => {
		it("should have commerce-checkout-guide.md file", () => {
			const filePath = join(promptsDir, "commerce-checkout-guide.md");
			expect(existsSync(filePath)).toBe(true);
		});

		it("should have updated decision-matrix.md file", () => {
			const filePath = join(promptsDir, "decision-matrix.md");
			expect(existsSync(filePath)).toBe(true);
		});
	});

	describe("Commerce Checkout Guide Content", () => {
		it("should contain three-page flow documentation", () => {
			const filePath = join(promptsDir, "commerce-checkout-guide.md");
			const content = readFileSync(filePath, "utf-8");

			expect(content).toContain("Product Listing Page");
			expect(content).toContain("Checkout Preparation Page");
			expect(content).toContain("Success Page");
		});

		it("should reference createCheckoutSession function", () => {
			const filePath = join(promptsDir, "commerce-checkout-guide.md");
			const content = readFileSync(filePath, "utf-8");

			expect(content).toContain("createCheckoutSession");
			expect(content).toContain("@/lib/commerce-client");
		});

		it("should include security best practices", () => {
			const filePath = join(promptsDir, "commerce-checkout-guide.md");
			const content = readFileSync(filePath, "utf-8");

			expect(content).toContain("Security Best Practices");
			expect(content).toContain("Never expose credentials client-side");
			expect(content).toContain("backend API routes");
		});

		it("should document environment variables", () => {
			const filePath = join(promptsDir, "commerce-checkout-guide.md");
			const content = readFileSync(filePath, "utf-8");

			expect(content).toContain("COMMERCE_CLIENT_ID");
			expect(content).toContain("COMMERCE_CLIENT_SECRET");
			expect(content).toContain("COMMERCE_STORE_ID");
			expect(content).toContain("COMMERCE_CHECKOUT_API_BASE_URL");
		});

		it("should include React/TypeScript code examples", () => {
			const filePath = join(promptsDir, "commerce-checkout-guide.md");
			const content = readFileSync(filePath, "utf-8");

			expect(content).toContain("```tsx");
			expect(content).toContain("useState");
			expect(content).toContain("useNavigate");
		});

		it("should explain Commerce Agent handoff workflow", () => {
			const filePath = join(promptsDir, "commerce-checkout-guide.md");
			const content = readFileSync(filePath, "utf-8");

			expect(content).toContain("Commerce Agent Handoff");
			expect(content).toContain("Commerce Agent fetches products");
		});

		it("should warn about correct SKU ID usage", () => {
			const filePath = join(promptsDir, "commerce-checkout-guide.md");
			const content = readFileSync(filePath, "utf-8");

			expect(content).toContain("⚠️ CRITICAL - SKU ID");
			expect(content).toContain("product.skuId");
			expect(content).toContain("sku.id");
			expect(content).toContain("DO NOT use any other ID field");
		});

		it("should require SKU IDs to be displayed in all UI pages", () => {
			const filePath = join(promptsDir, "commerce-checkout-guide.md");
			const content = readFileSync(filePath, "utf-8");

			expect(content).toContain("⚠️ MANDATORY UI REQUIREMENT");
			expect(content).toContain("MUST visibly display the SKU ID");
			expect(content).toContain("SKU ID (MANDATORY - must be visible in UI)");
			expect(content).toContain("MANDATORY - SKU ID must be visible");
			expect(content).toContain("ALL product displays MUST show SKU IDs");
		});

		it("should require SKU ID to be sent to POST.ts backend", () => {
			const filePath = join(promptsDir, "commerce-checkout-guide.md");
			const content = readFileSync(filePath, "utf-8");

			expect(content).toContain("⚠️ MANDATORY API REQUIREMENT");
			expect(content).toContain("SKU ID MUST be sent to the backend POST.ts");
			expect(content).toContain("MUST pass the SKU ID");
			expect(content).toContain("skuId: skuId!");
			expect(content).toContain("This SKU ID is sent to POST.ts");
		});
	});

	describe("Decision Matrix Updates", () => {
		it("should reference commerce-checkout-guide in decision matrix", () => {
			const filePath = join(promptsDir, "decision-matrix.md");
			const content = readFileSync(filePath, "utf-8");

			expect(content).toContain("commerce-checkout-guide");
		});

		it("should list checkout implementation requirements", () => {
			const filePath = join(promptsDir, "decision-matrix.md");
			const content = readFileSync(filePath, "utf-8");

			expect(content).toContain("Product listing page with buy buttons");
			expect(content).toContain("Checkout preparation page");
			expect(content).toContain("Backend API route");
			expect(content).toContain("Success page");
		});

		it("should have commerce handoff triggers", () => {
			const filePath = join(promptsDir, "decision-matrix.md");
			const content = readFileSync(filePath, "utf-8");

			expect(content).toContain("shopping cart");
			expect(content).toContain("buy button");
			expect(content).toContain("checkout");
		});
	});

	describe("Develop Agent Integration", () => {
		it("should load commerce-checkout-guide in develop-agent.ts", async () => {
			const agentFilePath = join(
				__dirname,
				"../../../agents/develop-agent.ts",
			);
			const content = readFileSync(agentFilePath, "utf-8");

			expect(content).toContain("commerce-checkout-guide.md");
		});

		it("should have commerce handoff configured", async () => {
			const agentFilePath = join(
				__dirname,
				"../../../agents/develop-agent.ts",
			);
			const content = readFileSync(agentFilePath, "utf-8");

			expect(content).toContain("agentName: 'commerce'");
			expect(content).toContain("handoffs");
		});
	});
});
