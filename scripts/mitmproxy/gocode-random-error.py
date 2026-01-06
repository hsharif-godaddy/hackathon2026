import random
import json
import time
from mitmproxy import http
from mitmproxy import ctx

# ============================================================================
# CONFIGURATION - Edit these to enable/disable different error scenarios
# ============================================================================

# Set to True to force all responses to return Budget Exceeded errors
FORCE_BUDGET_EXCEEDED = False

# Error scenarios with their probability (0.0 to 1.0)
# Set probability to 0 to disable a scenario
ERROR_SCENARIOS = {
    # Connection issues (handled in request phase)
    'drop_connection': {'probability': 0.0, 'enabled': True},

    # Error responses (handled in request phase - no proxy)
    'rate_limit_429': {'probability': 0.0, 'enabled': True},
    'budget_exceeded_400': {'probability': 0.0, 'enabled': True},
    'unauthorized_401': {'probability': 0.0, 'enabled': True},
    'forbidden_403': {'probability': 0.0, 'enabled': True},
    'bad_gateway_502': {'probability': 0.0, 'enabled': True},
    'service_unavailable_503': {'probability': 0.0, 'enabled': True},
    'gateway_timeout_504': {'probability': 0.0, 'enabled': True},
    'context_length_error': {'probability': 0.0, 'enabled': True},
    'model_unavailable': {'probability': 0.0, 'enabled': True},

    # Response corruption (handled in response phase - after proxy)
    'corrupt_content_length': {'probability': 0.0, 'enabled': True},
    'invalid_json': {'probability': 0.0, 'enabled': True},
    'empty_200_response': {'probability': 0.0, 'enabled': True},
    'wrong_content_type': {'probability': 0.0, 'enabled': True},
    'truncate_response': {'probability': 0.0, 'enabled': True},

    # Streaming-specific errors (handled in responseheaders phase)
    'drop_during_stream': {'probability': 0.0, 'enabled': True},
    'slow_stream_chunks': {'probability': 0.0, 'enabled': True, 'delay_seconds': 2},

    # Timing issues
    'slow_response': {'probability': 0.0, 'enabled': True, 'delay_seconds': 5},
    'timeout_simulation': {'probability': 0.0, 'enabled': True, 'delay_seconds': 35},
}

# Track which flows should have streaming modifications
streaming_flows = {}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def create_error_response(status_code, message, error_type, code=None):
    """Create a standard LiteLLM error response."""
    return {
        "error": {
            "message": message,
            "type": error_type,
            "param": None,
            "code": code or str(status_code)
        }
    }

def make_json_response(flow, status_code, payload):
    """Create a JSON response without proxying."""
    flow.response = http.Response.make(
        status_code,
        json.dumps(payload).encode('utf-8'),
        {"Content-Type": "application/json"}
    )

def should_trigger(scenario_name):
    """Check if a scenario should be triggered based on probability."""
    scenario = ERROR_SCENARIOS.get(scenario_name, {})
    if not scenario.get('enabled', False):
        return False
    probability = scenario.get('probability', 0.0)
    return probability > 0 and random.random() < probability

# ============================================================================
# REQUEST HANDLER - Intercepts before proxying to server
# ============================================================================

def request(flow: http.Flow):
    # Drop connection
    if should_trigger('drop_connection'):
        flow.kill()
        ctx.log.info(f"[drop_connection] Dropped connection for {flow.request.pretty_url}")
        return

    # If forcing budget exceeded errors, return immediately
    if FORCE_BUDGET_EXCEEDED:
        payload = create_error_response(
            400,
            "ExceededBudget: User=<user_id> over budget. Spend=3.7e-05, Budget=0.0",
            "budget_exceeded",
            "400"
        )
        make_json_response(flow, 400, payload)
        ctx.log.info(f"[FORCE_BUDGET_EXCEEDED] Blocked request to {flow.request.pretty_url}")
        return

    # Slow response simulation
    if should_trigger('slow_response'):
        delay = ERROR_SCENARIOS['slow_response'].get('delay_seconds', 5)
        time.sleep(delay)
        ctx.log.info(f"[slow_response] Delayed request by {delay}s for {flow.request.pretty_url}")

    # Timeout simulation
    if should_trigger('timeout_simulation'):
        delay = ERROR_SCENARIOS['timeout_simulation'].get('delay_seconds', 35)
        time.sleep(delay)
        ctx.log.info(f"[timeout_simulation] Delayed request by {delay}s for {flow.request.pretty_url}")

    # Rate limit error
    if should_trigger('rate_limit_429'):
        payload = create_error_response(429, "Rate limit exceeded", "rate_limit_error", "429")
        make_json_response(flow, 429, payload)
        ctx.log.info(f"[rate_limit_429] Blocked request to {flow.request.pretty_url}")
        return

    # Budget exceeded error
    if should_trigger('budget_exceeded_400'):
        payload = create_error_response(
            400,
            "ExceededBudget: User=<user_id> over budget. Spend=3.7e-05, Budget=0.0",
            "budget_exceeded",
            "400"
        )
        make_json_response(flow, 400, payload)
        ctx.log.info(f"[budget_exceeded_400] Blocked request to {flow.request.pretty_url}")
        return

    # Unauthorized error
    if should_trigger('unauthorized_401'):
        payload = create_error_response(401, "Invalid authentication credentials", "authentication_error", "401")
        make_json_response(flow, 401, payload)
        ctx.log.info(f"[unauthorized_401] Blocked request to {flow.request.pretty_url}")
        return

    # Forbidden error
    if should_trigger('forbidden_403'):
        payload = create_error_response(403, "Permission denied", "permission_error", "403")
        make_json_response(flow, 403, payload)
        ctx.log.info(f"[forbidden_403] Blocked request to {flow.request.pretty_url}")
        return

    # Bad gateway error
    if should_trigger('bad_gateway_502'):
        payload = create_error_response(502, "Bad gateway", "server_error", "502")
        make_json_response(flow, 502, payload)
        ctx.log.info(f"[bad_gateway_502] Blocked request to {flow.request.pretty_url}")
        return

    # Service unavailable error
    if should_trigger('service_unavailable_503'):
        payload = create_error_response(503, "Service temporarily unavailable", "service_unavailable", "503")
        make_json_response(flow, 503, payload)
        ctx.log.info(f"[service_unavailable_503] Blocked request to {flow.request.pretty_url}")
        return

    # Gateway timeout error
    if should_trigger('gateway_timeout_504'):
        payload = create_error_response(504, "Gateway timeout", "timeout_error", "504")
        make_json_response(flow, 504, payload)
        ctx.log.info(f"[gateway_timeout_504] Blocked request to {flow.request.pretty_url}")
        return

    # Context length error
    if should_trigger('context_length_error'):
        payload = create_error_response(
            400,
            "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.",
            "context_length_exceeded",
            "context_length_exceeded"
        )
        make_json_response(flow, 400, payload)
        ctx.log.info(f"[context_length_error] Blocked request to {flow.request.pretty_url}")
        return

    # Model unavailable error
    if should_trigger('model_unavailable'):
        payload = create_error_response(
            503,
            "The model is currently overloaded with other requests",
            "model_error",
            "model_overloaded"
        )
        make_json_response(flow, 503, payload)
        ctx.log.info(f"[model_unavailable] Blocked request to {flow.request.pretty_url}")
        return

