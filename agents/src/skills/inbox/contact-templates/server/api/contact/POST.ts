/** TREAT AS IMMUTABLE - This file is protected by the file-edit tool
 *
 * Forwards contact form submissions to the backend conversations endpoint.
 * Config values (brandId, categoryId) are read from contact-form.config.json.
 * Backend host is resolved at runtime from GODADDY_API_BASE_URL.
 */
import type { Request, Response } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface ContactFormConfig {
	brandId: string;
	categoryId: number | string;
}

function loadConfig(): ContactFormConfig {
	const configPath = join(process.cwd(), "src/lib/contact-form.config.json");
	const raw = readFileSync(configPath, "utf-8");
	return JSON.parse(raw) as ContactFormConfig;
}

function resolveReamazeHost(): string {
	const apiBase = process.env.GODADDY_API_BASE_URL || "";
	if (apiBase.includes("dev-godaddy.com")) return "reamaze.dev-godaddy.com";
	if (apiBase.includes("test-godaddy.com")) return "reamaze.test-godaddy.com";
	return "reamaze.godaddy.com";
}

let cachedConfig: ContactFormConfig | null = null;
const reamazeHost = resolveReamazeHost();

function getConfig(): ContactFormConfig | null {
	if (cachedConfig) return cachedConfig;
	try {
		cachedConfig = loadConfig();
	} catch {
		return null;
	}
	return cachedConfig;
}

export default async function handler(req: Request, res: Response): Promise<void> {
	const body = req.body;

	const email = body?.user?.email;
	if (!email) {
		res.status(400).json({ success: false, error: "user.email is required" });
		return;
	}

	if (!body?.conversation?.messages_attributes?.length) {
		res.status(400).json({ success: false, error: "conversation.messages_attributes is required" });
		return;
	}

	const config = getConfig();
	if (!config?.brandId || !config.categoryId) {
		res.status(500).json({ success: false, error: "Contact form not configured" });
		return;
	}

	const url = `https://${config.brandId}.${reamazeHost}/data/conversations`;

	const payload = {
		conversation: {
			messages_attributes: body.conversation.messages_attributes,
			category_id: config.categoryId,
			data: {
				...body.conversation?.data,
				__gd_type: "contact",
			},
		},
		user: body.user,
		_url: req.headers.referer || req.headers.origin || "",
	};

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			res.status(502).json({ success: false, error: `Inbox backend returned ${response.status}: ${text}` });
			return;
		}

		res.status(200).json({ success: true });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		res.status(502).json({ success: false, error: `Failed to reach inbox backend: ${message}` });
	}
}
