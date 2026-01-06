#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(".env") });

const apiKey = process.env.ANTHROPIC_API_KEY;
const baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";

if (!apiKey) {
	console.error("Error: ANTHROPIC_API_KEY not found in .env");
	process.exit(1);
}

const inputFile = process.argv[2];
if (!inputFile) {
	console.error("Usage: node replay-llm-request.js <input-file.json>");
	process.exit(1);
}

let requestBody;
try {
	const content = readFileSync(inputFile, "utf-8");
	requestBody = JSON.parse(content);
} catch (error) {
	console.error(`Error reading input file: ${error.message}`);
	process.exit(1);
}

const url = `${baseUrl}/v1/messages`;

console.error(`Making request to: ${url}`);
console.error(`Model: ${requestBody.model}`);
console.error(`Max tokens: ${requestBody.max_tokens}`);
console.error("---");

try {
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify(requestBody),
	});

	if (!response.ok) {
		const errorText = await response.text();
		console.error(`HTTP Error ${response.status}: ${response.statusText}`);
		console.error(errorText);
		process.exit(1);
	}

	const contentType = response.headers.get("content-type");
	
	if (contentType?.includes("text/event-stream")) {
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop();
			
			for (const line of lines) {
				if (line.startsWith("data: ")) {
					const data = line.slice(6);
					if (data === "[DONE]") continue;
					try {
						const json = JSON.parse(data);
						console.log(JSON.stringify(json, null, 2));
					} catch (e) {
						console.error("Failed to parse:", data);
					}
				}
			}
		}
	} else {
		const result = await response.json();
		console.log(JSON.stringify(result, null, 2));
	}
} catch (error) {
	console.error(`Request failed: ${error.message}`);
	process.exit(1);
}