# ============================================================================
# RESPONSE HANDLER - Modifies responses after proxying to server
# ============================================================================

def response(flow: http.Flow):
    if not flow.response:
        return

    # If forcing budget exceeded errors, override response
    if FORCE_BUDGET_EXCEEDED:
        payload = create_error_response(
            400,
            "ExceededBudget: User=<user_id> over budget. Spend=3.7e-05, Budget=0.0",
            "budget_exceeded",
            "400"
        )
        flow.response.status_code = 400
        flow.response.content = json.dumps(payload).encode('utf-8')
        flow.response.headers["Content-Type"] = "application/json"
        ctx.log.info(f"[FORCE_BUDGET_EXCEEDED] Overriding response for {flow.request.pretty_url}")
        return

    original_status_code = flow.response.status_code
    original_content_type = flow.response.headers.get("Content-Type", "")

    # Corrupt Content-Length header
    if should_trigger('corrupt_content_length'):
        if "Content-Length" in flow.response.headers:
            original_length = int(flow.response.headers["Content-Length"])
            new_length = original_length - 1
            flow.response.headers["Content-Length"] = str(new_length)
            ctx.log.info(f"[corrupt_content_length] Modified Content-Length from {original_length} to {new_length} for {flow.request.pretty_url}")
        return

    # Return invalid JSON
    if should_trigger('invalid_json'):
        flow.response.content = b'{"invalid json missing brace'
        flow.response.headers["Content-Type"] = "application/json"
        ctx.log.info(f"[invalid_json] Corrupted JSON response for {flow.request.pretty_url}")
        return

    # Empty 200 response
    if should_trigger('empty_200_response'):
        flow.response.status_code = 200
        flow.response.content = b''
        if "Content-Length" in flow.response.headers:
            flow.response.headers["Content-Length"] = "0"
        ctx.log.info(f"[empty_200_response] Returned empty 200 for {flow.request.pretty_url}")
        return

    # Wrong Content-Type
    if should_trigger('wrong_content_type'):
        flow.response.headers["Content-Type"] = "text/html"
        flow.response.content = b'<html><body>Error</body></html>'
        ctx.log.info(f"[wrong_content_type] Changed Content-Type to text/html for {flow.request.pretty_url}")
        return

    # Truncate response
    if should_trigger('truncate_response'):
        if len(flow.response.content) > 10:
            truncated_length = len(flow.response.content) // 2
            flow.response.content = flow.response.content[:truncated_length]
            ctx.log.info(f"[truncate_response] Truncated response to {truncated_length} bytes for {flow.request.pretty_url}")
        return

    # If no error was triggered, log normal response
    ctx.log.info(f"[normal] Response {original_status_code} for {flow.request.pretty_url}")

# ============================================================================
# RESPONSE HEADERS HANDLER - Intercepts after headers but before body
# For streaming-specific errors
# ============================================================================

def responseheaders(flow: http.Flow):
    """Handle streaming-specific errors that occur after headers are sent."""
    if not flow.response:
        return

    flow_id = id(flow)

    # Drop connection during stream (after headers, before/during body)
    if should_trigger('drop_during_stream'):
        ctx.log.info(f"[drop_during_stream] Killing connection after headers for {flow.request.pretty_url}")
        flow.kill()
        return

    # Enable slow streaming by enabling streaming mode
    if should_trigger('slow_stream_chunks'):
        # Note: Streaming mode is not enabled by default in newer mitmproxy versions
        # This will delay the entire response delivery
        streaming_flows[flow_id] = {
            'slow_stream': True,
            'delay': ERROR_SCENARIOS['slow_stream_chunks'].get('delay_seconds', 2)
        }
        ctx.log.info(f"[slow_stream_chunks] Will delay response delivery for {flow.request.pretty_url}")
        # Add artificial delay before body transmission
        time.sleep(streaming_flows[flow_id]['delay'])

    # Clean up tracking after response is complete
    if flow_id in streaming_flows:
        del streaming_flows[flow_id]
