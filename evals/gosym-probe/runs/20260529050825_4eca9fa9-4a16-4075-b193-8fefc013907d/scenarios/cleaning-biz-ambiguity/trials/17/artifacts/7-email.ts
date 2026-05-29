src/server/email.ts [177 lines]
     1|/** TREAT AS IMMUTABLE - This file is protected by the file-edit tool
     2| *
     3| * Send transactional email through the Airo email gateway.
     4| *
     5| * Posts a JSON message to the loopback gateway provided by the Airo
     6| * runtime. The gateway authors the outbound RFC-5322 message, applies
     7| * the platform sender-identity policy, and forwards to the configured
     8| * SMTP destination. Customer code never touches SMTP directly.
     9| *
    10| * The gateway listens on 127.0.0.1:2525 inside both the preview and
    11| * publish containers; this module assumes that contract and does not
    12| * accept an override.
    13| */
    14|
    15|// Loopback only — the email gateway runs on 127.0.0.1 inside the same
    16|// container as customer code. TLS adds nothing for traffic that never
    17|// leaves the kernel and would require cert provisioning for 127.0.0.1
    18|// in every preview/publish container; the SMTP path uses plain
    19|// localhost:25 + secure:false for the same reason.
    20|// nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
    21|const EMAIL_GATEWAY_URL = "http://127.0.0.1:2525/api/email/send";
    22|const REQUEST_TIMEOUT_MS = 30_000;
    23|
    24|export type EmailAttachment = {
    25|	/** File name presented to the recipient. Must not contain CR, LF, quote, or backslash. */
    26|	filename: string;
    27|	/**
    28|	 * Attachment bytes. Always pass raw bytes — the helper base64-encodes
    29|	 * for the wire. For text content (e.g. an .ics calendar invite),
    30|	 * encode the string yourself: `Buffer.from(text, 'utf-8')`.
    31|	 */
    32|	content: Buffer | Uint8Array;
    33|	/** MIME type. Defaults to application/octet-stream when omitted. */
    34|	contentType?: string;
    35|};
    36|
    37|export type SendEmailInput = {
    38|	/** Recipient address(es). At least one required. */
    39|	to: string | string[];
    40|	/** Carbon-copy recipient(s). */
    41|	cc?: string | string[];
    42|	/** Blind-carbon-copy recipient(s). Never appears in headers. */
    43|	bcc?: string | string[];
    44|	/** Subject line. Required. */
    45|	subject: string;
    46|	/** Plain-text body. At least one of text or html is required. */
    47|	text?: string;
    48|	/** HTML body. At least one of text or html is required. */
    49|	html?: string;
    50|	/** Reply-To header. Use this to direct replies elsewhere. */
    51|	replyTo?: string;
    52|	/**
    53|	 * Sender address. Omit to use the app's canonical sender — the gateway
    54|	 * picks the right value based on attached domains. Only set this when
    55|	 * a specific local-part on a verified domain is required; the gateway
    56|	 * rejects unverified senders with a 400.
    57|	 */
    58|	from?: string;
    59|	/** Up to 10 attachments, each ≤ 2 MB decoded. */
    60|	attachments?: EmailAttachment[];
    61|};
    62|
    63|export type SendEmailResult = {
    64|	/** Opaque id minted by the gateway. Logged on the gateway for correlation. */
    65|	messageId: string;
    66|};
    67|
    68|type GatewayPayload = {
    69|	to: string[];
    70|	cc?: string[];
    71|	bcc?: string[];
    72|	subject: string;
    73|	text?: string;
    74|	html?: string;
    75|	replyTo?: string;
    76|	from?: string;
    77|	attachments?: { filename: string; content: string; contentType?: string }[];
    78|};
    79|
    80|type GatewayResponse = {
    81|	success: boolean;
    82|	messageId?: string;
    83|	error?: string;
    84|};
    85|
    86|export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    87|	const payload = buildPayload(input);
    88|
    89|	// AbortSignal.timeout() binds to the response so the same deadline
    90|	// covers connect, headers, AND body reads. A manual
    91|	// `setTimeout(controller.abort, ...)` cleared in `finally` after
    92|	// `fetch()` resolves headers leaves body reads unprotected — the
    93|	// caller hangs indefinitely on a stalled mid-body response.
    94|	let response: Response;
    95|	let body: GatewayResponse;
    96|	try {
    97|		response = await fetch(EMAIL_GATEWAY_URL, {
    98|			method: "POST",
    99|			headers: { "content-type": "application/json" },
   100|			body: JSON.stringify(payload),
   101|			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
   102|		});
   103|		body = await parseBody(response);
   104|	} catch (err) {
   105|		throw new Error(`email gateway unreachable: ${describeError(err)}`);
   106|	}
   107|
   108|	if (!response.ok || !body.success) {
   109|		const detail = body.error ?? `HTTP ${response.status}`;
   110|		const idSuffix = body.messageId ? ` (messageId=${body.messageId})` : "";
   111|		throw new Error(`email send failed: ${detail}${idSuffix}`);
   112|	}
   113|
   114|	if (!body.messageId) {
   115|		throw new Error("email send succeeded but gateway returned no messageId");
   116|	}
   117|
   118|	return { messageId: body.messageId };
   119|}
   120|
   121|function buildPayload(input: SendEmailInput): GatewayPayload {
   122|	const payload: GatewayPayload = {
   123|		to: toArray(input.to),
   124|		subject: input.subject,
   125|	};
   126|	const cc = toArray(input.cc);
   127|	if (cc.length > 0) payload.cc = cc;
   128|	const bcc = toArray(input.bcc);
   129|	if (bcc.length > 0) payload.bcc = bcc;
   130|	if (input.text) payload.text = input.text;
   131|	if (input.html) payload.html = input.html;
   132|	if (input.replyTo) payload.replyTo = input.replyTo;
   133|	if (input.from) payload.from = input.from;
   134|	if (input.attachments && input.attachments.length > 0) {
   135|		payload.attachments = input.attachments.map(encodeAttachment);
   136|	}
   137|	return payload;
   138|}
   139|
   140|function toArray(value: string | string[] | undefined): string[] {
   141|	if (value === undefined) return [];
   142|	return Array.isArray(value) ? value : [value];
   143|}
   144|
   145|function encodeAttachment(att: EmailAttachment): { filename: string; content: string; contentType?: string } {
   146|	const out: { filename: string; content: string; contentType?: string } = {
   147|		filename: att.filename,
   148|		content: Buffer.from(att.content).toString("base64"),
   149|	};
   150|	if (att.contentType) out.contentType = att.contentType;
   151|	return out;
   152|}
   153|
   154|async function parseBody(response: Response): Promise<GatewayResponse> {
   155|	try {
   156|		return (await response.json()) as GatewayResponse;
   157|	} catch (err) {
   158|		// Don't swallow aborts — re-raise so the outer catch reports the
   159|		// timeout. JSON parse errors fall through to a sanitized "non-JSON
   160|		// response" payload that lets sendEmail produce a useful error.
   161|		if (isAbortLike(err)) throw err;
   162|		return { success: false, error: `non-JSON response (HTTP ${response.status})` };
   163|	}
   164|}
   165|
   166|function isAbortLike(err: unknown): boolean {
   167|	return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
   168|}
   169|
   170|function describeError(err: unknown): string {
   171|	if (err instanceof Error) {
   172|		if (isAbortLike(err)) return `timed out after ${REQUEST_TIMEOUT_MS}ms`;
   173|		return err.message;
   174|	}
   175|	return String(err);
   176|}
   177|