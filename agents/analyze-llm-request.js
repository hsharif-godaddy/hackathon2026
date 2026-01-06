#!/usr/bin/env node

import { readFileSync } from "node:fs";

const inputFile = process.argv[2];
if (!inputFile) {
	console.error("Usage: node analyze-llm-request.js <input-file.json>");
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

const messages = requestBody.messages || [];
const system = requestBody.system || [];

console.log("=== REQUEST ANALYSIS ===\n");
console.log(`Model: ${requestBody.model}`);
console.log(`Max tokens: ${requestBody.max_tokens}`);
console.log(`Temperature: ${requestBody.temperature ?? "default"}`);
console.log(`System prompts: ${Array.isArray(system) ? system.length : 1}`);
console.log(`Messages: ${messages.length}\n`);

console.log("=== SYSTEM PROMPT ANALYSIS ===\n");
const systemArray = Array.isArray(system) ? system : [system];
systemArray.forEach((sys, idx) => {
	if (typeof sys === "string") {
		console.log(`System ${idx + 1}: String (${sys.length} chars)`);
	} else if (sys.type === "text") {
		console.log(`System ${idx + 1}: Text (${sys.text?.length || 0} chars)`);
		if (sys.cache_control) {
			console.log(`  Cache control: ${sys.cache_control.type}`);
		}
	} else {
		console.log(`System ${idx + 1}: ${sys.type || "unknown"}`);
	}
});

console.log("\n=== MESSAGE SEQUENCE ANALYSIS ===\n");

const oddities = [];
let totalTokenEstimate = 0;

messages.forEach((msg, idx) => {
	const role = msg.role;
	const content = msg.content;
	const contentArray = Array.isArray(content) ? content : [{ type: "text", text: content }];
	
	let textChars = 0;
	let toolUses = 0;
	let toolResults = 0;
	let images = 0;
	let hasCacheControl = false;
	
	contentArray.forEach((block) => {
		if (block.type === "text") {
			textChars += block.text?.length || 0;
		} else if (block.type === "tool_use") {
			toolUses++;
		} else if (block.type === "tool_result") {
			toolResults++;
		} else if (block.type === "image") {
			images++;
		}
		
		if (block.cache_control) {
			hasCacheControl = true;
		}
	});
	
	totalTokenEstimate += Math.ceil(textChars / 4);
	
	console.log(`[${idx}] ${role.toUpperCase()}`);
	console.log(`    Content blocks: ${contentArray.length}`);
	if (textChars > 0) console.log(`    Text: ${textChars} chars (~${Math.ceil(textChars / 4)} tokens)`);
	if (toolUses > 0) console.log(`    Tool uses: ${toolUses}`);
	if (toolResults > 0) console.log(`    Tool results: ${toolResults}`);
	if (images > 0) console.log(`    Images: ${images}`);
	if (hasCacheControl) console.log(`    ⚠️  Has cache control`);
	
	// Check for oddities
	if (idx > 0 && messages[idx - 1].role === role) {
		oddities.push(`[${idx}] Consecutive ${role} messages (no role alternation)`);
	}
	
	if (role === "user" && toolResults > 0 && textChars === 0) {
		oddities.push(`[${idx}] User message with only tool results (no text)`);
	}
	
	if (role === "assistant" && toolUses === 0 && textChars === 0 && images === 0) {
		oddities.push(`[${idx}] Empty assistant message`);
	}
	
	if (textChars > 100000) {
		oddities.push(`[${idx}] Very large text content (${textChars} chars)`);
	}
	
	if (contentArray.length > 50) {
		oddities.push(`[${idx}] High number of content blocks (${contentArray.length})`);
	}
	
	if (role === "user" && toolUses > 0) {
		oddities.push(`[${idx}] User message contains tool_use blocks (should be assistant)`);
	}
	
	if (role === "assistant" && toolResults > 0) {
		oddities.push(`[${idx}] Assistant message contains tool_result blocks (should be user)`);
	}
	
	console.log("");
});

console.log("=== STATISTICS ===\n");
console.log(`Total estimated tokens: ~${totalTokenEstimate}`);
console.log(`User messages: ${messages.filter((m) => m.role === "user").length}`);
console.log(`Assistant messages: ${messages.filter((m) => m.role === "assistant").length}`);

const firstMessage = messages[0];
const lastMessage = messages[messages.length - 1];
console.log(`First message: ${firstMessage?.role}`);
console.log(`Last message: ${lastMessage?.role}`);

if (oddities.length > 0) {
	console.log("\n=== ODDITIES DETECTED ===\n");
	oddities.forEach((oddity) => {
		console.log(`⚠️  ${oddity}`);
	});
} else {
	console.log("\n✓ No oddities detected");
}

console.log("");
